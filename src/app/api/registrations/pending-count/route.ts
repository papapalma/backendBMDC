import { NextRequest, NextResponse } from 'next/server';
import { requireRoleAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { requireTenantContext } from '@/middleware/tenantContext';
import { registrationService } from '@/services/registrationService';

// OPTIONS /api/registrations/pending-count - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * GET /api/registrations/pending-count
 * Get count of pending registrations for the current tenant
 * Used to display badge on Registrations navigation item
 * 
 * Returns 0 if unauthenticated or super_admin; actual count for tenant admins/staff
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  // Try to require authentication, but don't fail if missing
  const authResult = await requireRoleAsync(request, [
    'local_admin',
    'staff_training_coordinator',
    'staff_inventory_manager',
    'super_admin',
  ]);
  
  // If not authenticated, return 0 count (don't show badge)
  if ('error' in authResult) {
    return successResponse({ count: 0 });
  }

  // Require valid tenant context for authenticated users
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) {
    // Return 0 count if tenant context cannot be extracted
    return successResponse({ count: 0 });
  }

  const context = ctxResult.context;
  
  // Super admins don't belong to a specific tenant (tenantId: 'platform')
  // Return 0 for superadmins
  if (context.isSuperAdmin || context.tenantId === 'platform') {
    return successResponse({ count: 0 });
  }

  try {
    const count = await registrationService.countPendingByTenant(context.tenantId);
    return successResponse({ count });
  } catch (error) {
    // If counting fails, return 0 instead of error
    return successResponse({ count: 0 });
  }
});