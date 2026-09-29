/**
 * Field-Level Authorization Module
 *
 * Implements field-level access control for enrollment data in WebSocket messages.
 * Ensures that sensitive fields are filtered based on user role and context.
 *
 * Implements Requirements: 15.3, 15.4
 *   - 15.3: Trainees cannot see other trainees' emails in enrollment records
 *   - 15.4: Non-admin users don't see internal admin flags
 */

/**
 * Enrollment data with all possible fields
 */
export interface FullEnrollmentData {
  id: string;
  trainee_id: string;
  program_id: string;
  status: string;
  enrollment_date: string;
  created_at: string;
  updated_at: string;
  // Trainee related fields
  trainee_email?: string;
  trainee_first_name?: string;
  trainee_last_name?: string;
  trainee_phone?: string;
  // Admin-only fields
  admin_notes?: string;
  admin_flags?: string[];
  is_flagged_for_review?: boolean;
  internal_status?: string;
  // Other potentially sensitive fields
  [key: string]: any;
}

/**
 * Filtered enrollment data safe for specific user
 */
export interface FilteredEnrollmentData {
  id: string;
  trainee_id: string;
  program_id: string;
  status: string;
  enrollment_date: string;
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

/**
 * User context for authorization
 */
export interface UserContext {
  userId: string;
  traineeId: string;
  tenantId: string;
  role: string;
}

/**
 * Define which fields are visible for each role
 *
 * Fields not listed here are considered sensitive and will be filtered out
 */
const ROLE_FIELD_VISIBILITY: Record<string, Set<string>> = {
  trainee: new Set([
    // Basic enrollment info
    'id',
    'trainee_id',
    'program_id',
    'status',
    'enrollment_date',
    'created_at',
    'updated_at',
    // Trainee can see public trainee info
    'trainee_first_name',
    'trainee_last_name',
    // But NOT email or phone (sensitive)
  ]),
  staff_inventory_manager: new Set([
    // Basic enrollment info
    'id',
    'trainee_id',
    'program_id',
    'status',
    'enrollment_date',
    'created_at',
    'updated_at',
    // Can see trainee name but not email
    'trainee_first_name',
    'trainee_last_name',
  ]),
  staff_training_coordinator: new Set([
    // Basic enrollment info
    'id',
    'trainee_id',
    'program_id',
    'status',
    'enrollment_date',
    'created_at',
    'updated_at',
    // Can see trainee contact info
    'trainee_first_name',
    'trainee_last_name',
    'trainee_email',
    'trainee_phone',
  ]),
  local_admin: new Set([
    // All fields for admins
    'id',
    'trainee_id',
    'program_id',
    'status',
    'enrollment_date',
    'created_at',
    'updated_at',
    'trainee_email',
    'trainee_first_name',
    'trainee_last_name',
    'trainee_phone',
    'admin_notes',
    'admin_flags',
    'is_flagged_for_review',
    'internal_status',
  ]),
  super_admin: new Set([
    // Super admins see everything
    '*', // Wildcard indicates all fields
  ]),
};

/**
 * Define sensitive fields that require special handling
 */
const SENSITIVE_FIELDS = new Set([
  'trainee_email',
  'trainee_phone',
  'admin_notes',
  'admin_flags',
  'is_flagged_for_review',
  'internal_status',
]);

/**
 * Get visible fields for user role
 *
 * @param role - User role
 * @returns Set of visible field names
 */
export function getVisibleFieldsForRole(role: string): Set<string> {
  return ROLE_FIELD_VISIBILITY[role] || ROLE_FIELD_VISIBILITY.trainee;
}

/**
 * Check if a field is sensitive
 *
 * @param fieldName - Name of field to check
 * @returns True if field is sensitive, false otherwise
 */
export function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELDS.has(fieldName);
}

/**
 * Check if user can view a specific field
 *
 * @param fieldName - Name of field
 * @param userContext - User context with role
 * @param enrollmentTraineeId - ID of trainee in the enrollment (for context)
 * @returns True if user can view field, false otherwise
 */
export function canViewField(
  fieldName: string,
  userContext: UserContext,
  enrollmentTraineeId?: string
): boolean {
  const visibleFields = getVisibleFieldsForRole(userContext.role);

  // Super admin sees everything
  if (visibleFields.has('*')) {
    return true;
  }

  // Check if field is in visible set
  return visibleFields.has(fieldName);
}

/**
 * Filter enrollment data based on user context
 *
 * Removes fields the user is not authorized to see
 *
 * @param enrollment - Full enrollment data
 * @param userContext - User context with role and identity
 * @returns Filtered enrollment data
 */
export function filterEnrollmentFields(
  enrollment: FullEnrollmentData,
  userContext: UserContext
): FilteredEnrollmentData {
  const visibleFields = getVisibleFieldsForRole(userContext.role);
  const filtered: FilteredEnrollmentData = {
    id: enrollment.id,
    trainee_id: enrollment.trainee_id,
    program_id: enrollment.program_id,
    status: enrollment.status,
    enrollment_date: enrollment.enrollment_date,
    created_at: enrollment.created_at,
    updated_at: enrollment.updated_at,
  };

  // Super admin gets all fields
  if (visibleFields.has('*')) {
    return enrollment as FilteredEnrollmentData;
  }

  // Copy only visible fields
  const fieldsArray = Array.from(visibleFields);
  for (const field of fieldsArray) {
    if (field in enrollment && field !== '*') {
      filtered[field] = enrollment[field];
    }
  }

  return filtered;
}

/**
 * Filter multiple enrollment records
 *
 * @param enrollments - Array of enrollments
 * @param userContext - User context
 * @returns Array of filtered enrollments
 */
export function filterEnrollmentArray(
  enrollments: FullEnrollmentData[],
  userContext: UserContext
): FilteredEnrollmentData[] {
  return enrollments.map((enrollment) => filterEnrollmentFields(enrollment, userContext));
}

/**
 * Get audit log entry for field access attempt
 *
 * For security auditing, track when users try to access sensitive fields they're not authorized for
 *
 * @param fieldName - Field that was attempted
 * @param userContext - User trying to access
 * @param enrollmentId - Enrollment being accessed
 * @param allowed - Whether access was allowed
 * @returns Audit log entry data
 */
export function getFieldAccessAuditEntry(
  fieldName: string,
  userContext: UserContext,
  enrollmentId: string,
  allowed: boolean
): Record<string, any> {
  return {
    userId: userContext.userId,
    action: allowed ? 'enrollment_field_accessed' : 'enrollment_field_access_denied',
    entityType: 'enrollment',
    entityId: enrollmentId,
    details: {
      field: fieldName,
      role: userContext.role,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Validate that enrollment data doesn't contain forbidden fields for user
 *
 * Used before sending WebSocket messages to ensure we're not accidentally
 * exposing sensitive data
 *
 * @param enrollment - Enrollment data to validate
 * @param userContext - User context
 * @param strictMode - If true, throw error on forbidden fields; if false, silently filter
 * @returns Object with validation result and any forbidden fields found
 */
export function validateEnrollmentFieldsForUser(
  enrollment: FullEnrollmentData,
  userContext: UserContext,
  strictMode: boolean = false
): { valid: boolean; forbiddenFields?: string[] } {
  const visibleFields = getVisibleFieldsForRole(userContext.role);

  // Super admin can see everything
  if (visibleFields.has('*')) {
    return { valid: true };
  }

  const forbiddenFields: string[] = [];

  // Check each field in enrollment
  for (const field of Object.keys(enrollment)) {
    if (!visibleFields.has(field)) {
      forbiddenFields.push(field);
    }
  }

  if (forbiddenFields.length > 0) {
    if (strictMode) {
      console.warn(
        `[Field Auth] User ${userContext.userId} (${userContext.role}) attempted to access forbidden fields:`,
        forbiddenFields
      );
    }
    return {
      valid: false,
      forbiddenFields,
    };
  }

  return { valid: true };
}

/**
 * Check if trainee is viewing their own enrollment
 *
 * Used to determine if additional leniency can be given
 * (though primary authorization should still be at subscription level)
 *
 * @param enrollmentTraineeId - ID of trainee in enrollment
 * @param userContext - User context
 * @returns True if user is viewing their own enrollment
 */
export function isViewingOwnEnrollment(
  enrollmentTraineeId: string,
  userContext: UserContext
): boolean {
  return (
    userContext.role === 'trainee' && enrollmentTraineeId === userContext.traineeId
  );
}

/**
 * Get field access level for specific field
 *
 * Returns the minimum role required to view a field
 *
 * @param fieldName - Field name to check
 * @returns Minimum role required ('trainee', 'staff_training_coordinator', 'local_admin', 'super_admin', or 'forbidden')
 */
export function getFieldAccessLevel(fieldName: string): string {
  // Check each role in hierarchy
  const roles = ['trainee', 'staff_inventory_manager', 'staff_training_coordinator', 'local_admin', 'super_admin'];

  for (const role of roles) {
    const visibleFields = ROLE_FIELD_VISIBILITY[role];
    if (visibleFields && (visibleFields.has('*') || visibleFields.has(fieldName))) {
      return role;
    }
  }

  return 'forbidden';
}
