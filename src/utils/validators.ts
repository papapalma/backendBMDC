import { z } from 'zod';

// Authentication validators
export const loginSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .toLowerCase()
    .trim(),
  password: z.string()
    .min(6, 'Password must be at least 6 characters')
    .max(100, 'Password must not exceed 100 characters'),
});

export const registerSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must not exceed 255 characters')
    .toLowerCase()
    .trim(),
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(100, 'Username must not exceed 100 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, hyphens, and underscores')
    .trim(),
  password: z.string()
    .min(6, 'Password must be at least 6 characters')
    .max(100, 'Password must not exceed 100 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  // Role is accepted here only because this endpoint is admin-only (see register/route.ts)
  role: z.enum(['local_admin', 'staff_training_coordinator', 'staff_inventory_manager', 'trainee']).optional().default('staff_inventory_manager'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must not exceed 255 characters')
    .toLowerCase()
    .trim(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20, 'Reset token is required'),
  newPassword: z.string()
    .min(6, 'New password must be at least 6 characters')
    .max(100, 'New password must not exceed 100 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, 'New password must contain at least one uppercase letter, one lowercase letter, and one number'),
});

export const passwordResetRequestDecisionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().max(1000, 'Notes must not exceed 1000 characters').optional(),
});

// Item validators
export const createItemSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(255, 'Name must not exceed 255 characters')
    .trim(),
  description: z.string()
    .max(1000, 'Description must not exceed 1000 characters')
    .trim()
    .optional(),
  category: z.string()
    .min(1, 'Category is required')
    .max(100, 'Category must not exceed 100 characters'),
  quantity: z.number()
    .int('Quantity must be a whole number')
    .min(0, 'Quantity must be non-negative')
    .max(999999, 'Quantity must not exceed 999,999'),
  unit: z.string()
    .min(1, 'Unit is required')
    .max(50, 'Unit must not exceed 50 characters'),
  location: z.string()
    .min(1, 'Location is required')
    .max(255, 'Location must not exceed 255 characters'),
  minimum_quantity: z.number()
    .int('Minimum quantity must be a whole number')
    .min(0, 'Minimum quantity must be non-negative')
    .max(999999, 'Minimum quantity must not exceed 999,999')
    .optional()
    .default(10),
  purchase_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Purchase date must be in YYYY-MM-DD format')
    .or(z.literal('').transform(() => null))
    .optional()
    .nullable(),
  condition: z.enum(['New', 'Good', 'Fair', 'Poor', 'Damaged'])
    .or(z.literal('').transform(() => null))
    .optional()
    .nullable(),
  image_path: z.string().optional().nullable(),
  qr_code_path: z.string().optional().nullable(),
});

export const updateItemSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(255, 'Name must not exceed 255 characters')
    .trim()
    .optional(),
  description: z.string()
    .max(1000, 'Description must not exceed 1000 characters')
    .trim()
    .optional(),
  category: z.string()
    .min(1, 'Category is required')
    .max(100, 'Category must not exceed 100 characters')
    .optional(),
  quantity: z.number()
    .int('Quantity must be a whole number')
    .min(0, 'Quantity must be non-negative')
    .max(999999, 'Quantity must not exceed 999,999')
    .optional(),
  unit: z.string()
    .min(1, 'Unit is required')
    .max(50, 'Unit must not exceed 50 characters')
    .optional(),
  location: z.string()
    .min(1, 'Location is required')
    .max(255, 'Location must not exceed 255 characters')
    .optional(),
  minimum_quantity: z.number()
    .int('Minimum quantity must be a whole number')
    .min(0, 'Minimum quantity must be non-negative')
    .max(999999, 'Minimum quantity must not exceed 999,999')
    .optional(),
  purchase_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Purchase date must be in YYYY-MM-DD format')
    .or(z.literal('').transform(() => null))
    .optional()
    .nullable(),
  condition: z.enum(['New', 'Good', 'Fair', 'Poor', 'Damaged'])
    .or(z.literal('').transform(() => null))
    .optional()
    .nullable(),
  image_path: z.string().optional().nullable(),
  qr_code_path: z.string().optional().nullable(),
}).partial();

// Trainee validators
export const createTraineeSchema = z.object({
  first_name: z.string()
    .min(1, 'First name is required')
    .max(100, 'First name must not exceed 100 characters')
    .regex(/^[a-zA-Z\s'-]+$/, 'First name can only contain letters, spaces, hyphens, and apostrophes'),
  last_name: z.string()
    .min(1, 'Last name is required')
    .max(100, 'Last name must not exceed 100 characters')
    .regex(/^[a-zA-Z\s'-]+$/, 'Last name can only contain letters, spaces, hyphens, and apostrophes'),
  middle_name: z.string().min(1, 'Middle name is required').max(100, 'Middle name must not exceed 100 characters'),
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must not exceed 255 characters')
    .toLowerCase(),
  phone: z.string()
    .min(10, 'Phone number must be at least 10 characters')
    .max(20, 'Phone number must not exceed 20 characters')
    .regex(/^[0-9+\-\s()]+$/, 'Phone number can only contain digits, +, -, spaces, and parentheses'),
  sex: z.preprocess(
    val => typeof val === 'string' ? val.charAt(0).toUpperCase() + val.slice(1).toLowerCase() : val,
    z.enum(['Male', 'Female'], { required_error: 'Sex is required' })
  ),
  birth_date: z.string().min(1, 'Birth date is required'),
  birth_place: z.string().min(1, 'Birth place is required').max(255, 'Birth place must not exceed 255 characters'),
  civil_status: z.preprocess(
    val => typeof val === 'string' ? val.charAt(0).toUpperCase() + val.slice(1).toLowerCase() : val,
    z.enum(['Single', 'Married', 'Widowed', 'Separated'], { required_error: 'Civil status is required' })
  ),
  province: z.string().min(1, 'Province is required').max(100, 'Province must not exceed 100 characters'),
  municipality: z.string().min(1, 'Municipality is required').max(100, 'Municipality must not exceed 100 characters'),
  barangay: z.string().min(1, 'Barangay is required').max(100, 'Barangay must not exceed 100 characters'),
  street: z.string().min(1, 'Street is required'),
  educational_attainment: z.enum(['Elementary', 'High School', 'Senior High School', 'Vocational', 'College', 'Post Graduate'], { required_error: 'Educational attainment is required' }),
  course: z.string().min(1, 'Course is required').max(255, 'Course must not exceed 255 characters'),
  year_graduated: z.string().min(4, 'Year graduated is required').max(4, 'Year must be 4 digits').regex(/^\d{4}$/, 'Year must be a 4-digit number'),
  classification: z.enum(['Out-of-School Youth', 'Student', 'Unemployed', 'Underemployed', '4Ps Beneficiary'], { required_error: 'Classification is required' }),
  disability: z.string().max(255).optional().nullable().transform(val => val === '' ? null : val),
  employment_status: z.enum(['Employed', 'Unemployed', 'Self-employed', 'Student'], { required_error: 'Employment status is required' }),
  status: z.enum(['active', 'inactive', 'completed', 'dropped']).optional().nullable(),
  program_id: z.string().uuid('Invalid program ID').optional().nullable(),
  photo_path: z.string().optional().nullable(),
  qr_code_path: z.string().optional().nullable(),
  enrollment_date: z.string().datetime().optional(),
  emergency_contact_name: z.string().max(255).optional().nullable(),
  emergency_contact_phone: z.string().max(50).optional().nullable(),
});

export const updateTraineeSchema = createTraineeSchema.partial();

// Program validators
const baseProgramSchema = z.object({
  name: z.string()
    .min(1, 'Name is required')
    .max(255, 'Name must not exceed 255 characters')
    .trim(),
  description: z.string()
    .max(2000, 'Description must not exceed 2000 characters')
    .trim()
    .optional(),
  duration_weeks: z.number()
    .int('Duration must be a whole number')
    .min(1, 'Duration must be at least 1 week')
    .max(520, 'Duration must not exceed 10 years (520 weeks)'),
  start_date: z.string().datetime('Invalid start date format'),
  end_date: z.string().datetime('Invalid end date format'),
  max_trainees: z.number()
    .int('Max trainees must be a whole number')
    .min(1, 'Max trainees must be at least 1')
    .max(1000, 'Max trainees must not exceed 1000')
    .optional(),
  image_path: z.string().optional().nullable(),
  instructor: z.string().max(255, 'Instructor name must not exceed 255 characters').trim().optional().nullable(),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced', 'All Levels']).optional().nullable(),
  status: z.enum(['active', 'completed', 'upcoming', 'cancelled']).optional().nullable(),
  enrollment_limit: z.number()
    .int('Enrollment limit must be a whole number')
    .min(1, 'Enrollment limit must be at least 1')
    .max(10000, 'Enrollment limit must not exceed 10,000'),
});

export const createProgramSchema = baseProgramSchema.refine(
  (data) => new Date(data.end_date) > new Date(data.start_date),
  { message: 'End date must be after start date', path: ['end_date'] }
);

export const updateProgramSchema = baseProgramSchema.partial();

// Lending validators
export const createLendingSchema = z.object({
  trainee_id: z.string().uuid('Invalid trainee ID').optional(),
  borrower_name: z.string().min(1).max(255).trim().optional(),
  borrower_contact: z.string().max(100).trim().optional(),
  item_id: z.string().uuid('Invalid item ID'),
  quantity: z.number()
    .int('Quantity must be a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(1000, 'Quantity must not exceed 1000'),
  expected_return_date: z.string().refine(
    (date) => !isNaN(Date.parse(date)),
    { message: 'Invalid expected return date' }
  ),
  notes: z.string()
    .max(1000, 'Notes must not exceed 1000 characters')
    .trim()
    .optional(),
}).refine(
  (data) => data.trainee_id !== undefined || (data.borrower_name !== undefined && data.borrower_name.length > 0),
  { message: 'Either trainee_id or borrower_name must be provided', path: ['trainee_id'] }
);

export const returnLendingSchema = z.object({
  notes: z.string().optional(),
});

// Anomaly validators
export const resolveAnomalySchema = z.object({
  resolution_notes: z.string().min(1, 'Resolution notes are required'),
  resolution_type: z.enum(['auto_fix', 'manual', 'dismiss']).optional().default('manual'),
  status: z.enum(['resolved', 'dismissed']).optional(),
});

const anomalyCategorySchema = z.enum(['trainee', 'inventory', 'lending', 'program', 'activity_log', 'system']);

export const updateDetectionConfigSchema = z.object({
  config_key: z.string().min(1).max(100).optional().default('default'),
  config_value: z.record(z.unknown()).optional(),
  description: z.string().max(1000).optional().nullable(),
});

export const anomalyExportSchema = z.object({
  ids: z.array(z.string().uuid('Invalid anomaly ID')).optional(),
  filters: z.object({
    type: z.string().optional(),
    category: z.union([z.string(), z.array(z.string())]).optional(),
    severity: z.union([z.string(), z.array(z.string())]).optional(),
    status: z.union([z.string(), z.array(z.string())]).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    search: z.string().optional(),
    entityType: z.string().optional(),
    entityId: z.string().uuid('Invalid entity ID').optional(),
  }).optional(),
});

export const dismissBulkAnomaliesSchema = z.object({
  ids: z.array(z.string().uuid('Invalid anomaly ID')).min(1, 'At least one anomaly ID is required'),
  reason: z.string().min(1, 'Dismiss reason is required').max(1000, 'Dismiss reason must not exceed 1000 characters'),
});

export const autoResolveAnomaliesSchema = z.object({
  category: anomalyCategorySchema.optional(),
  olderThanDays: z.number().int().min(1).max(365).optional(),
});

// Pagination validators
export const paginationSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(10),
});

// Filter validators
export const dateRangeSchema = z.object({
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
});

export const reportFiltersSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  module: z.string().optional(),
  format: z.enum(['json', 'csv', 'pdf']).optional(),
});

export const comprehensiveReportSchema = reportFiltersSchema.optional();

export const scheduleReportSchema = z.object({
  reportType: z.string().min(1, 'Report type is required').max(100),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  recipients: z.array(z.string().email('Recipient must be a valid email')).min(1, 'At least one recipient is required'),
  format: z.enum(['pdf', 'csv']).default('pdf'),
  filters: reportFiltersSchema.optional(),
  isActive: z.boolean().optional().default(true),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type PasswordResetRequestDecisionInput = z.infer<typeof passwordResetRequestDecisionSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type CreateTraineeInput = z.infer<typeof createTraineeSchema>;
export type UpdateTraineeInput = z.infer<typeof updateTraineeSchema>;
export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;
export type CreateLendingInput = z.infer<typeof createLendingSchema>;
export type ReturnLendingInput = z.infer<typeof returnLendingSchema>;
export type ResolveAnomalyInput = z.infer<typeof resolveAnomalySchema>;
export type UpdateDetectionConfigInput = z.infer<typeof updateDetectionConfigSchema>;
export type AnomalyExportInput = z.infer<typeof anomalyExportSchema>;
export type DismissBulkAnomaliesInput = z.infer<typeof dismissBulkAnomaliesSchema>;
export type AutoResolveAnomaliesInput = z.infer<typeof autoResolveAnomaliesSchema>;
export type ReportFiltersInput = z.infer<typeof reportFiltersSchema>;
export type ComprehensiveReportInput = z.infer<typeof comprehensiveReportSchema>;
export type ScheduleReportInput = z.infer<typeof scheduleReportSchema>;

// ============================================================================
// 2FA & EMAIL VERIFICATION SCHEMAS
// ============================================================================

/**
 * OTP Code validation (6 digits, no letters)
 */
export const otpCodeSchema = z.object({
  code: z.string()
    .regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
});

/**
 * Verify email during signup (trainee registration)
 */
export const verifyEmailSignupSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must not exceed 255 characters')
    .toLowerCase()
    .trim(),
  otp: z.string()
    .regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
});

/**
 * Verify login 2FA (admin users)
 */
export const verifyLogin2FASchema = z.object({
  otp: z.string()
    .regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
  tempToken: z.string()
    .min(20, 'Invalid temporary token'),
});

/**
 * Request password reset
 */
export const requestPasswordResetSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must not exceed 255 characters')
    .toLowerCase()
    .trim(),
});

/**
 * Verify password reset OTP (first OTP)
 */
export const verifyPasswordResetOTPSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must not exceed 255 characters')
    .toLowerCase()
    .trim(),
  otp: z.string()
    .regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
});

/**
 * Complete password reset (double OTP verification + new password)
 */
export const completePasswordResetSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must not exceed 255 characters')
    .toLowerCase()
    .trim(),
  otp: z.string()
    .regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
  newPassword: z.string()
    .min(10, 'Password must be at least 10 characters')
    .max(100, 'Password must not exceed 100 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/\d/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, 'Password must contain at least one special character'),
  resetToken: z.string()
    .min(20, 'Invalid reset token'),
});

/**
 * Change password (current password + new password + confirmation)
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string()
    .min(1, 'Current password is required'),
  newPassword: z.string()
    .min(10, 'New password must be at least 10 characters')
    .max(100, 'New password must not exceed 100 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/\d/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, 'Password must contain at least one special character'),
  confirmPassword: z.string()
    .min(1, 'Please confirm your new password'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'New passwords do not match',
  path: ['confirmPassword'],
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: 'New password must be different from current password',
  path: ['newPassword'],
});

/**
 * Updated register schema with email verification requirement
 */
export const registerWithEmailVerificationSchema = registerSchema.extend({
  // Inherits all fields from registerSchema
  // Email verification OTP can be optional during initial registration,
  // verified in separate /verify-email-signup endpoint
});

/**
 * Login schema with email verification check (already exists as loginSchema)
 * No changes needed - verification happens in middleware
 */
export const loginWithEmailVerificationSchema = loginSchema.extend({
  // Inherits email and password from loginSchema
  // Email verification is checked during login flow
});

// Trainee self-registration schema (public - no auth required)
export const traineeRegistrationSchema = z.object({
  // Account credentials
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(100, 'Username must not exceed 100 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, hyphens, and underscores')
    .trim(),
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must not exceed 255 characters')
    .toLowerCase()
    .trim(),
  password: z.string()
    .min(0)  // Allow empty string (for existing trainees applying to programs)
    .max(100, 'Password must not exceed 100 characters')
    .refine(
      (val) => val === '' || /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/.test(val),
      'Password must contain uppercase, lowercase, and a number'
    ),

  // Personal info
  first_name: z.string().min(1, 'First name is required').max(100).regex(/^[a-zA-Z\s'-]+$/),
  last_name: z.string().min(1, 'Last name is required').max(100).regex(/^[a-zA-Z\s'-]+$/),
  middle_name: z.string().max(100).optional().default(''),
  phone: z.string().min(10).max(20).regex(/^[0-9+\-\s()]+$/),
  sex: z.preprocess(
    val => typeof val === 'string' ? val.charAt(0).toUpperCase() + val.slice(1).toLowerCase() : val,
    z.enum(['Male', 'Female'])
  ),
  birth_date: z.string().min(1, 'Birth date is required'),
  birth_place: z.string().min(1).max(255),
  civil_status: z.preprocess(
    val => typeof val === 'string' ? val.charAt(0).toUpperCase() + val.slice(1).toLowerCase() : val,
    z.enum(['Single', 'Married', 'Widowed', 'Separated'])
  ),
  province: z.string().min(1).max(100),
  municipality: z.string().min(1).max(100),
  barangay: z.string().min(1).max(100),
  street: z.string().min(1),
  educational_attainment: z.enum(['Elementary', 'High School', 'Senior High School', 'Vocational', 'College', 'Post Graduate']),
  course: z.string()
    .max(255)
    .refine(
      (val) => val === '' || val.length >= 1,
      'Course must be valid if provided'
    )
    .optional()
    .default(''),
  year_graduated: z.string()
    .refine(
      (val) => val === '' || (val.length === 4 && /^\d{4}$/.test(val)),
      'Year graduated must be a 4-digit year or empty'
    )
    .optional()
    .default(''),
  classification: z.enum(['Out-of-School Youth', 'Student', 'Unemployed', 'Underemployed', '4Ps Beneficiary']),
  disability: z.string().max(255).optional().nullable().transform(v => v === '' ? null : v),
  employment_status: z.enum(['Employed', 'Unemployed', 'Self-employed', 'Student']),

  // Program to enroll in
  program_id: z.string().uuid('Invalid program ID'),

  // Tenant selection (required - must be selected before registration)
  tenant_id: z.string().uuid('Invalid tenant ID'),
});

export const reviewRegistrationSchema = z.object({
  action: z.enum(['approve', 'reject']),
  rejection_reason: z.string().max(1000).optional(),
});

export type TraineeRegistrationInput = z.infer<typeof traineeRegistrationSchema>;
export type ReviewRegistrationInput = z.infer<typeof reviewRegistrationSchema>;

// 2FA & Email verification types
export type OTPCodeInput = z.infer<typeof otpCodeSchema>;
export type VerifyEmailSignupInput = z.infer<typeof verifyEmailSignupSchema>;
export type VerifyLogin2FAInput = z.infer<typeof verifyLogin2FASchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type VerifyPasswordResetOTPInput = z.infer<typeof verifyPasswordResetOTPSchema>;
export type CompletePasswordResetInput = z.infer<typeof completePasswordResetSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type RegisterWithEmailVerificationInput = z.infer<typeof registerWithEmailVerificationSchema>;
export type LoginWithEmailVerificationInput = z.infer<typeof loginWithEmailVerificationSchema>;

