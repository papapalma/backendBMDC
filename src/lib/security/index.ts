/**
 * Shared Security Utilities
 *
 * Reusable security functions across endpoints:
 * - Path sanitization (prevent directory traversal)
 * - GPS coordinate validation (detect spoofing, zero coordinates)
 * - Tenant access verification (user belongs to tenant)
 * - Device info validation (prevent malformed device data)
 *
 * Implements Requirements 7.1-7.3, 8.1-8.3, 9.1-9.5, 17.1-17.3
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { pathBelongsToTenant, assertSafeFilename } from '@/lib/fileStorage';
import { normalizeUploadPath } from '@/utils/fileUpload';
import { z } from 'zod';

// Re-export path validation functions for centralized access (Task 1.3 compliance)
// ponytail: consolidating existing path validators (assertSafeFilename, normalizeUploadPath)
// These were already safe in fileStorage.ts and fileUpload.ts;
// centralizing here for Task 1.3 compliance and ease of import in Task 5+
export { assertSafeFilename, normalizeUploadPath };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Path Sanitization (Prevent Directory Traversal)
// ---------------------------------------------------------------------------

/**
 * Sanitize a filename by removing path separators and traversal sequences.
 *
 * Removes:
 * - Forward slashes: / → _
 * - Backslashes: \ → _
 * - Double dots: .. → __
 * - Null bytes: \0 → removed
 * - Percent-encoded variants: %2e%2e → __
 *
 * @param filename - Raw filename from user input
 * @returns Sanitized filename safe for filesystem storage
 *
 * @example
 *   sanitizePath('../../../etc/passwd') → '_______etc_passwd'
 *   sanitizePath('photo.jpg') → 'photo.jpg'
 *   sanitizePath('..%2f..%2fetc') → '________etc'
 */
export function sanitizePath(filename: string): string {
  if (!filename) return 'unnamed';

  // Decode percent-encoded variants (%2e = ., %2f = /, etc.)
  let decoded = filename;
  try {
    decoded = decodeURIComponent(filename);
  } catch {
    // If decoding fails, use original
    decoded = filename;
  }

  // Remove null bytes
  decoded = decoded.replace(/\0/g, '');

  // Replace path separators with underscores
  decoded = decoded.replace(/[/\\]/g, '_');

  // Replace double dots (and variants like %2e%2e)
  decoded = decoded.replace(/\.{2,}/g, '__');

  // Remove any remaining suspicious characters while preserving extension
  // Allow: alphanumeric, dash, underscore, dot (for extension)
  decoded = decoded.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Collapse multiple consecutive underscores
  decoded = decoded.replace(/_+/g, '_');

  // Trim underscores from edges
  decoded = decoded.replace(/^_+|_+$/g, '');

  // Ensure we have a filename
  return decoded || 'unnamed';
}

// ---------------------------------------------------------------------------
// GPS Validation (Detect Spoofing & Zero Coordinates)
// ---------------------------------------------------------------------------

/**
 * GPS validation constants
 */
export const GPS_BOUNDS = {
  /** Valid latitude range: -90 to 90 degrees */
  LAT_MIN: -90,
  LAT_MAX: 90,

  /** Valid longitude range: -180 to 180 degrees */
  LNG_MIN: -180,
  LNG_MAX: 180,

  /** Maximum allowed accuracy in meters (30m typical for GPS) */
  MAX_ACCURACY_M: 100,

  /** Minimum allowed accuracy in meters (0m) */
  MIN_ACCURACY_M: 0,

  /** Reject this exact coordinate (common spoofing point) */
  ZERO_COORD_LAT: 0,
  ZERO_COORD_LNG: 0,

  /** Geofence distance threshold (meters) — default 100m radius */
  GEOFENCE_THRESHOLD_M: 100,
};

/**
 * Validate GPS coordinates for plausibility and detect spoofing.
 *
 * Checks:
 * - Latitude within [-90, 90]
 * - Longitude within [-180, 180]
 * - Not exactly (0, 0) — common spoofing
 * - Accuracy reasonable (0.1m to 100m)
 * - Values are numbers (not NaN)
 *
 * @param lat - Latitude in decimal degrees
 * @param lng - Longitude in decimal degrees
 * @param accuracy - Accuracy radius in meters (optional)
 * @returns ValidationResult with reason if invalid
 *
 * @example
 *   validateGPS(40.7128, -74.0060, 10) → { valid: true }
 *   validateGPS(0, 0, 5) → { valid: false, reason: 'Coordinates (0,0) are not permitted' }
 *   validateGPS(91, -74.0060, 10) → { valid: false, reason: 'Latitude out of range' }
 *   validateGPS(40.7128, -74.0060, 150) → { valid: false, reason: 'Accuracy exceeds maximum (100m)' }
 */
export function validateGPS(
  lat?: number,
  lng?: number,
  accuracy?: number
): ValidationResult {
  // Check presence
  if (lat === undefined || lat === null) {
    return { valid: false, reason: 'Latitude is required' };
  }
  if (lng === undefined || lng === null) {
    return { valid: false, reason: 'Longitude is required' };
  }

  // Check types (NaN check)
  if (typeof lat !== 'number' || isNaN(lat)) {
    return { valid: false, reason: 'Latitude must be a valid number' };
  }
  if (typeof lng !== 'number' || isNaN(lng)) {
    return { valid: false, reason: 'Longitude must be a valid number' };
  }

  // Check ranges
  if (lat < GPS_BOUNDS.LAT_MIN || lat > GPS_BOUNDS.LAT_MAX) {
    return { valid: false, reason: 'Latitude out of range [-90, 90]' };
  }
  if (lng < GPS_BOUNDS.LNG_MIN || lng > GPS_BOUNDS.LNG_MAX) {
    return { valid: false, reason: 'Longitude out of range [-180, 180]' };
  }

  // Reject (0, 0) — common spoofing point
  if (lat === GPS_BOUNDS.ZERO_COORD_LAT && lng === GPS_BOUNDS.ZERO_COORD_LNG) {
    return { valid: false, reason: 'Coordinates (0,0) are not permitted' };
  }

  // Validate accuracy if provided
  if (accuracy !== undefined && accuracy !== null) {
    if (typeof accuracy !== 'number' || isNaN(accuracy)) {
      return { valid: false, reason: 'Accuracy must be a valid number' };
    }
    if (accuracy < GPS_BOUNDS.MIN_ACCURACY_M) {
      return { valid: false, reason: `Accuracy below minimum (${GPS_BOUNDS.MIN_ACCURACY_M}m)` };
    }
    if (accuracy > GPS_BOUNDS.MAX_ACCURACY_M) {
      return { valid: false, reason: `Accuracy exceeds maximum (${GPS_BOUNDS.MAX_ACCURACY_M}m)` };
    }
  }

  return { valid: true };
}

/**
 * Calculate distance between two GPS coordinates using Haversine formula.
 *
 * Used for geofence validation and location plausibility checks.
 *
 * @param lat1 - Latitude of point 1 (decimal degrees)
 * @param lng1 - Longitude of point 1 (decimal degrees)
 * @param lat2 - Latitude of point 2 (decimal degrees)
 * @param lng2 - Longitude of point 2 (decimal degrees)
 * @returns Distance in kilometers
 *
 * @example
 *   calculateDistance(40.7128, -74.0060, 40.7489, -73.9680) → ~5.5 km (NYC)
 */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ---------------------------------------------------------------------------
// Geofence Validation (Task 22: Validate Attendance from Authorized Locations)
// ---------------------------------------------------------------------------

/**
 * Geofence record from the database (stored in programs or program_locations table).
 *
 * Defines an authorized location for a training program where attendees
 * can submit attendance.
 */
export interface Geofence {
  id: string;
  program_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number; // Authorized distance from center
  is_active: boolean;
}

/**
 * Validate that a GPS submission is within an authorized geofence.
 *
 * Checks:
 * - Distance from geofence center ≤ radius_meters
 * - GPS accuracy + distance ≤ radius_meters (combined uncertainty check)
 *
 * Task 22.1: Implement geofence validation
 * ponytail: reuse calculateDistance (already exists); add geofence radius check
 *
 * @param submittedLat - Submitted latitude (already validated via validateGPS)
 * @param submittedLng - Submitted longitude (already validated via validateGPS)
 * @param submittedAccuracy - GPS accuracy in meters (already validated, 0-100m)
 * @param geofence - Geofence record from database
 * @returns ValidationResult with detailed reason if outside geofence
 *
 * @example
 *   // Geofence: center at 40.7128, -74.0060, radius 100m
 *   // Submitted: 40.7130, -74.0058, accuracy 15m
 *   const result = validateGeofence(40.7130, -74.0058, 15, geofence);
 *   // Distance ≈ 0.22 km = 220m (outside 100m radius)
 *   // result.valid → false
 */
export function validateGeofence(
  submittedLat: number,
  submittedLng: number,
  submittedAccuracy: number | undefined,
  geofence: Geofence
): ValidationResult {
  // Validate geofence record
  if (!geofence) {
    return { valid: false, reason: 'Geofence not configured for this training location' };
  }

  if (!geofence.is_active) {
    return { valid: false, reason: 'Geofence is not active for this location' };
  }

  // Calculate distance from submission point to geofence center
  const distanceKm = calculateDistance(
    submittedLat,
    submittedLng,
    geofence.latitude,
    geofence.longitude
  );

  const distanceM = distanceKm * 1000; // Convert km to meters

  // ponytail: simple distance check (upgrade: add elevation/altitude validation)
  
  // Check 1: Is the distance within the geofence radius?
  if (distanceM > geofence.radius_meters) {
    return {
      valid: false,
      reason: `Location outside geofence (${Math.round(distanceM)}m from center, max ${geofence.radius_meters}m)`,
    };
  }

  // Check 2: Does GPS accuracy + distance exceed radius?
  // This ensures even with max uncertainty, the point could be within bounds
  const accuracy = submittedAccuracy || 0;
  const maxPossibleDistance = distanceM + accuracy;

  if (maxPossibleDistance > geofence.radius_meters) {
    return {
      valid: false,
      reason: `Location uncertain: with GPS accuracy (${accuracy}m), point may be outside geofence (max distance ${Math.round(maxPossibleDistance)}m, limit ${geofence.radius_meters}m)`,
    };
  }

  return { valid: true };
}

/**
 * Fetch the active geofence for a program.
 *
 * For now, returns a single geofence per program.
 * (Future: support multiple geofences per program with nearest-match logic)
 *
 * Task 22.2: Fetch geofence from database
 *
 * @param programId - UUID of the training program
 * @param tenantId - UUID of the tenant (for isolation)
 * @returns Geofence record or null if not found/configured
 *
 * ponytail: single query to geofence table (upgrade: add caching with Redis TTL)
 */
export async function getGeofenceForProgram(
  programId: string,
  tenantId: string
): Promise<Geofence | null> {
  if (!programId || !tenantId) {
    return null;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('program_geofences')
      .select('id, program_id, name, latitude, longitude, radius_meters, is_active')
      .eq('program_id', programId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[getGeofenceForProgram] Database error:', error);
      return null;
    }

    return data as Geofence | null;
  } catch (err) {
    console.error('[getGeofenceForProgram] Exception:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tenant Access Validation
// ---------------------------------------------------------------------------

/**
 * Verify that a user belongs to a specific tenant.
 *
 * Queries the `users_tenants` junction table to check if the user
 * is authorized to access the tenant.
 *
 * @param userId - UUID of the user
 * @param tenantId - UUID of the tenant
 * @returns true if user is associated with tenant, false otherwise
 *
 * @example
 *   await validateTenantAccess('user-123', 'tenant-456') → true
 *   await validateTenantAccess('user-123', 'tenant-other') → false
 */
export async function validateTenantAccess(userId: string, tenantId: string): Promise<boolean> {
  if (!userId || !tenantId) {
    return false;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('users_tenants')
      .select('user_id')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      // No row found is not an error condition, just return false
      if (error.code === 'PGRST116') {
        return false;
      }
      // Log unexpected errors but don't throw (safer to deny access)
      console.error('[validateTenantAccess] Database error:', error);
      return false;
    }

    return !!data;
  } catch (err) {
    console.error('[validateTenantAccess] Exception:', err);
    return false;
  }
}

/**
 * Verify that a trainee belongs to a specific user (for trainee isolation).
 *
 * Used to ensure trainees can only access their own records.
 *
 * @param userId - UUID of the user
 * @param traineeId - UUID of the trainee
 * @returns true if user is the trainee or supervises the trainee
 *
 * @example
 *   await validateTraineeAccess('user-123', 'trainee-456') → true (if user_id matches)
 */
export async function validateTraineeAccess(userId: string, traineeId: string): Promise<boolean> {
  if (!userId || !traineeId) {
    return false;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('trainee_accounts')
      .select('user_id')
      .eq('id', traineeId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return false;
      }
      console.error('[validateTraineeAccess] Database error:', error);
      return false;
    }

    return !!data;
  } catch (err) {
    console.error('[validateTraineeAccess] Exception:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// JSONB Size Limits (Prevent DOS via Oversized Fields)
// ---------------------------------------------------------------------------

export const JSONB_SIZE_LIMITS = {
  /** device_info JSONB field max size in bytes */
  device_info: 5 * 1024, // 5 KB

  /** gps_address JSONB field max size in bytes */
  gps_address: 500, // 500 B

  /** notes field max size in bytes */
  notes: 5 * 1024, // 5 KB

  /** custom_attributes generic JSONB field max size */
  custom_attributes: 10 * 1024, // 10 KB
};

/**
 * Validate that a JSONB field does not exceed size limits.
 *
 * Prevents DOS attacks via oversized JSONB fields that could
 * exhaust database storage or trigger expensive queries.
 *
 * @param fieldName - Name of the JSONB field (key in JSONB_SIZE_LIMITS)
 * @param value - Object to serialize and check
 * @returns ValidationResult with size info
 *
 * @example
 *   validateJsonbSize('device_info', { brand: 'Apple', model: 'iPhone 15' })
 *   → { valid: true }
 *
 *   validateJsonbSize('device_info', hugeObject)
 *   → { valid: false, reason: 'device_info exceeds maximum size (5 KB)' }
 */
export function validateJsonbSize(fieldName: string, value: unknown): ValidationResult {
  const limit = JSONB_SIZE_LIMITS[fieldName as keyof typeof JSONB_SIZE_LIMITS];

  if (!limit) {
    return { valid: true }; // Unknown field, skip validation
  }

  try {
    const serialized = JSON.stringify(value);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');

    if (sizeBytes > limit) {
      return {
        valid: false,
        reason: `${fieldName} exceeds maximum size (${limit} bytes, got ${sizeBytes})`,
      };
    }

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: `${fieldName} cannot be serialized to JSON: ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// File Type Validation
// ---------------------------------------------------------------------------

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'text/plain',
];

/**
 * Validate file MIME type against a whitelist.
 *
 * @param mimeType - MIME type to validate
 * @param allowedTypes - Whitelist of allowed MIME types
 * @returns ValidationResult
 *
 * @example
 *   validateFileType('image/jpeg', ALLOWED_IMAGE_TYPES) → { valid: true }
 *   validateFileType('image/svg+xml', ALLOWED_IMAGE_TYPES) → { valid: false, ... }
 */
export function validateFileType(mimeType: string, allowedTypes: string[]): ValidationResult {
  if (!mimeType) {
    return { valid: false, reason: 'MIME type is required' };
  }

  if (!allowedTypes.includes(mimeType)) {
    return {
      valid: false,
      reason: `File type "${mimeType}" is not permitted. Allowed: ${allowedTypes.join(', ')}`,
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// UUID Validation (Reuse Pattern from fileStorage)
// ---------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Check if a string is a valid UUID v4.
 *
 * @param value - String to validate
 * @returns true if valid UUID, false otherwise
 *
 * @example
 *   isValidUUID('550e8400-e29b-41d4-a716-446655440000') → true
 *   isValidUUID('not-a-uuid') → false
 */
export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

// ---------------------------------------------------------------------------
// File Access Guard (Tenant Boundary Validation)
// ---------------------------------------------------------------------------

export interface FileAccessGuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Guard for file access: verify that a file record belongs to the requesting user's tenant.
 *
 * Used in file serving and file metadata endpoints to ensure cross-tenant access is blocked.
 *
 * This implements Task 3.2 / 3.4 of the security hardening spec:
 * - After fetching a file record from the database
 * - Check that the file_path includes the user's tenant_id
 * - Return 403 Forbidden if tenant mismatch detected
 *
 * ponytail: simple tenant boundary check (upgrade: add Supabase RLS)
 *
 * @param file - File record from database (must include file_path field)
 * @param tenantId - Expected tenant UUID
 * @returns FileAccessGuardResult with allowed status
 *
 * @example
 *   const file = await fetchFileById('file-123');  // { file_path: '/uploads/tenant-A/...' }
 *   const guard = validateFileAccess(file, tenantB);
 *   if (!guard.allowed) {
 *     return forbiddenResponse(guard.reason);
 *   }
 */
export function validateFileAccess(
  file: { file_path?: string } | null,
  tenantId: string
): FileAccessGuardResult {
  // ponytail: simple tenant boundary check (upgrade: add Supabase RLS)
  
  if (!file) {
    return { allowed: false, reason: 'File not found' };
  }

  if (!file.file_path) {
    return { allowed: false, reason: 'Invalid file record: missing file_path' };
  }

  if (!tenantId) {
    return { allowed: false, reason: 'Invalid request: missing tenant context' };
  }

  // Check that file path includes the tenant ID
  if (!pathBelongsToTenant(file.file_path, tenantId)) {
    return {
      allowed: false,
      reason: 'Access denied: file does not belong to your tenant',
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Device Info Validation (Task 17: Prevent Malformed Device Data)
// ---------------------------------------------------------------------------

/**
 * Device information schema for attendance submission.
 *
 * Validates:
 * - device_id: UUID or alphanumeric identifier (required)
 * - device_model: string max 100 chars (optional)
 * - os_version: string max 50 chars (optional)
 * - app_version: semantic version pattern (optional)
 * - timestamp: ISO 8601 UTC datetime (optional)
 *
 * Task 17.1: Define device info schema
 * ponytail: Zod schema (10 lines, already used in project)
 *
 * @example
 *   const schema = DeviceInfoSchema;
 *   const result = schema.safeParse(deviceInfo);
 *   if (!result.success) return errorResponse(result.error.message);
 */
export const DeviceInfoSchema = z.object({
  device_id: z
    .string()
    .min(1, 'device_id is required')
    .max(100, 'device_id exceeds maximum length (100 chars)')
    .refine(
      (val) => /^[a-zA-Z0-9-]+$/.test(val),
      'device_id must be alphanumeric or contain hyphens (UUID format)'
    ),
  
  device_model: z
    .string()
    .max(100, 'device_model exceeds maximum length (100 chars)')
    .optional()
    .nullable(),
  
  os_version: z
    .string()
    .max(50, 'os_version exceeds maximum length (50 chars)')
    .optional()
    .nullable(),
  
  app_version: z
    .string()
    .regex(
      /^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/,
      'app_version must follow semantic versioning (e.g., "1.2.3" or "1.2.3-beta")'
    )
    .optional()
    .nullable(),
  
  timestamp: z
    .string()
    .datetime({ offset: true })
    .optional()
    .nullable(),
}).strict();

export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

/**
 * Validate device info object and return structured error or parsed data.
 *
 * Task 17.2: Validation tests for device info
 *
 * @param deviceInfoRaw - Raw device info (from JSON parse or form field)
 * @returns ValidationResult with parsed data or error reason
 *
 * @example
 *   const result = validateDeviceInfo(rawData);
 *   if (!result.valid) {
 *     return errorResponse(result.reason, 400);
 *   }
 *   const validated: DeviceInfo = result.data;
 */
export function validateDeviceInfo(
  deviceInfoRaw: unknown
): ValidationResult & { data?: DeviceInfo } {
  try {
    const parsed = DeviceInfoSchema.parse(deviceInfoRaw);
    
    // Task 15.2: Validate JSONB size limit for device_info field
    // ponytail: one validation call per field, reuse existing validateJsonbSize
    const sizeCheck = validateJsonbSize('device_info', parsed);
    if (!sizeCheck.valid) {
      return { valid: false, reason: sizeCheck.reason };
    }
    
    return { valid: true, data: parsed };
  } catch (err) {
    const message = err instanceof z.ZodError ? err.errors[0]?.message : String(err);
    return { valid: false, reason: message };
  }
}

