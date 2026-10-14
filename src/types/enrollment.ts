/**
 * Enrollment Response Interface
 * 
 * Represents enrollment metadata returned by GET /api/trainees/me/enrollments.
 * This interface contains only enrollment-specific data, not program details.
 * 
 * Validates: Requirements 1.3, 5.1, 5.3
 */
export interface EnrollmentResponse {
  /** UUID of the enrollment record */
  id: string;

  /** UUID of the program this enrollment is for */
  program_id: string;

  /** Status of the enrollment: one of 'enrolled', 'active', 'completed', 'dropped', or 'failed' */
  status: 'enrolled' | 'active' | 'completed' | 'dropped' | 'failed';

  /** Source of the enrollment: 'social_share', 'direct', or 'admin_assigned' */
  source: 'social_share' | 'direct' | 'admin_assigned';

  /** ISO 8601 date (YYYY-MM-DD) when the trainee was enrolled */
  enrollment_date: string;

  /** ISO 8601 date (YYYY-MM-DD) when the trainee completed the program, or null if not completed */
  completed_date: string | null;
}

/**
 * Program Response Interface
 * 
 * Represents program details returned by GET /api/trainees/me/programs.
 * Includes program information along with the trainee's enrollment status for that program.
 * 
 * Validates: Requirements 2.3, 5.1, 5.3
 */
export interface ProgramResponse {
  /** UUID of the program */
  id: string;

  /** Name of the program */
  name: string;

  /** Description of the program, or null if not provided */
  description: string | null;

  /** ISO 8601 date (YYYY-MM-DD) when the program starts */
  start_date: string;

  /** ISO 8601 date (YYYY-MM-DD) when the program ends */
  end_date: string;

  /** Status of the program: one of 'active', 'completed', 'upcoming', or 'cancelled' */
  status: 'active' | 'completed' | 'upcoming' | 'cancelled';

  /** Name of the instructor for this program, or null if not assigned */
  instructor: string | null;

  /** Enrollment status from the trainee's perspective: one of 'enrolled', 'active', 'completed', 'dropped', or 'failed' */
  enrollment_status: 'enrolled' | 'active' | 'completed' | 'dropped' | 'failed';
}

/**
 * Enrollment Data Interface
 * 
 * Represents enrollment data used in the frontend, particularly in TraineeProgramsPage.
 * This interface transforms the API response into a format suitable for frontend state management,
 * converting ISO 8601 date strings to Date objects and deriving boolean flags.
 * 
 * Validates: Requirements 3.4, 3.5, 5.1
 */
export interface EnrollmentData {
  /** UUID of the program */
  programId: string;

  /** Boolean flag indicating if the trainee is enrolled in this program */
  isEnrolled: boolean;

  /** Enrollment status from the trainee's perspective */
  enrollmentStatus: string;

  /** Date object for when the trainee enrolled, or undefined if not available */
  enrollmentDate?: Date;

  /** Date object for when the trainee graduated/completed, or undefined if not completed */
  graduatedDate?: Date;
}
