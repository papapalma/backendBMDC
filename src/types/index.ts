export interface User {
  id: string;
  auth_user_id?: string | null;
  email: string;
  username: string;
  role: 'super_admin' | 'local_admin' | 'staff_training_coordinator' | 'staff_inventory_manager' | 'trainee';
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: string;
  name: string;
  description: string;
  category: string;
  quantity: number;
  available_quantity: number;
  unit: string;
  location: string;
  qr_code: string;
  image_path?: string;
  thumbnail_path?: string;
  qr_code_path?: string;
  status: 'available' | 'low_stock' | 'out_of_stock' | 'maintenance';
  minimum_quantity: number;
  purchase_date?: string;
  condition?: 'New' | 'Good' | 'Fair' | 'Poor' | 'Damaged';
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface Trainee {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  email: string;
  phone: string;
  sex: 'Male' | 'Female';
  birth_date: string;
  birth_place: string;
  civil_status: 'Single' | 'Married' | 'Widowed' | 'Separated';
  province: string;
  municipality: string;
  barangay: string;
  street: string;
  educational_attainment: 'Elementary' | 'High School' | 'Senior High School' | 'Vocational' | 'College' | 'Post Graduate';
  course: string;
  year_graduated: string;
  classification: 'Out-of-School Youth' | 'Student' | 'Unemployed' | 'Underemployed' | '4Ps Beneficiary';
  disability?: string | null;
  employment_status: 'Employed' | 'Unemployed' | 'Self-employed' | 'Student';
  /** @deprecated Use enrollments table to get program enrollment. This field is denormalized and no longer updated. */
  program_id?: string | null;
  qr_code: string;
  photo_path?: string | null;
  thumbnail_path?: string;
  qr_code_path?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  status: 'active' | 'inactive' | 'completed' | 'dropped';
  /** @deprecated Use enrollments table to get enrollment date. This field is denormalized and no longer updated. */
  enrollment_date?: string | null;
  created_at: string;
  updated_at: string;
  // Registration status fields (from pending_registrations merge)
  registration_status?: 'pending' | 'approved' | 'rejected' | 'completed';
  registration_rejection_reason?: string | null;
  registration_reviewed_by?: string | null;
  registration_reviewed_at?: string | null;
  // Soft delete fields
  deleted_at?: string | null;
}

export interface Program {
  id: string;
  name: string;
  description: string;
  duration_weeks: number;
  start_date: string;
  end_date: string;
  status: 'active' | 'completed' | 'upcoming' | 'cancelled';
  max_trainees: number;
  enrollment_limit?: number | null;
  current_enrollment?: number;
  instructor?: string | null;
  image_path?: string;
  thumbnail_path?: string;
  tenant_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Lending {
  id: string;
  item_id: string;
  trainee_id?: string;
  borrower_name?: string;
  borrower_contact?: string;
  quantity: number;
  lent_date: string;
  expected_return_date: string;
  actual_return_date?: string;
  status: 'active' | 'returned' | 'overdue' | 'lost';
  notes?: string;
  lent_by?: string;
  returned_by?: string;
  created_at: string;
  updated_at: string;
  // Joined relations
  item?: Item;
  trainee?: Trainee;
}

export interface Anomaly {
  id: string;
  tenant_id?: string;
  category: 'trainee' | 'inventory' | 'lending' | 'program' | 'activity_log' | 'system';
  anomaly_type: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed';
  description: string;
  recommendation?: string;
  detection_logic?: string;
  entity_type?: string;
  entity_id?: string;
  entity_identifier?: string;
  metadata?: Record<string, any>;
  auto_resolved: boolean;
  occurrence_count: number;
  first_occurrence_at?: string;
  last_occurrence_at?: string;
  detection_run_id?: string;
  detected_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details?: any;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type UserRole =
  | 'super_admin'
  | 'local_admin'
  | 'staff_training_coordinator'
  | 'staff_inventory_manager'
  | 'trainee';

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole | string;
  /** Tenant identifier — required for all tenant-scoped operations (Req 6.3) */
  tenantId: string;
  /** JWT ID for token revocation tracking (Req 6.3) */
  jti: string;
  iat?: number;
  exp?: number;
}

export interface PendingRegistration {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  phone: string;
  sex: 'Male' | 'Female';
  birth_date: string;
  birth_place: string;
  civil_status: 'Single' | 'Married' | 'Widowed' | 'Separated';
  province: string;
  municipality: string;
  barangay: string;
  street: string;
  educational_attainment: string;
  course: string;
  year_graduated: string;
  classification: string;
  disability?: string | null;
  employment_status: string;
  program_id: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  program?: Program;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  role?: 'staff' | 'viewer';
}

// ============================================================================
// 3NF NORMALIZED SCHEMA INTERFACES
// Added to support Normalize_full_schema.sql integration (replaces denormalized tables/JSONB)
// ============================================================================

/**
 * Enrollment: Tracks trainee enrollment in programs (3NF normalized)
 * Replaces: trainees.program_id denormalization
 */
export interface Enrollment {
  id: string;
  tenant_id: string;
  trainee_id: string;
  program_id: string;
  enrollment_date: string; // DATE format (YYYY-MM-DD)
  completion_date?: string | null;
  status: 'enrolled' | 'active' | 'completed' | 'dropped' | 'failed';
  source: 'social_share' | 'direct' | 'admin_assigned';
  final_grade?: number | null;
  created_at: string;
  updated_at: string;
  // Joined relations
  trainee?: Trainee;
  program?: Program;
}

/**
 * TraineeNotificationPreferences: Trainee-level notification settings (3NF normalized)
 * Replaces: trainees.notification_preferences JSONB
 */
export interface TraineeNotificationPreferences {
  id: string;
  tenant_id: string;
  trainee_id: string;
  email_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  in_app_enabled: boolean;
  weekly_digest: boolean;
  event_reminders: boolean;
  enrollment_updates: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * TenantBranding: Tenant-level branding configuration (3NF normalized)
 * Replaces: tenants.configuration.branding JSONB
 */
export interface TenantBranding {
  id: string;
  tenant_id: string;
  logo_url?: string | null;
  primary_color: string; // Hex color (default: #007bff)
  secondary_color: string; // Hex color (default: #6c757d)
  welcome_message?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * TenantNotificationChannel: Tenant-level notification channel configuration (3NF normalized)
 * Replaces: tenants.configuration.notifications JSONB
 */
export interface TenantNotificationChannel {
  id: string;
  tenant_id: string;
  channel_type: 'email' | 'sms' | 'push' | 'whatsapp';
  is_enabled: boolean;
  configuration: Record<string, any>; // JSONB with channel-specific settings
  created_at: string;
  updated_at: string;
}

/**
 * TenantFeatures: Tenant-level feature flags (3NF normalized)
 * Replaces: tenants.configuration.features JSONB
 */
export interface TenantFeatures {
  id: string;
  tenant_id: string;
  feature_name: 'inventory_management' | 'certificate_generation' | 'qr_code_attendance' | 'mobile_app_access' | 'advanced_analytics' | 'api_access';
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * AttendanceException: Unified attendance exceptions table (3NF normalized)
 * Replaces: non_attendance_dates + attendance_schedule_overrides tables
 * Covers: holidays, no-attendance days, schedule overrides, makeup sessions
 */
export interface AttendanceException {
  id: string;
  tenant_id: string;
  exception_type: 'no_attendance_day' | 'schedule_override' | 'makeup_session' | 'holiday';
  program_id?: string | null;
  trainee_id?: string | null;
  exception_date: string; // DATE format (YYYY-MM-DD)
  exception_start_time?: string | null; // TIME format (HH:MM:SS)
  exception_end_time?: string | null; // TIME format (HH:MM:SS)
  reason?: string | null;
  /** Custom morning open time for schedule override */
  custom_morning_open?: string | null;
  /** Custom morning close time for schedule override */
  custom_morning_close?: string | null;
  /** Custom afternoon open time for schedule override */
  custom_afternoon_open?: string | null;
  /** Custom afternoon close time for schedule override */
  custom_afternoon_close?: string | null;
  /** True if this is a full-day off (for schedule override) */
  is_full_day_off?: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Certificate: Training completion certificate (3NF normalized)
 * Generated after successful program completion
 */
export interface Certificate {
  id: string;
  tenant_id: string;
  enrollment_id: string;
  certificate_number: string;
  issue_date: string; // DATE format (YYYY-MM-DD)
  file_path: string;
  qr_code: string;
  qr_code_path?: string | null;
  verification_url?: string | null;
  signatory_name?: string | null;
  signatory_title?: string | null;
  created_at: string;
  updated_at: string;
  // Joined relations
  enrollment?: Enrollment;
}

// Re-export enrollment types for convenience
export type { EnrollmentResponse, ProgramResponse, EnrollmentData } from './enrollment';

// Re-export program sharing types for convenience
export type {
  OpenGraphMetadata,
  ShareableLink,
  ProgramLink,
  LinkValidationResult,
  ProgramAccessResult,
  ShareLinkGenerationRequest,
  ShareLinkValidationRequest,
  ProgramEnrollmentRequest,
  EnrollmentResponse as SocialEnrollmentResponse,
  GeneratedLink,
  LinkClickEvent,
  ShareLinkGenerationResponse,
  LinkValidationResponse,
  ProgramAccessResponse,
  EnrollmentSuccessResponse,
  SocialSharingErrorResponse,
  ValidationError,
  ProgramDetailsForSharing,
  LocalStorageProgramData,
  LinkGenerationConfig,
} from './programSharing';
