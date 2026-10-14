/**
 * GET /api/programs  — list programs (tenant-scoped, Req 7.2, 7.3, 3.1, 3.2)
 * POST /api/programs — create program (tenant-scoped, Req 7.1)
 *
 * Requirements: 7.1, 7.2, 7.3, 7.8, 7.9, 3.1, 3.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { programService } from '@/services/programService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { requireRoleAsync } from '@/middleware/auth';
import { createProgramSchema } from '@/utils/validators';
import { successResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/programs - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/programs - Get programs, tenant-scoped.
// Public access (no auth) is allowed for the landing page — tenant resolved from
// ?tenant_id param or the first active tenant when no JWT is present.

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  // Try authenticated tenant context first
  const ctxResult = requireTenantContext(request);
  let tenantId: string | undefined;

  if (!ctxResult.error) {
    // Authenticated request — use tenant from JWT
    // Super admins have tenantId = 'platform' which is not a valid UUID
    // For super admins, don't filter by tenant_id (show all programs)
    if (ctxResult.context.tenantId !== 'platform') {
      tenantId = ctxResult.context.tenantId;
    }
  } else {
    // No valid JWT — allow public read using ?tenant_id param or default tenant
    const fromQuery = searchParams.get('tenant_id');
    if (fromQuery) {
      tenantId = fromQuery;
    } else {
      // Fall back to first active tenant (single-tenant deployment default)
      const { supabaseAdmin } = await import('@/lib/supabase-admin');
      const { data } = await supabaseAdmin
        .from('tenants')
        .select('id')
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();
      tenantId = data?.id ?? undefined;
    }
  }

  const programs = await programService.getAllPrograms({ status, search, tenantId });
  
  // Enrich all programs with current enrollment counts
  const enrichedPrograms = await programService.enrichProgramWithEnrollment(programs);
  
  return successResponse(enrichedPrograms);
});

// POST /api/programs - Create new program associated with the user's tenant (Req 7.1)

export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role } = ctxResult.context;

  // Only local_admin and staff_training_coordinator may create programs

const allowedRoles = ['local_admin', 'staff_training_coordinator'];
  if (!allowedRoles.includes(role)) {
  return forbiddenResponse('Insufficient permissions to create programs');
}

const body = await request.json();
  const validatedData = createProgramSchema.parse(body);

  // Inject tenant_id from JWT — callers cannot override this (Req 7.1)

const program = await programService.createProgram({ ...validatedData, tenantId });

  // Enrich program with current enrollment count
  const enrichedProgram = await programService.enrichProgramWithEnrollment(program);

  await activityLogService.logAction(userId, 'create', 'program', program.id, {
  name: validatedData.name,
  tenantId,
  }, undefined, tenantId);

  return successResponse(enrichedProgram, 'Program created successfully', 201);
});