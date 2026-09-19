/**
 * WebSocket Subscription Authorizer Module
 *
 * Handles authorization checks for WebSocket subscription requests, ensuring
 * users can only subscribe to enrollments they're authorized to view.
 *
 * Implements Requirement: 7.4
 *   - 7.4: Trainees can only subscribe to their own enrollments
 *   - 7.4: Admins can subscribe to enrollments in their tenant
 */

import { executeQuery } from './db';
import { supabaseAdmin } from './supabase-admin';

/**
 * Enrollment record from database
 */
export interface EnrollmentRecord {
  id: string;
  trainee_id: string;
  program_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

/**
 * User claims from JWT
 */
export interface UserClaims {
  userId: string;
  traineeId: string;
  tenantId: string;
  role: string;
}

/**
 * Subscription authorization result
 */
export interface SubscriptionAuthResult {
  authorized: boolean;
  error?: string;
  enrollment?: EnrollmentRecord;
}

/**
 * Check if user role is admin
 *
 * Admin roles include:
 * - super_admin: Can access all tenants
 * - local_admin: Can access own tenant
 * - staff_training_coordinator: Can access own tenant's enrollment data
 *
 * @param role - User role from JWT
 * @returns True if user is an admin role, false otherwise
 */
export function isAdminRole(role: string): boolean {
  const adminRoles = ['super_admin', 'local_admin', 'staff_training_coordinator'];
  return adminRoles.includes(role);
}

/**
 * Check if user is staff member (non-trainee user with access to enrollments)
 *
 * @param role - User role from JWT
 * @returns True if user is staff, false otherwise
 */
export function isStaffRole(role: string): boolean {
  return isAdminRole(role) || role === 'staff_inventory_manager';
}

/**
 * Fetch enrollment from database
 *
 * @param enrollmentId - ID of enrollment to fetch
 * @returns Enrollment record or null if not found
 */
export async function fetchEnrollment(enrollmentId: string): Promise<EnrollmentRecord | null> {
  try {
    const result = await executeQuery<EnrollmentRecord>(
      supabaseAdmin
        .from('enrollments')
        .select('id, trainee_id, program_id, status, created_at, updated_at')
        .eq('id', enrollmentId)
        .limit(1)
        .single()
    );

    return result || null;
  } catch (error) {
    console.error('[WebSocket Auth] Error fetching enrollment:', error);
    return null;
  }
}

/**
 * Check if enrollment belongs to user's tenant
 *
 * Fetches the enrollment and verifies the trainee belongs to the same tenant as the user
 *
 * @param enrollmentId - ID of enrollment
 * @param userTenantId - Tenant ID from user claims
 * @returns True if enrollment is in user's tenant, false otherwise
 */
export async function isEnrollmentInUserTenant(
  enrollmentId: string,
  userTenantId: string
): Promise<boolean> {
  try {
    const result = await executeQuery<{ id: string }>(
      supabaseAdmin
        .from('enrollments')
        .select('id')
        .eq('id', enrollmentId)
        .eq('tenant_id', userTenantId)
        .limit(1)
        .single()
    );

    return !!result;
  } catch (error) {
    console.error('[WebSocket Auth] Error checking enrollment tenant:', error);
    return false;
  }
}

/**
 * Authorize a subscription request for a trainee
 *
 * Rules:
 * - Trainee can only subscribe to their own enrollments
 * - Can verify via trainee_id from JWT matching enrollment's trainee_id
 *
 * @param enrollmentId - ID of enrollment to subscribe to
 * @param userClaims - User claims from JWT
 * @returns Authorization result
 */
export async function authorizeTraineeSubscription(
  enrollmentId: string,
  userClaims: UserClaims
): Promise<SubscriptionAuthResult> {
  // Fetch enrollment to verify it exists and get trainee_id
  const enrollment = await fetchEnrollment(enrollmentId);

  if (!enrollment) {
    return {
      authorized: false,
      error: 'Enrollment not found',
    };
  }

  // Verify enrollment belongs to user's tenant
  const inUserTenant = await isEnrollmentInUserTenant(enrollmentId, userClaims.tenantId);
  if (!inUserTenant) {
    return {
      authorized: false,
      error: 'Enrollment belongs to different tenant',
    };
  }

  // Verify trainee can only subscribe to their own enrollment
  if (enrollment.trainee_id !== userClaims.traineeId) {
    return {
      authorized: false,
      error: 'Trainees can only subscribe to their own enrollments',
    };
  }

  return {
    authorized: true,
    enrollment,
  };
}

/**
 * Authorize a subscription request for admin/staff
 *
 * Rules:
 * - Admin can subscribe to any enrollment in their tenant
 * - Staff can subscribe to any enrollment in their tenant
 *
 * @param enrollmentId - ID of enrollment to subscribe to
 * @param userClaims - User claims from JWT
 * @returns Authorization result
 */
export async function authorizeAdminSubscription(
  enrollmentId: string,
  userClaims: UserClaims
): Promise<SubscriptionAuthResult> {
  // Fetch enrollment to verify it exists
  const enrollment = await fetchEnrollment(enrollmentId);

  if (!enrollment) {
    return {
      authorized: false,
      error: 'Enrollment not found',
    };
  }

  // Verify enrollment belongs to user's tenant
  const inUserTenant = await isEnrollmentInUserTenant(enrollmentId, userClaims.tenantId);
  if (!inUserTenant) {
    return {
      authorized: false,
      error: 'Enrollment belongs to different tenant',
    };
  }

  return {
    authorized: true,
    enrollment,
  };
}

/**
 * Authorize a subscription request based on user role
 *
 * Dispatches to appropriate authorization function based on user role:
 * - Trainee: Can subscribe to own enrollments
 * - Admin/Staff: Can subscribe to any enrollment in their tenant
 *
 * @param enrollmentId - ID of enrollment to subscribe to
 * @param userClaims - User claims from JWT
 * @returns Authorization result
 */
export async function authorizeSubscription(
  enrollmentId: string,
  userClaims: UserClaims
): Promise<SubscriptionAuthResult> {
  // Validate inputs
  if (!enrollmentId || !userClaims) {
    return {
      authorized: false,
      error: 'Missing enrollment ID or user claims',
    };
  }

  if (!userClaims.tenantId) {
    return {
      authorized: false,
      error: 'User claims missing tenant ID',
    };
  }

  // Dispatch based on role
  if (isAdminRole(userClaims.role)) {
    return authorizeAdminSubscription(enrollmentId, userClaims);
  } else if (userClaims.role === 'trainee') {
    return authorizeTraineeSubscription(enrollmentId, userClaims);
  } else {
    return {
      authorized: false,
      error: `Role "${userClaims.role}" is not authorized to subscribe to enrollments`,
    };
  }
}

/**
 * Batch authorize multiple subscription requests
 *
 * Useful when client requests multiple subscriptions at once
 *
 * @param enrollmentIds - Array of enrollment IDs
 * @param userClaims - User claims from JWT
 * @returns Map of enrollment ID to authorization result
 */
export async function authorizeSubscriptionBatch(
  enrollmentIds: string[],
  userClaims: UserClaims
): Promise<Map<string, SubscriptionAuthResult>> {
  const results = new Map<string, SubscriptionAuthResult>();

  for (const enrollmentId of enrollmentIds) {
    const result = await authorizeSubscription(enrollmentId, userClaims);
    results.set(enrollmentId, result);
  }

  return results;
}

/**
 * Check if user can modify an enrollment
 *
 * Only admins can modify enrollments. This is used in addition to API-level checks
 * to ensure WebSocket connections can't bypass authorization.
 *
 * @param userClaims - User claims from JWT
 * @returns True if user can modify enrollments, false otherwise
 */
export function canModifyEnrollments(userClaims: UserClaims): boolean {
  return isAdminRole(userClaims.role);
}





