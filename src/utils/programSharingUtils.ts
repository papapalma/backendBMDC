/**
 * Program Sharing Utility Functions
 * 
 * Provides helper functions for link generation, validation, and formatting.
 * Supports the social program sharing feature infrastructure.
 * 
 * Requirements Addressed: 1.1, 1.2, 1.3, 2.1
 */

let uuidv4: () => string;

// Import uuid dynamically to avoid jest issues
try {
  const uuidModule = require('uuid');
  uuidv4 = uuidModule.v4;
} catch {
  // Fallback UUID generator for test environments
  uuidv4 = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
}
import {
  ShareableLink,
  OpenGraphMetadata,
  LinkGenerationConfig,
  LinkValidationResult,
  ProgramDetailsForSharing,
} from '@/types/programSharing';

/**
 * Default configuration for link generation
 */
const DEFAULT_LINK_CONFIG: LinkGenerationConfig = {
  baseUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://bmdc.online',
  sharePath: '/share',
  paramName: 'program_id',
  expirationDays: null, // Links don't expire by default
  includeUTM: true,
};

/**
 * Generates a shareable link for a program
 * 
 * Creates a URL with the program ID as a query parameter and generates
 * Open Graph metadata for social media previews.
 * 
 * @param programId - The program ID (UUID)
 * @param programName - The program name (for OG title)
 * @param programDescription - The program description (for OG description)
 * @param config - Optional custom configuration
 * @returns ShareableLink with URL and OG metadata
 * 
 * @example
 * const link = generateShareableLink(
 *   'a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6',
 *   'Advanced TypeScript Training',
 *   'Learn advanced TypeScript concepts...'
 * );
 */
export function generateShareableLink(
  programId: string,
  programName: string,
  programDescription?: string,
  config?: Partial<LinkGenerationConfig>
): ShareableLink {
  const finalConfig = { ...DEFAULT_LINK_CONFIG, ...config };

  // Validate program ID is a valid UUID
  if (!isValidUUID(programId)) {
    throw new Error(`Invalid program ID: ${programId}`);
  }

  // Construct the shareable URL
  const url = constructShareLink(programId, finalConfig);

  // Generate Open Graph metadata
  const og = generateOpenGraphMetadata(
    programName,
    programDescription,
    url,
    finalConfig
  );

  // Calculate expiration if configured
  let expiresAt: string | undefined;
  if (finalConfig.expirationDays && finalConfig.expirationDays > 0) {
    expiresAt = new Date(
      Date.now() + finalConfig.expirationDays * 24 * 60 * 60 * 1000
    ).toISOString();
  }

  return {
    url,
    programId,
    generatedAt: new Date().toISOString(),
    expiresAt,
    og,
  };
}

/**
 * Constructs a share link URL with the program ID query parameter
 * 
 * @param programId - The program ID to encode in the URL
 * @param config - Link generation configuration
 * @returns The full shareable URL
 */
export function constructShareLink(
  programId: string,
  config: LinkGenerationConfig
): string {
  const baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
  const paramName = config.paramName || 'program_id';

  return `${baseUrl}${config.sharePath || '/share'}?${paramName}=${programId}`;
}

/**
 * Generates Open Graph metadata for a program
 * 
 * Used for social media preview cards when the link is shared
 * 
 * @param title - The program name
 * @param description - Program description
 * @param url - The shareable link URL
 * @param config - Link generation configuration
 * @returns OpenGraphMetadata object
 */
export function generateOpenGraphMetadata(
  title: string,
  description?: string,
  url?: string,
  config?: Partial<LinkGenerationConfig>
): OpenGraphMetadata {
  const finalConfig = { ...DEFAULT_LINK_CONFIG, ...config };
  const baseUrl = finalConfig.baseUrl.replace(/\/$/, '');

  return {
    title: title || 'BMDC Training Program',
    description:
      description ||
      'Enroll in a professional training program through BMDC.',
    image: `${baseUrl}/og-image.png`, // Default OG image
    url: url || baseUrl,
    type: 'website',
  };
}

/**
 * Extracts the program ID from a share URL
 * 
 * Parses the query parameters to get the program ID
 * 
 * @param url - The URL to extract the program ID from
 * @param paramName - The query parameter name (default: 'program_id')
 * @returns The extracted program ID or null if not found
 * 
 * @example
 * const programId = extractProgramIdFromUrl(
 *   'https://bmdc.online/share?program_id=a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6'
 * );
 * // Returns: 'a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6'
 */
export function extractProgramIdFromUrl(
  url: string,
  paramName: string = 'program_id'
): string | null {
  try {
    const urlObj = new URL(url);
    const programId = urlObj.searchParams.get(paramName);
    return programId;
  } catch {
    // Invalid URL format
    return null;
  }
}

/**
 * Extracts program ID from query parameters
 * 
 * Used in API routes to get program ID from request
 * 
 * @param searchParams - URLSearchParams or query object
 * @param paramName - The parameter name (default: 'program_id')
 * @returns The program ID or null if not found
 */
export function extractProgramIdFromParams(
  searchParams: Record<string, any> | URLSearchParams,
  paramName: string = 'program_id'
): string | null {
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get(paramName);
  }

  return searchParams[paramName] || null;
}

/**
 * Validates a program ID format (UUID)
 * 
 * Accepts any valid UUID format (v1, v3, v4, v5)
 * 
 * @param programId - The program ID to validate
 * @returns True if valid UUID format, false otherwise
 * 
 * @example
 * isValidUUID('a1b2c3d4-e5f6-4a18-b9d0-c1k2l3m4n5o6') // true
 * isValidUUID('invalid-id') // false
 */
export function isValidUUID(programId: string): boolean {
  // Accept any valid UUID format (8-4-4-4-12 hex digits)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(programId);
}

/**
 * Validates a LinkValidationResult and formats error messages
 * 
 * @param result - The validation result to format
 * @returns Formatted validation result with user-friendly messages
 */
export function formatValidationResult(
  result: LinkValidationResult
): LinkValidationResult {
  if (!result.isValid) {
    // Set default error message if not provided
    if (!result.error) {
      result.error =
        result.reason || 'Program link is invalid or unavailable';
    }
  }

  return result;
}

/**
 * Formats an enrollment response with all required fields
 * 
 * @param enrollmentData - The raw enrollment data
 * @returns Formatted enrollment response
 */
export function formatEnrollmentResponse(enrollmentData: any) {
  return {
    id: enrollmentData.id,
    traineeId: enrollmentData.trainee_id || enrollmentData.traineeId,
    programId: enrollmentData.program_id || enrollmentData.programId,
    status: enrollmentData.status || 'enrolled',
    enrollmentDate: enrollmentData.enrollment_date || enrollmentData.enrollmentDate || new Date().toISOString(),
    enrollmentSource: enrollmentData.enrollment_source || enrollmentData.enrollmentSource || 'direct',
  };
}

/**
 * Formats API error response for consistency
 * 
 * @param message - The error message
 * @param code - Optional error code
 * @param details - Optional error details
 * @returns Formatted error response object
 */
export function formatErrorResponse(
  message: string,
  code?: string,
  details?: Record<string, any>
) {
  return {
    success: false,
    error: message,
    code: code || 'UNKNOWN_ERROR',
    details: details || {},
  };
}

/**
 * Generates a unique link ID for tracking
 * 
 * @returns A unique UUID string
 */
export function generateLinkId(): string {
  return uuidv4();
}

/**
 * Checks if a link has expired
 * 
 * @param expiresAt - The expiration timestamp (ISO8601)
 * @returns True if expired, false otherwise
 */
export function isLinkExpired(expiresAt?: string): boolean {
  if (!expiresAt) {
    return false; // No expiration = never expired
  }

  try {
    const expirationDate = new Date(expiresAt);
    return expirationDate < new Date();
  } catch {
    return false; // Invalid date format = treat as not expired
  }
}

/**
 * Validates link structure for share URLs
 * 
 * Checks that the URL has valid format and contains program_id
 * 
 * @param url - The URL to validate
 * @param config - Link generation configuration
 * @returns Validation result with success status and error message if invalid
 */
export function validateShareLinkStructure(
  url: string,
  config?: Partial<LinkGenerationConfig>
): { isValid: boolean; error?: string } {
  const finalConfig = { ...DEFAULT_LINK_CONFIG, ...config };
  const paramName = finalConfig.paramName || 'program_id';

  try {
    const urlObj = new URL(url);
    const programId = urlObj.searchParams.get(paramName);

    if (!programId) {
      return {
        isValid: false,
        error: `Missing required parameter: ${paramName}`,
      };
    }

    if (!isValidUUID(programId)) {
      return {
        isValid: false,
        error: `Invalid program ID format: ${programId}`,
      };
    }

    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: 'Invalid URL format',
    };
  }
}

/**
 * Validates enrollment source
 * 
 * @param source - The enrollment source string
 * @returns True if valid, false otherwise
 */
export function isValidEnrollmentSource(
  source: string
): source is 'social_share' | 'direct' | 'admin_assigned' {
  return ['social_share', 'direct', 'admin_assigned'].includes(source);
}

/**
 * Builds enrollment request data
 * 
 * @param traineeId - The trainee ID
 * @param programId - The program ID
 * @param source - The enrollment source
 * @param notes - Optional enrollment notes
 * @returns Formatted enrollment request object
 */
export function buildEnrollmentRequest(
  traineeId: string,
  programId: string,
  source: 'social_share' | 'direct' | 'admin_assigned' = 'direct',
  notes?: string
) {
  return {
    traineeId,
    programId,
    source,
    ...(notes && { notes }),
  };
}

/**
 * Generates user-friendly error messages for common validation failures
 * 
 * @param code - Error code
 * @returns User-friendly error message
 */
export function getUserFriendlyErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    PROGRAM_NOT_FOUND: 'The program you are looking for does not exist.',
    PROGRAM_INACTIVE: 'This program is no longer available.',
    PROGRAM_NOT_PUBLIC: 'This program is not available for enrollment.',
    INVALID_PROGRAM_ID:
      'The program link is invalid. Please check the URL.',
    INVALID_URL: 'The shared link format is invalid.',
    ENROLLMENT_FAILED: 'Failed to complete enrollment. Please try again.',
    PERMISSION_DENIED:
      'You do not have permission to enroll in this program.',
    ALREADY_ENROLLED: 'You are already enrolled in this program.',
    CAPACITY_EXCEEDED: 'This program has reached maximum enrollment capacity.',
  };

  return messages[code] || 'An unexpected error occurred. Please try again.';
}

/**
 * Sanitizes program description for OG metadata
 * 
 * Truncates to 160 characters and removes HTML/special characters
 * 
 * @param description - Raw description text
 * @returns Sanitized description suitable for OG metadata
 */
export function sanitizeOGDescription(description?: string): string {
  if (!description) {
    return 'Enroll in a professional training program through BMDC.';
  }

  // Remove HTML tags
  const plainText = description.replace(/<[^>]*>/g, '');

  // Decode HTML entities
  const decoded = plainText
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

  // Truncate to 160 characters (OG description standard)
  const truncated =
    decoded.length > 160 ? decoded.substring(0, 157) + '...' : decoded;

  return truncated.trim();
}

/**
 * Creates validation result for invalid programs
 * 
 * @param error - Error message
 * @param reason - Optional detailed reason
 * @returns LinkValidationResult indicating invalid program
 */
export function createInvalidProgramResult(
  error: string = 'Program is invalid or unavailable',
  reason?: string
): LinkValidationResult {
  return {
    isValid: false,
    isActive: false,
    isPublic: false,
    error,
    reason,
  };
}

/**
 * Creates validation result for valid programs
 * 
 * @param program - Program details
 * @returns LinkValidationResult indicating valid program
 */
export function createValidProgramResult(
  program: ProgramDetailsForSharing
): LinkValidationResult {
  return {
    isValid: true,
    isActive: program.status === 'active',
    isPublic: true, // Public for now - can be enhanced with permission checks
    program: {
      id: program.id,
      name: program.name,
      description: program.description,
    },
  };
}

/**
 * Validates the expiration configuration
 * 
 * @param expirationDays - Number of days until expiration
 * @returns True if valid, false otherwise
 */
export function isValidExpirationDays(expirationDays?: number | null): boolean {
  if (expirationDays === null || expirationDays === undefined) {
    return true; // null = never expires
  }

  return expirationDays > 0 && expirationDays <= 36500; // Max 100 years
}

/**
 * Calculates link expiration date
 * 
 * @param expirationDays - Number of days from now
 * @returns ISO8601 expiration timestamp
 */
export function calculateExpirationDate(expirationDays: number): string {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + expirationDays);
  return expirationDate.toISOString();
}

/**
 * Extracts UTM parameters from a URL
 * 
 * @param url - The URL to extract UTM params from
 * @returns Object containing UTM parameters
 */
export function extractUTMParameters(url: string): Record<string, string> {
  try {
    const urlObj = new URL(url);
    const utm: Record<string, string> = {};

    const utmParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    utmParams.forEach((param) => {
      const value = urlObj.searchParams.get(param);
      if (value) {
        utm[param] = value;
      }
    });

    return utm;
  } catch {
    return {};
  }
}

/**
 * Adds UTM parameters to a URL
 * 
 * @param baseUrl - The base URL to add parameters to
 * @param params - UTM parameters to add
 * @returns URL with UTM parameters
 */
export function addUTMParameters(
  baseUrl: string,
  params: Record<string, string>
): string {
  try {
    const url = new URL(baseUrl);

    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        url.searchParams.set(key, value);
      }
    });

    return url.toString();
  } catch {
    return baseUrl;
  }
}
