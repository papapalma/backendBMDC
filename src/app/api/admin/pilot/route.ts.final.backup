/**
 * Pilot Feature Flag Management API
 *
 * Implements Requirements 26.2, 26.3:
 *   - 26.2  Enable multi-tenant features only for pilot tenants using feature flags
 *   - 26.3  Create pilot tenant monitoring dashboard data
 *
 * GET  /api/admin/pilot          — list all tenants with their pilot feature flag status
 * POST /api/admin/pilot          — configure pilot feature flags for a tenant (bulk set)
 * GET  /api/admin/pilot/metrics  — pilot monitoring metrics (active tenants, error rates, etc.)
 *
 * Access: Super Admin only
 */

import { NextRequest } from 'next/server';
import { withTenantContext } from '@/middleware/withTenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { successResponse, errorResponse, forbiddenResponse } from '@/utils/responses';
import { invalidateFeatureFlagCache } from '@/lib/featureFlags';
import { logConfigChange, AuditAction } from '@/lib/auditLog';

/** All feature keys that can be toggled during pilot */
const PILOT_FEATURE_KEYS = [
  'inventory_management',
  'certificate_generation',
  'qr_code_attendance',
  'mobile_app_access',
  'whatsapp_notifications',
  'email_notifications',
] as const;

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// ---------------------------------------------------------------------------
// GET /api/admin/pilot — list tenants with feature flag status
// ---------------------------------------------------------------------------
export const GET = withErrorHandler(
  withTenantContext(async (request, context) => {
    if (!context.isSuperAdmin) return forbiddenResponse('Super Admin access required');

    const { searchParams } = request.nextUrl;
    const path = searchParams.get('path');

    // GET /api/admin/pilot?path=metrics — pilot monitoring metrics
    if (path === 'metrics') {
      const { data: tenants } = await supabaseAdmin
        .from('tenants')
        .select('id, name, status, created_at')
        .order('created_at', { ascending: false });

      const { data: flags } = await supabaseAdmin
        .from('feature_flags')
        .select('tenant_id, feature_key, enabled');

      // Build per-tenant feature summary
      const tenantMetrics = (tenants ?? []).map(tenant => {
        const tenantFlags = (flags ?? []).filter(f => f.tenant_id === tenant.id);
        const enabledCount = tenantFlags.filter(f => f.enabled).length;
        const totalCount = PILOT_FEATURE_KEYS.length;
        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          status: tenant.status,
          enabledFeatures: enabledCount,
          totalFeatures: totalCount,
          featureCompleteness: totalCount > 0 ? Math.round((enabledCount / totalCount) * 100) : 0,
          flags: Object.fromEntries(
            PILOT_FEATURE_KEYS.map(key => [
              key,
              tenantFlags.find(f => f.feature_key === key)?.enabled ?? false,
            ])
          ),
        };
      });

      return successResponse({
        totalTenants: tenants?.length ?? 0,
        activeTenants: tenants?.filter(t => t.status === 'active').length ?? 0,
        tenantMetrics,
        pilotFeatureKeys: PILOT_FEATURE_KEYS,
      });
    }

    // GET /api/admin/pilot — list all tenants with feature flags
    const { data: tenants, error } = await supabaseAdmin
      .from('tenants')
      .select('id, name, status, created_at')
      .order('name');

    if (error) return errorResponse(`Failed to fetch tenants: ${error.message}`);

    const { data: flags } = await supabaseAdmin
      .from('feature_flags')
      .select('tenant_id, feature_key, enabled');

    const result = (tenants ?? []).map(tenant => ({
      ...tenant,
      features: Object.fromEntries(
        PILOT_FEATURE_KEYS.map(key => [
          key,
          (flags ?? []).find(f => f.tenant_id === tenant.id && f.feature_key === key)?.enabled ?? false,
        ])
      ),
    }));

    return successResponse(result);
  })
);

// ---------------------------------------------------------------------------
// POST /api/admin/pilot — bulk configure pilot feature flags for a tenant
// ---------------------------------------------------------------------------
export const POST = withErrorHandler(
  withTenantContext(async (request, context) => {
    if (!context.isSuperAdmin) return forbiddenResponse('Super Admin access required');

    const body = await request.json();
    const { tenant_id, features, phase } = body;

    if (!tenant_id) return errorResponse('tenant_id is required');

    // Verify tenant exists
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id, name')
      .eq('id', tenant_id)
      .maybeSingle();

    if (!tenant) return errorResponse('Tenant not found');

    // Determine feature flags based on phase or explicit features object
    let flagsToSet: Record<string, boolean> = {};

    if (phase === 1) {
      // Phase 1: core features only
      flagsToSet = {
        inventory_management: true,
        certificate_generation: false,
        qr_code_attendance: false,
        mobile_app_access: false,
        whatsapp_notifications: false,
        email_notifications: true,
      };
    } else if (phase === 2) {
      // Phase 2: full feature enablement
      flagsToSet = Object.fromEntries(PILOT_FEATURE_KEYS.map(k => [k, true]));
    } else if (features && typeof features === 'object') {
      // Explicit feature map
      flagsToSet = features;
    } else {
      return errorResponse('Provide either "phase" (1 or 2) or "features" object');
    }

    // Upsert feature flags
    const upserts = Object.entries(flagsToSet).map(([feature_key, enabled]) => ({
      tenant_id,
      feature_key,
      enabled,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabaseAdmin
      .from('feature_flags')
      .upsert(upserts, { onConflict: 'tenant_id,feature_key' });

    if (error) return errorResponse(`Failed to update feature flags: ${error.message}`);

    // Invalidate cache for this tenant's feature flags
    invalidateFeatureFlagCache(tenant_id);

    await logConfigChange({
      userId: context.userId,
      tenantId: tenant_id,
      action: AuditAction.CONFIG_FEATURE_FLAG,
      entityType: 'tenant',
      entityId: tenant_id,
      details: { phase, features: flagsToSet, tenantName: tenant.name },
      request,
    });

    return successResponse(
      { tenant_id, tenantName: tenant.name, features: flagsToSet },
      `Pilot feature flags configured for ${tenant.name}`
    );
  })
);
