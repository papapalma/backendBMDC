/**
 * Authorization Utilities
 *
 * Implements strict authorization patterns with deny-by-default principle:
 * - All access is denied unless explicitly granted
 * - Super admins bypass tenant restrictions
 * - Regular users can only access their own tenant's resources
 *
 * Usage:
 * ```ts
 * // Check if user can access a resource in a specific tenant
 * const canAccess = requireTenantAccess(context, resourceTenantId);
 * if (!canAccess) return forbiddenResponse('Access denied');
 *
 * // Check if user has a specific role
 * const canEdit = requireRole(context, ['admin', 'coordinator']);
 * if (!canEdit) return forbiddenResponse('Insufficient permissions');
 * ```
 */

import { TenantContext } from '@/middleware/tenantContext';
import { logger } from '@/utils/logger';

/**
 * Verify that a user can access a resource in a specific tenant.
 *
 * DENY BY DEFAULT:
 * - Super admins: ✓ allowed (access to all tenants)
 * - Same tenant: ✓ allowed
 * - Different tenant: ✗ denied (logs warning)
 * - Super admin sentinel ('platform'): ✓ allowed for platform operations
 *
 * @param context - User's tenant context from JWT
 * @param resourceTenantId - Tenant ID of the resource being accessed
 * @returns true if access is allowed, false otherwise
 *
 * @example
 * ```ts
 * const result = await traineeService.getTrainee(traineeId);
 * if (!requireTenantAccess(context, result.tenantId)) {
 *   return forbiddenResponse('Access denied');
 * }
 * ```
 */
export function requireTenantAccess(context: TenantContext, resourceTenantId: string | null | undefined): boolean {
  // DENY BY DEFAULT: Start with assumption of no access
  if (!resourceTenantId) {
    logger.warn('[AUTHORIZATION] Resource has no tenant ID (data integrity issue)', {
      userId: context.userId,
      userTenantId: context.tenantId,
    });
    return false;
  }

  // Super admins can access any tenant
  if (context.isSuperAdmin) {
    logger.debug('[AUTHORIZATION] Super admin granted cross-tenant access', {
      userId: context.userId,
      userTenantId: context.tenantId,
      resourceTenantId,
    });
    return true;
  }

  // Platform operations (super admin sentinel)
  if (resourceTenantId === 'platform' && context.tenantId === 'platform') {
    return true;
  }

  // Regular users: must match their own tenant
  const isOwnTenant = context.tenantId.toLowerCase() === resourceTenantId.toLowerCase();

  if (!isOwnTenant) {
    logger.warn('[AUTHORIZATION] Cross-tenant access attempt blocked', {
      userId: context.userId,
      userTenantId: context.tenantId,
      resourceTenantId,
    });
  }

  return isOwnTenant;
}

/**
 * Verify that a user has one of the required roles.
 *
 * DENY BY DEFAULT:
 * - Super admins: ✓ always allowed (bypass role checks)
 * - Required role match: ✓ allowed
 * - No match: ✗ denied (logs warning)
 *
 * @param context - User's tenant context
 * @param requiredRoles - Array of allowed roles (e.g., ['admin', 'coordinator'])
 * @returns true if user has one of the required roles
 *
 * @example
 * ```ts
 * if (!requireRole(context, ['local_admin', 'super_admin'])) {
 *   return forbiddenResponse('Insufficient permissions');
 * }
 * ```
 */
export function requireRole(context: TenantContext, requiredRoles: string[]): boolean {
  // Super admins always have access
  if (context.isSuperAdmin) {
    return true;
  }

  // DENY BY DEFAULT: Check if user's role is in the allowed list
  const hasRequiredRole = requiredRoles.includes(context.role);

  if (!hasRequiredRole) {
    logger.warn('[AUTHORIZATION] Role check failed', {
      userId: context.userId,
      userRole: context.role,
      requiredRoles,
      tenantId: context.tenantId,
    });
  }

  return hasRequiredRole;
}

/**
 * Verify that a user has BOTH tenant access AND a required role.
 *
 * Combines both checks in strict order:
 * 1. First check role (faster deny)
 * 2. Then check tenant (prevent information leakage)
 *
 * @param context - User's tenant context
 * @param resourceTenantId - Tenant ID of the resource
 * @param requiredRoles - Array of allowed roles
 * @returns true if both checks pass
 *
 * @example
 * ```ts
 * if (!requireAccess(context, trainee.tenantId, ['local_admin'])) {
 *   return forbiddenResponse('Access denied');
 * }
 * ```
 */
export function requireAccess(
  context: TenantContext,
  resourceTenantId: string | null | undefined,
  requiredRoles?: string[]
): boolean {
  // Check role first (faster, doesn't leak tenant information)
  if (requiredRoles && !requireRole(context, requiredRoles)) {
    return false;
  }

  // Then check tenant access
  return requireTenantAccess(context, resourceTenantId);
}

/**
 * Verify array of resources all belong to the user's tenant.
 *
 * Used when filtering or validating multiple resource IDs from user input.
 * Returns false if ANY resource is outside the user's tenant.
 *
 * @param context - User's tenant context
 * @param tenantIds - Array of tenant IDs to verify
 * @returns true if all resources are in the user's tenant (or user is super admin)
 *
 * @example
 * ```ts
 * const traineeIds = req.body.ids;
 * const traineeTenantIds = await getTraineeTenantIds(traineeIds);
 * if (!requireMultiTenantAccess(context, traineeTenantIds)) {
 *   return forbiddenResponse('Cannot access one or more resources');
 * }
 * ```
 */
export function requireMultiTenantAccess(context: TenantContext, tenantIds: (string | null | undefined)[]): boolean {
  if (context.isSuperAdmin) {
    return true;
  }

  // DENY BY DEFAULT: All resources must be in the user's tenant
  const allInOwnTenant = tenantIds.every(
    (tenantId) => tenantId && context.tenantId.toLowerCase() === tenantId.toLowerCase()
  );

  if (!allInOwnTenant) {
    logger.warn('[AUTHORIZATION] Multi-tenant access check failed', {
      userId: context.userId,
      userTenantId: context.tenantId,
      resourceTenantIds: tenantIds,
      resourceCount: tenantIds.length,
    });
  }

  return allInOwnTenant;
}

/**
 * Verify that a user can perform a specific action on a resource.
 *
 * Combines role, tenant, and action-specific checks.
 * Use for complex authorization scenarios.
 *
 * @param context - User's tenant context
 * @param action - Action name (e.g., 'delete', 'edit', 'view')
 * @param resourceTenantId - Tenant ID of resource
 * @param allowedRoles - Roles that can perform this action
 * @returns true if authorized
 *
 * @example
 * ```ts
 * if (!requireAction(context, 'delete', trainee.tenantId, ['local_admin'])) {
 *   return forbiddenResponse('You do not have permission to delete this trainee');
 * }
 * ```
 */
export function requireAction(
  context: TenantContext,
  action: string,
  resourceTenantId: string | null | undefined,
  allowedRoles: string[]
): boolean {
  // DENY BY DEFAULT
  if (!requireRole(context, allowedRoles)) {
    logger.warn('[AUTHORIZATION] Action denied - insufficient role', {
      userId: context.userId,
      action,
      userRole: context.role,
    });
    return false;
  }

  if (!requireTenantAccess(context, resourceTenantId)) {
    logger.warn('[AUTHORIZATION] Action denied - cross-tenant', {
      userId: context.userId,
      action,
      userTenantId: context.tenantId,
      resourceTenantId,
    });
    return false;
  }

  logger.debug('[AUTHORIZATION] Action allowed', {
    userId: context.userId,
    action,
    tenantId: context.tenantId,
  });

  return true;
}
