/**
 * Step Validation Module
 * 
 * Handles validation for each step of the registration workflow.
 * 
 * Requirements: 1.1, 2.1, 2.2, 2.3, 3.1
 */

/**
 * REQUIRED_FILES constant defines the 6 mandatory training requirement files
 * that must be uploaded for Step 6 validation to pass.
 * 
 * These files are required for training requirement documentation:
 * 1. accomplished_learners_profile_form - Profile documentation
 * 2. birth_certificate_copy - Identity verification
 * 3. id_pictures - Visual identification
 * 4. valid_id_copy - Valid government-issued ID copy
 * 5. report_card_tor_copy - Academic transcript
 * 6. barangay_no_grade_certification - Barangay certification
 * 
 * Optional file (does NOT block validation if missing):
 * - marriage_certificate_copy - Optional documentation
 */
export const REQUIRED_FILES = [
  'accomplished_learners_profile_form',
  'birth_certificate_copy',
  'id_pictures',
  'valid_id_copy',
  'report_card_tor_copy',
  'barangay_no_grade_certification',
] as const;

export type RequirementFileKey = typeof REQUIRED_FILES[number];

/**
 * Type representing the requirementFiles object passed to validation
 */
export interface RequirementFilesState {
  accomplished_learners_profile_form: boolean;
  birth_certificate_copy: boolean;
  id_pictures: boolean;
  valid_id_copy: boolean;
  report_card_tor_copy: boolean;
  barangay_no_grade_certification: boolean;
  marriage_certificate_copy?: boolean; // Optional file
}

/**
 * Validation result returned by validateStep
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a specific step in the registration workflow.
 * 
 * BUGFIX NOTE (Task 3.1):
 * Step 6 validation previously checked the `acknowledgedRequirements` boolean flag,
 * which was incorrect. The fix replaces this with actual file upload validation.
 * 
 * Step 6 now validates that ALL 6 required training requirement files are present
 * in the `requirementFiles` object. The optional marriage_certificate_copy is not
 * required and does not block validation.
 * 
 * @param step - The registration step number (1-8)
 * @param acknowledgedRequirements - Deprecated: no longer used for Step 6 validation
 * @param requirementFiles - Object containing uploaded file status for Step 6
 * @returns ValidationResult with valid flag and optional error message
 * 
 * Requirements Validated:
 * - Req 1.1: Bug condition - all files present but validation blocked
 * - Req 2.1, 2.2, 2.3: Preservation - other steps and incomplete files still validated
 * - Req 3.1: Expected behavior - all 6 required files must be present
 */
export function validateStep(
  step: number,
  acknowledgedRequirements: boolean,
  requirementFiles: RequirementFilesState
): ValidationResult {
  if (step === 6) {
    // FIXED: Check that ALL 6 required files are uploaded
    // Do NOT check acknowledgedRequirements boolean (this was the bug)
    
    const allRequiredFilesPresent = REQUIRED_FILES.every(
      (fileType) => requirementFiles[fileType as RequirementFileKey]
    );

    // Optional marriage certificate should NOT block validation
    if (!allRequiredFilesPresent) {
      // If any required file is missing, return invalid with 'acknowledgment' error
      // (This maintains backward compatibility with existing UI error handling)
      return {
        valid: false,
        error: 'acknowledgment',
      };
    }

    return { valid: true };
  }

  // All other steps (1-5, 7-8) pass validation by default
  // This allows the validation to be extended in the future for other steps
  return { valid: true };
}
