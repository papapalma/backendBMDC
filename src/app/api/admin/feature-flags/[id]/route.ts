/**
 * GET    /api/admin/feature-flags/:id  — get a feature flag (Req 23.1)
 * PATCH  /api/admin/feature-flags/:id  — toggle / update a feature flag (Req 23.1, 23.2)
 * DELETE /api/admin/feature-flags/:id  — delete a feature flag (Req 23.1)
 *
 * Requirements: 23.1, 23.2
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse,
  notFoundResponse,
  noContentResponse,
  forbiddenResponse, } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { invalidateFeatureFlagCache } from '@/lib/featureFlags';
import { z } from 'zod';

const updateFlagSchema = z.object({ enabled:       z.boolean().optional(),
  configuration: z.record(z.unknown()).optional().nullable(), });

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/admin/feature-flags/:id

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, role, isSuperAdmin } = ctxResult.context;

    const allowedRoles = ['admin', 'local_admin'];
    if (!allowedRoles.includes(role) && !isSuperAdmin) { return forbiddenResponse('Only administrators can view feature flags'); }

const { id } = await params;

    let query = supabaseAdmin
      .from('feature_flags')
      .select('*')
      .eq('id', id);

    if (!isSuperAdmin) query = query.eq('tenant_id', tenantId);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return notFoundResponse('Feature flag not found');

    return successResponse(data); }
);

// PATCH /api/admin/feature-flags/:id — toggle or update (Req 23.1, 23.2)

export const PATCH = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, role, isSuperAdmin } = ctxResult.context;

    const allowedRoles = ['admin', 'local_admin'];
    if (!allowedRoles.includes(role) && !isSuperAdmin) { return forbiddenResponse('Only administrators can update feature flags'); }

const { id } = await params;

    // Verify flag exists and belongs to tenant

let checkQuery = supabaseAdmin
      .from('feature_flags')
      .select('id, tenant_id, feature_key')
      .eq('id', id);
    if (!isSuperAdmin) checkQuery = checkQuery.eq('tenant_id', tenantId);

    const { data: existing, error: checkErr } = await checkQuery.maybeSingle();
    if (checkErr) throw checkErr;
    if (!existing) return notFoundResponse('Feature flag not found');

    const body = await request.json();
    const validated = updateFlagSchema.parse(body);

    const updatePayload: Record<string, unknown> = {};
    if (validated.enabled !== undefined)       updatePayload.enabled = validated.enabled;
    if (validated.configuration !== undefined) updatePayload.configuration = validated.configuration;

    const { data, error } = await supabaseAdmin
      .from('feature_flags')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Invalidate cache so the change takes effect immediately
    invalidateFeatureFlagCache(existing.tenant_id, existing.feature_key);

    return successResponse(
      data,
      `Feature "${existing.feature_key}" ${data.enabled ? 'enabled' : 'disabled'} successfully`
    ); }
);

// DELETE /api/admin/feature-flags/:id

export const DELETE = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, role, isSuperAdmin } = ctxResult.context;

    const adminRoles = ['admin', 'local_admin'];
    if (!adminRoles.includes(role) && !isSuperAdmin) { return forbiddenResponse('Only administrators can delete feature flags'); }

const { id } = await params;

    let checkQuery = supabaseAdmin
      .from('feature_flags')
      .select('id, tenant_id, feature_key')
      .eq('id', id);
    if (!isSuperAdmin) checkQuery = checkQuery.eq('tenant_id', tenantId);

    const { data: existing, error: checkErr } = await checkQuery.maybeSingle();
    if (checkErr) throw checkErr;
    if (!existing) return notFoundResponse('Feature flag not found');

    const { error } = await supabaseAdmin
      .from('feature_flags')
      .delete()
      .eq('id', id);

    if (error) throw error;

    invalidateFeatureFlagCache(existing.tenant_id, existing.feature_key);

    return noContentResponse(); }
);
