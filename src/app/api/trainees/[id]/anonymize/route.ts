/**
 * POST /api/trainees/:id/anonymize
 *
 * Right to Erasure — anonymize a trainee's personal data (Req 22.5).
 *
 * Implements RA 10173 Right to Erasure with retention policy check:
 *   - If the trainee has completed programs within the last 5 years,
 *     full deletion is blocked (legal retention requirement).
 *   - Instead, PII fields are replaced with anonymized placeholders
 *     while preserving statistical/training records for reporting.
 *   - If no active retention obligation exists, the trainee record
 *     is fully deleted.
 *
 * Anonymized fields:
 *   first_name, last_name, middle_name → "ANONYMIZED"
 *   email → "anonymized-{uuid}@deleted.invalid"
 *   phone → "000-000-0000"
 *   birth_date → "1900-01-01"
 *   birth_place, province, municipality, barangay, street → "ANONYMIZED"
 *   photo_path, qr_code_path → null
 *   emergency_contact_name, emergency_contact_phone → null
 *
 * All requests are logged to audit_logs (Req 22.5).
 *
 * Requirements: 22.5
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
import { writeAuditLog, extractRequestContext } from '@/lib/auditLog';

/** Retention period: 5 years after program completion (RA 10173) */
const RETENTION_YEARS = 5;

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// POST /api/trainees/:id/anonymize — Right to Erasure (Req 22.5)

export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

    // Only admins can trigger erasure (trainees submit requests through DPO)

const allowedRoles = ['local_admin', 'super_admin'];
    if (!allowedRoles.includes(role) && !isSuperAdmin) { return forbiddenResponse(
        'Right to Erasure requests must be processed by an administrator'
      ); }

const { id } = await params;

    // Verify trainee exists and belongs to tenant

let checkQuery = supabaseAdmin
      .from('trainees')
      .select('id, tenant_id, first_name, last_name, email, status')
      .eq('id', id);
    if (!isSuperAdmin) checkQuery = checkQuery.eq('tenant_id', tenantId);

    const { data: trainee, error: checkErr } = await checkQuery.maybeSingle();
    if (checkErr) throw checkErr;
    if (!trainee) return notFoundResponse('Trainee not found');

    // ── Retention policy check (Req 22.5) ────────────────────────────────
    // Check if any enrollment was completed within the last 5 years
    const retentionCutoff = new Date();
    retentionCutoff.setFullYear(retentionCutoff.getFullYear() - RETENTION_YEARS);

    const { data: recentCompletions } = await supabaseAdmin
      .from('enrollments')
      .select('id, completion_date')
      .eq('trainee_id', id)
      .eq('status', 'completed')
      .gte('completion_date', retentionCutoff.toISOString().split('T')[0]);

    const hasRetentionObligation = (recentCompletions ?? []).length > 0;

    const ctx = extractRequestContext(request);

    if (hasRetentionObligation) { // ── Anonymize PII but preserve training records ───────────────────

const anonymizedEmail = `anonymized-${id.replace(/-/g, '').substring(0, 12)}@deleted.invalid`;

      const { error: anonErr } = await supabaseAdmin
        .from('trainees')
        .update({ first_name:              'ANONYMIZED',
          last_name:               'ANONYMIZED',
          middle_name:             'ANONYMIZED',
          email:                   anonymizedEmail,
          phone:                   '000-000-0000',
          birth_date:              '1900-01-01',
          birth_place:             'ANONYMIZED',
          province:                'ANONYMIZED',
          municipality:            'ANONYMIZED',
          barangay:                'ANONYMIZED',
          street:                  'ANONYMIZED',
          photo_path:              null,
          qr_code_path:            null,
          emergency_contact_name:  null,
          emergency_contact_phone: null,
          disability:              null,
          updated_at:              new Date().toISOString(), })
        .eq('id', id);

      if (anonErr) throw anonErr;

      // Log the anonymization (Req 22.5)

await writeAuditLog({ tenantId: trainee.tenant_id,
        userId,
        action: 'privacy.right_to_erasure_anonymized',
        entityType: 'trainee',
        entityId: id,
        details: { reason: 'Retention obligation active — PII anonymized, training records preserved',
          retention_cutoff: retentionCutoff.toISOString(),
          recent_completions: (recentCompletions ?? []).length,
          requested_by_role: role,
          _retention: '5years', },
        ...ctx, });

      return successResponse({ action: 'anonymized',
        message:
          'Personal data has been anonymized. Training records are retained for ' +
          `${RETENTION_YEARS} years after program completion as required by law.`,
        retentionObligation: true,
        retentionCutoff: retentionCutoff.toISOString().split('T')[0], }); }

    // ── No retention obligation — full deletion ───────────────────────────

const { error: deleteErr } = await supabaseAdmin
      .from('trainees')
      .delete()
      .eq('id', id);

    if (deleteErr) throw deleteErr;

    // Log the full deletion (Req 22.5)

await writeAuditLog({ tenantId: trainee.tenant_id,
      userId,
      action: 'privacy.right_to_erasure_deleted',
      entityType: 'trainee',
      entityId: id,
      details: { reason: 'No active retention obligation — trainee record fully deleted',
        requested_by_role: role,
        _retention: '5years', },
      ...ctx, });

    return successResponse({ action: 'deleted',
      message: 'Trainee record has been permanently deleted.',
      retentionObligation: false, }); }
);
