/**
 * GET   /api/trainees/:id/personal-data  — Right to Access (Req 22.3)
 * PATCH /api/trainees/:id/personal-data  — Right to Rectification (Req 22.4)
 *
 * Implements RA 10173 data subject rights:
 *   - 22.3  Right to Access: returns all personal data, enrollments, certificates
 *   - 22.4  Right to Rectification: allows correction of personal data
 *
 * All requests are logged to audit_logs (Req 22.3, 22.4).
 *
 * Access rules:
 *   - Trainee: can only access/update their own data
 *   - Local Admin / Staff: can access/update trainees in their tenant
 *   - Super Admin: can access/update any trainee
 *
 * Requirements: 22.3, 22.4
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse,
  notFoundResponse,
  forbiddenResponse,
  errorResponse, } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { writeAuditLog, AuditAction, extractRequestContext } from '@/lib/auditLog';
import { z } from 'zod';

// Rectification schema — only fields a trainee can correct themselves
const rectificationSchema = z.object({ first_name:              z.string().min(1).max(100).optional(),
  last_name:               z.string().min(1).max(100).optional(),
  middle_name:             z.string().max(100).optional(),
  phone:                   z.string().min(10).max(20).optional(),
  province:                z.string().min(1).max(100).optional(),
  municipality:            z.string().min(1).max(100).optional(),
  barangay:                z.string().min(1).max(100).optional(),
  street:                  z.string().min(1).optional(),
  civil_status:            z.enum(['Single', 'Married', 'Widowed', 'Separated']).optional(),
  employment_status:       z.enum(['Employed', 'Unemployed', 'Self-employed', 'Student']).optional(),
  emergency_contact_name:  z.string().max(255).optional().nullable(),
  emergency_contact_phone: z.string().max(50).optional().nullable(), });

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/trainees/:id/personal-data — Right to Access (Req 22.3)

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

    const { id } = await params;

    // Trainees can only access their own data

if (role === 'trainee') { 
      const { data: account } = await supabaseAdmin
        .from('trainee_accounts')
        .select('trainee_id')
        .eq('user_id', userId)
        .eq('trainee_id', id)
        .maybeSingle();
      
      if (!account) { 
        // Fallback: check if this trainee's user_id matches the authenticated user
        const { data: traineeByUser } = await supabaseAdmin
          .from('trainees')
          .select('id')
          .eq('user_id', userId)
          .eq('id', id)
          .maybeSingle();
        
        if (!traineeByUser) {
          return forbiddenResponse('You can only access your own personal data'); 
        }
      } 
    }

    // Fetch trainee record

let traineeQuery = supabaseAdmin
      .from('trainees')
      .select('*')
      .eq('id', id);
    if (!isSuperAdmin) traineeQuery = traineeQuery.eq('tenant_id', tenantId);

    const { data: trainee, error: tErr } = await traineeQuery.maybeSingle();
    if (tErr) throw tErr;
    if (!trainee) return notFoundResponse('Trainee not found');

    // Fetch enrollments

const { data: enrollments } = await supabaseAdmin
      .from('enrollments')
      .select(`
        id, status, enrollment_date, completion_date, final_grade,
        program:programs(id, name, description, start_date, end_date)
      `)
      .eq('trainee_id', id)
      .eq('tenant_id', trainee.tenant_id);

    // Fetch certificates

const { data: certificates } = await supabaseAdmin
      .from('certificates')
      .select('id, certificate_number, issue_date, verification_url, signatory_name, signatory_title')
      .eq('tenant_id', trainee.tenant_id)
      .in(
        'enrollment_id',
        (enrollments ?? []).map((e: any) => e.id)
      );

    // Fetch attendance summary

const { data: attendance } = await supabaseAdmin
      .from('attendance')
      .select('session_id, status, check_in_time, check_out_time')
      .eq('trainee_id', id);

    // Log the data access request (Req 22.3)

const ctx = extractRequestContext(request);
    await writeAuditLog({ tenantId: trainee.tenant_id,
      userId,
      action: 'privacy.right_to_access',
      entityType: 'trainee',
      entityId: id,
      details: { requested_by_role: role },
      ...ctx, });

    return successResponse({ personalData: { id: trainee.id,
        first_name: trainee.first_name,
        last_name: trainee.last_name,
        middle_name: trainee.middle_name,
        email: trainee.email,
        phone: trainee.phone,
        sex: trainee.sex,
        birth_date: trainee.birth_date,
        birth_place: trainee.birth_place,
        civil_status: trainee.civil_status,
        province: trainee.province,
        municipality: trainee.municipality,
        barangay: trainee.barangay,
        street: trainee.street,
        educational_attainment: trainee.educational_attainment,
        course: trainee.course,
        year_graduated: trainee.year_graduated,
        classification: trainee.classification,
        disability: trainee.disability,
        employment_status: trainee.employment_status,
        emergency_contact_name: trainee.emergency_contact_name,
        emergency_contact_phone: trainee.emergency_contact_phone,
        enrollment_date: trainee.enrollment_date,
        status: trainee.status,
        consent_given: trainee.consent_given,
        consent_timestamp: trainee.consent_timestamp,
        consent_version: trainee.consent_version,
        created_at: trainee.created_at,
        updated_at: trainee.updated_at, },
      enrollments: enrollments ?? [],
      certificates: certificates ?? [],
      attendanceSummary: { total: (attendance ?? []).length,
        present: (attendance ?? []).filter((a: any) => a.status === 'present').length,
        absent: (attendance ?? []).filter((a: any) => a.status === 'absent').length,
        late: (attendance ?? []).filter((a: any) => a.status === 'late').length,
        excused: (attendance ?? []).filter((a: any) => a.status === 'excused').length, },
      retentionPolicy: { retainUntil: '5 years after program completion (RA 10173)',
        dataController: 'Your Local Government Unit Training Center', }, }); }
);

// PATCH /api/trainees/:id/personal-data — Right to Rectification (Req 22.4)

export const PATCH = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

    const { id } = await params;

    // Trainees can only rectify their own data

if (role === 'trainee') { 
      const { data: account } = await supabaseAdmin
        .from('trainee_accounts')
        .select('trainee_id')
        .eq('user_id', userId)
        .eq('trainee_id', id)
        .maybeSingle();
      
      if (!account) { 
        // Fallback: check if this trainee's user_id matches the authenticated user
        const { data: traineeByUser } = await supabaseAdmin
          .from('trainees')
          .select('id')
          .eq('user_id', userId)
          .eq('id', id)
          .maybeSingle();
        
        if (!traineeByUser) {
          return forbiddenResponse('You can only update your own personal data'); 
        }
      }
    }

    // Verify trainee exists and belongs to tenant

let checkQuery = supabaseAdmin
      .from('trainees')
      .select('id, tenant_id')
      .eq('id', id);
    if (!isSuperAdmin) checkQuery = checkQuery.eq('tenant_id', tenantId);

    const { data: existing, error: checkErr } = await checkQuery.maybeSingle();
    if (checkErr) throw checkErr;
    if (!existing) return notFoundResponse('Trainee not found');

    const body = await request.json();
    const validatedData = rectificationSchema.parse(body);

    if (Object.keys(validatedData).length === 0) { return errorResponse('No fields provided for rectification', 400); }

const { data: updated, error: updateErr } = await supabaseAdmin
      .from('trainees')
      .update({ ...validatedData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Log the rectification request (Req 22.4)

const ctx = extractRequestContext(request);
    await writeAuditLog({ tenantId: existing.tenant_id,
      userId,
      action: 'privacy.right_to_rectification',
      entityType: 'trainee',
      entityId: id,
      details: { fields_updated: Object.keys(validatedData),
        requested_by_role: role, },
      ...ctx, });

    return successResponse(updated, 'Personal data updated successfully'); }
);
