/**
 * Program Sharing Feature Types
 * 
 * Defines interfaces and types for the social program sharing feature.
 * Includes program links, validation results, and API response types.
 * 
 * Requirements Addressed: 1.1, 1.2, 1.3, 2.1
 */

/**
 * OpenGraphMetadata interface for social media previews
 * Used when sharing program links on social platforms
 */
export interface OpenGraphMetadata {
  /** OG title for social media preview */
  title: string;
  
  /** OG description for social media preview */
  description: string;
  
  /** OG image URL for social media preview (optional) */
  image?: string;
  
  /** OG URL - the shareable link itself */
  url: string;
  
  /** OG type (always 'website' for program sharing) */
  type?: string;
}

/**
 * ShareableLink interface representing a shareable program link
 * Contains all information needed to share a program and handle its click
 */
export interface ShareableLink {
  /** The full shareable URL containing program_id query parameter */
  url: string;
  
  /** The program ID (UUID) being shared */
  programId: string;
  
  /** ISO8601 timestamp when the link was generated */
  generatedAt: string;
  
  /** ISO8601 timestamp when the link expires (optional - if time-limited) */
  expiresAt?: string;
  
  /** Open Graph metadata for social media previews */
  og: OpenGraphMetadata;
}

/**
 * ProgramLink interface for API response
 * Represents a generated shareable link for a program
 */
export interface ProgramLink {
  /** The program ID (UUID) */
  programId: string;
  
  /** The full shareable URL */
  url: string;
  
  /** The program name (for admin reference) */
  programName: string;
  
  /** When the link was generated */
  generatedAt: string;
}

/**
 * LinkValidationResult interface for validation responses
 * Indicates whether a program link is valid and accessible
 */
export interface LinkValidationResult {
  /** Whether the program link and referenced program are valid */
  isValid: boolean;
  
  /** Whether the program is currently active */
  isActive?: boolean;
  
  /** Whether the program is open for public enrollment */
  isPublic?: boolean;
  
  /** Basic program information if valid (optional) */
  program?: {
    id: string;
    name: string;
    description?: string;
  };
  
  /** Error message if validation failed (optional) */
  error?: string;
  
  /** Additional details about validation failure */
  reason?: string;
}

/**
 * ProgramAccessResult interface for access verification
 * Indicates whether a user has permission to access/enroll in a program
 */
export interface ProgramAccessResult {
  /** Whether the user can access this program */
  canAccess: boolean;
  
  /** Whether the user has already enrolled in this program */
  hasEnrolled?: boolean;
  
  /** Whether the user can view program details */
  canView?: boolean;
  
  /** Whether the user can enroll in this program */
  canEnroll?: boolean;
  
  /** Additional information about access restrictions */
  reason?: string;
  
  /** Prerequisites that need to be met (optional) */
  prerequisites?: string[];
}

/**
 * ShareLinkGenerationRequest interface for API requests
 * Used when generating a shareable link for a program
 */
export interface ShareLinkGenerationRequest {
  /** The program ID to generate a link for */
  programId: string;
  
  /** Optional campaign/tracking identifier */
  campaignId?: string;
  
  /** Optional UTM source (e.g., 'facebook', 'twitter') */
  utmSource?: string;
  
  /** Optional UTM medium (typically 'social') */
  utmMedium?: string;
  
  /** Optional UTM campaign identifier */
  utmCampaign?: string;
}

/**
 * ShareLinkValidationRequest interface for API requests
 * Used when validating a program share link
 */
export interface ShareLinkValidationRequest {
  /** The program ID to validate */
  programId: string;
  
  /** Optional: The user ID for permission checking */
  userId?: string;
  
  /** Optional: The trainee ID for permission checking */
  traineeId?: string;
}

/**
 * ProgramEnrollmentRequest interface for API requests
 * Modified to include enrollment source for tracking
 */
export interface ProgramEnrollmentRequest {
  /** The trainee ID performing the enrollment */
  traineeId: string;
  
  /** The program ID to enroll in */
  programId: string;
  
  /** Source of the enrollment (social_share, direct, admin_assigned) */
  source: 'social_share' | 'direct' | 'admin_assigned';
  
  /** Optional enrollment notes */
  notes?: string;
}

/**
 * EnrollmentResponse interface for API responses
 * Indicates successful enrollment with tracking information
 */
export interface EnrollmentResponse {
  /** The enrollment ID (UUID) */
  id: string;
  
  /** The trainee ID */
  traineeId: string;
  
  /** The program ID */
  programId: string;
  
  /** Enrollment status */
  status: 'enrolled' | 'pending' | 'active' | 'completed' | 'dropped';
  
  /** ISO8601 enrollment date */
  enrollmentDate: string;
  
  /** Source of enrollment for tracking */
  enrollmentSource: 'social_share' | 'direct' | 'admin_assigned';
}

/**
 * GeneratedLink interface for storing generated links
 * Contains all metadata about a generated shareable link
 */
export interface GeneratedLink {
  /** Unique link ID (UUID) */
  id: string;
  
  /** The program ID */
  programId: string;
  
  /** The full shareable URL */
  url: string;
  
  /** Admin or user who generated the link */
  generatedBy: string;
  
  /** When the link was generated */
  generatedAt: string;
  
  /** Optional expiration timestamp */
  expiresAt?: string;
  
  /** Number of times this link has been accessed/clicked */
  clickCount?: number;
  
  /** Optional metadata for tracking (UTM params, etc.) */
  metadata?: Record<string, any>;
}

/**
 * LinkClickEvent interface for tracking analytics
 * Records when a shared link is clicked
 */
export interface LinkClickEvent {
  /** Event ID (UUID) */
  id: string;
  
  /** The program ID from the clicked link */
  programId: string;
  
  /** Generated link ID (if available) */
  linkId?: string;
  
  /** User agent information */
  userAgent?: string;
  
  /** IP address of the clicker */
  ipAddress?: string;
  
  /** Referrer information */
  referrer?: string;
  
  /** When the link was clicked */
  clickedAt: string;
  
  /** Session ID if user logs in after clicking */
  sessionId?: string;
}

/**
 * API Response wrapper types for type-safe responses
 */

/**
 * Success response for share link generation
 */
export interface ShareLinkGenerationResponse {
  success: true;
  data: ShareableLink;
  message?: string;
}

/**
 * Success response for link validation
 */
export interface LinkValidationResponse {
  success: true;
  data: LinkValidationResult;
  message?: string;
}

/**
 * Success response for program access verification
 */
export interface ProgramAccessResponse {
  success: true;
  data: ProgramAccessResult;
  message?: string;
}

/**
 * Success response for enrollment
 */
export interface EnrollmentSuccessResponse {
  success: true;
  data: EnrollmentResponse;
  message?: string;
}

/**
 * Error response for social program sharing APIs
 */
export interface SocialSharingErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, any>;
}

/**
 * Validation error type for detailed error handling
 */
export interface ValidationError {
  /** Field that failed validation */
  field: string;
  
  /** Error message */
  message: string;
  
  /** Error code for programmatic handling */
  code: string;
}

/**
 * Program details for social sharing
 * Subset of Program with only publicly relevant fields
 */
export interface ProgramDetailsForSharing {
  /** Program ID (UUID) */
  id: string;
  
  /** Program name */
  name: string;
  
  /** Program description */
  description?: string;
  
  /** Program start date */
  startDate: string;
  
  /** Program end date */
  endDate: string;
  
  /** Number of weeks */
  durationWeeks: number;
  
  /** Current enrollment count */
  currentEnrollment?: number;
  
  /** Maximum trainees allowed */
  maxTrainees?: number;
  
  /** Program status */
  status: 'active' | 'completed' | 'upcoming' | 'cancelled';
  
  /** Program image URL (optional) */
  imageUrl?: string;
  
  /** Program thumbnail URL (optional) */
  thumbnailUrl?: string;
  
  /** Instructor name (optional) */
  instructor?: string;
  
  /** Program level (optional) */
  level?: string;
}

/**
 * LocalStorage data structure for program sharing
 * Represents data stored in browser LocalStorage
 */
export interface LocalStorageProgramData {
  /** The selected program ID (UUID) */
  selectedProgramId: string;
  
  /** When the program was selected */
  selectedAt: string;
  
  /** Source of selection (social_share, direct, etc.) */
  source: 'social_share' | 'direct' | 'other';
  
  /** Optional: program metadata for offline access */
  programMetadata?: {
    name: string;
    startDate?: string;
  };
}

/**
 * Configuration for link generation
 */
export interface LinkGenerationConfig {
  /** Base URL for the application */
  baseUrl: string;
  
  /** Path for shared links (default: '/share') */
  sharePath?: string;
  
  /** Query parameter name for program ID (default: 'program_id') */
  paramName?: string;
  
  /** Link expiration time in days (null = never expires) */
  expirationDays?: number | null;
  
  /** Include UTM parameters in generated links */
  includeUTM?: boolean;
}
