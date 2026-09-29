/**
 * OTP (One-Time Password) Service
 *
 * Manages the complete lifecycle of OTP verification codes for:
 *   - 2FA during trainee account creation
 *   - Password reset with double verification
 *   - Email change verification
 *
 * Features:
 *   - 6-digit numeric code generation
 *   - Expiry-based code validation (15 minutes default)
 *   - Attempt limiting with lockout (5 attempts default)
 *   - OTP type tracking (2fa, password_reset, email_change)
 *   - User and trainee linking for security
 *   - Comprehensive audit logging
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OTPType = '2fa' | 'password_reset' | 'email_change';

export interface EmailVerification {
  id: string;
  email: string;
  phone?: string;
  code: string;
  type: OTPType;
  method: string;
  expires_at: string;
  verified_at?: string;
  user_id?: string;
  trainee_id?: string;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface CreateOTPParams {
  email: string;
  type: OTPType;
  userId?: string;
  traineeId?: string;
  expiryMinutes?: number;
  maxAttempts?: number;
}

export interface ValidateOTPResult {
  valid: boolean;
  error?: string;
  record?: EmailVerification;
  remainingAttempts?: number;
}

export interface OTPResponse {
  code: string;
  expiresAt: Date;
  verificationId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default OTP expiry time in minutes */
const DEFAULT_EXPIRY_MINUTES = 15;

/** Default maximum verification attempts before lockout */
const DEFAULT_MAX_ATTEMPTS = 5;

/** OTP code length (6 digits) */
const OTP_LENGTH = 6;

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Generate a random 6-digit numeric OTP code.
 * Range: 000000 to 999999
 */
export function generateOTP(): string {
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  const random = Math.floor(Math.random() * (max - min + 1)) + min;
  return String(random).padStart(OTP_LENGTH, '0');
}

/**
 * Calculate expiry timestamp based on minutes from now.
 */
function calculateExpiryTime(expiryMinutes: number): Date {
  const now = new Date();
  return new Date(now.getTime() + expiryMinutes * 60 * 1000);
}

/**
 * Check if an OTP code has expired.
 */
function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

/**
 * Log an OTP operation to audit_logs.
 */
async function logOTPOperation(params: {
  tenantId?: string;
  action: string;
  email: string;
  type: OTPType;
  userId?: string;
  traineeId?: string;
  details?: Record<string, any>;
  success: boolean;
}): Promise<void> {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      tenant_id: params.tenantId || null,
      user_id: params.userId || null,
      action: params.action,
      entity_type: 'otp_verification',
      entity_id: params.traineeId || params.userId || params.email,
      details: {
        email: params.email,
        type: params.type,
        success: params.success,
        ...params.details,
      },
    });
  } catch (error) {
    logger.warn('[OTP] Failed to log OTP operation', {
      action: params.action,
      email: params.email,
      error,
    });
  }
}

// ---------------------------------------------------------------------------
// Core OTP Functions
// ---------------------------------------------------------------------------

/**
 * Create a new OTP verification record.
 *
 * Generates a 6-digit code, stores it in email_verifications with expiry,
 * and returns the code along with metadata.
 *
 * @param params Creation parameters
 * @returns OTP code, expiry time, and verification ID
 * @throws Error if database operation fails
 */
export async function createOTPVerification(params: CreateOTPParams): Promise<OTPResponse> {
  const code = generateOTP();
  const expiryMinutes = params.expiryMinutes ?? DEFAULT_EXPIRY_MINUTES;
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const expiresAt = calculateExpiryTime(expiryMinutes);

  logger.info('[OTP] Creating OTP verification', {
    email: params.email,
    type: params.type,
    expiryMinutes,
  });

  const { data, error } = await supabaseAdmin.from('email_verifications').insert({
    email: params.email,
    code,
    type: params.type,
    method: 'email',
    expires_at: expiresAt.toISOString(),
    user_id: params.userId || null,
    trainee_id: params.traineeId || null,
    attempt_count: 0,
    max_attempts: maxAttempts,
  });

  if (error) {
    logger.error('[OTP] Failed to create OTP verification', {
      email: params.email,
      type: params.type,
      error,
    });
    throw new Error(`Failed to create OTP verification: ${error.message}`);
  }

const record = Array.isArray(data) ? data[0] : data;

  await logOTPOperation({
    tenantId: params.traineeId ? undefined : params.userId ? undefined : undefined,
    action: 'otp.create',
    email: params.email,
    type: params.type,
    userId: params.userId,
    traineeId: params.traineeId,
    details: { expiryMinutes, maxAttempts },
    success: true,
  });

  return {
    code,
    expiresAt,
    verificationId: record.id,
  };
}

/**
 * Validate an OTP code for a given email and type.
 *
 * Checks:
 *   - OTP exists and hasn't expired
 *   - Code matches provided input
 *   - Hasn't been verified already
 *   - Attempt count < max_attempts
 *
 * Increments attempt count on each call (failed or successful).
 *
 * @param email Email address to validate for
 * @param code OTP code entered by user
 * @param type OTP type (2fa, password_reset, email_change)
 * @returns Validation result with error message or record
 */
export async function validateOTP(
  email: string,
  code: string,
  type: OTPType
): Promise<ValidateOTPResult> {
  logger.info('[OTP] Validating OTP', { email, type, codeLength: code.length });

  // Fetch the most recent unverified OTP for this email and type

const { data: records, error: fetchError } = await supabaseAdmin
    .from('email_verifications')
    .select('*')
    .eq('email', email)
    .eq('type', type)
    .is('verified_at', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (fetchError) {
    logger.error('[OTP] Failed to fetch OTP record', { email, type, error: fetchError });
    return {
      valid: false,
      error: 'Failed to validate OTP. Please try again.',
    };
  }

if (!records || records.length === 0) {
    logger.warn('[OTP] No OTP record found', { email, type });

    await logOTPOperation({
      action: 'otp.validate_failed',
      email,
      type,
      details: { reason: 'no_record_found' },
      success: false,
    });

    return {
      valid: false,
      error: 'No verification code found. Please request a new one.',
    };
  }

const record = records[0] as EmailVerification;

  // Check if OTP is expired

if (isExpired(record.expires_at)) {
    logger.warn('[OTP] OTP code expired', { email, type, expiresAt: record.expires_at });

    await logOTPOperation({
      action: 'otp.validate_failed',
      email,
      type,
      details: { reason: 'expired' },
      success: false,
    });

    return {
      valid: false,
      error: 'Verification code has expired. Please request a new one.',
    };
  }

  // Check if max attempts exceeded

if (record.attempt_count >= record.max_attempts) {
    logger.warn('[OTP] Maximum OTP attempts exceeded', {
      email,
      type,
      attempts: record.attempt_count,
    });

    await logOTPOperation({
      action: 'otp.validate_failed',
      email,
      type,
      details: { reason: 'max_attempts_exceeded', attempts: record.attempt_count },
      success: false,
    });

    return {
      valid: false,
      error: 'Maximum verification attempts exceeded. Please request a new code.',
      remainingAttempts: 0,
    };
  }

  // Increment attempt count

const newAttemptCount = record.attempt_count + 1;
  const { error: updateError } = await supabaseAdmin
    .from('email_verifications')
    .update({ attempt_count: newAttemptCount })
    .eq('id', record.id);

  if (updateError) {
    logger.error('[OTP] Failed to increment attempt count', {
      id: record.id,
      error: updateError,
    });
  }

  // Check if code matches

if (code !== record.code) {
    logger.warn('[OTP] Invalid OTP code provided', { email, type, attempt: newAttemptCount });

    const remainingAttempts = record.max_attempts - newAttemptCount;

    await logOTPOperation({
      action: 'otp.validate_failed',
      email,
      type,
      details: {
        reason: 'invalid_code',
        attempts: newAttemptCount,
        remainingAttempts,
      },
      success: false,
    });

    return {
      valid: false,
      error:
        remainingAttempts > 0
          ? `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`
          : 'Maximum verification attempts exceeded.',
      remainingAttempts,
    };
  }

  // Code is valid
  logger.info('[OTP] OTP code validated successfully', { email, type });

  await logOTPOperation({
    action: 'otp.validate_success',
    email,
    type,
    userId: record.user_id,
    traineeId: record.trainee_id,
    success: true,
  });

  return {
    valid: true,
    record,
    remainingAttempts: record.max_attempts - newAttemptCount,
  };
}

/**
 * Mark an OTP verification as verified/completed.
 *
 * Sets verified_at timestamp to mark the verification as done.
 *
 * @param verificationId ID of the email_verifications record
 * @throws Error if database operation fails
 */
export async function markOTPAsVerified(verificationId: string): Promise<void> {
  logger.info('[OTP] Marking OTP as verified', { verificationId });

  const { error } = await supabaseAdmin
    .from('email_verifications')
    .update({ verified_at: new Date().toISOString() })
    .eq('id', verificationId);

  if (error) {
    logger.error('[OTP] Failed to mark OTP as verified', { verificationId, error });
    throw new Error(`Failed to mark OTP as verified: ${error.message}`);
  }

  logger.info('[OTP] OTP marked as verified', { verificationId });
}

/**
 * Get the most recent active (non-expired, non-verified) OTP for an email/type.
 *
 * Useful for checking if an OTP is already pending for a user before creating
 * a new one (to avoid spam).
 *
 * @param email Email address
 * @param type OTP type
 * @returns OTP record or null if not found
 */
export async function getActiveOTP(email: string, type: OTPType): Promise<EmailVerification | null> {
  const { data: records, error } = await supabaseAdmin
    .from('email_verifications')
    .select('*')
    .eq('email', email)
    .eq('type', type)
    .is('verified_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    logger.warn('[OTP] Failed to fetch active OTP', { email, type, error });
    return null;
  }

  return records && records.length > 0 ? (records[0] as EmailVerification) : null;
}

/**
 * Check if an email/type combination is locked due to too many failed attempts.
 *
 * @param email Email address
 * @param type OTP type
 * @returns true if locked, false otherwise
 */
export async function isLocked(email: string, type: OTPType): Promise<boolean> {
  const { data: records, error } = await supabaseAdmin
    .from('email_verifications')
    .select('attempt_count, max_attempts')
    .eq('email', email)
    .eq('type', type)
    .is('verified_at', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    logger.warn('[OTP] Failed to check lock status', { email, type, error });
    return false;
  }

if (!records || records.length === 0) {
    return false;
  }

const record = records[0];
  return record.attempt_count >= record.max_attempts;
}

/**
 * Get remaining attempts for an email/type.
 *
 * @param email Email address
 * @param type OTP type
 * @returns Number of remaining attempts, or 0 if no active OTP or locked
 */
export async function getRemainingAttempts(email: string, type: OTPType): Promise<number> {
  const { data: records, error } = await supabaseAdmin
    .from('email_verifications')
    .select('attempt_count, max_attempts')
    .eq('email', email)
    .eq('type', type)
    .is('verified_at', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    logger.warn('[OTP] Failed to get remaining attempts', { email, type, error });
    return 0;
  }

if (!records || records.length === 0) {
    return DEFAULT_MAX_ATTEMPTS;
  }

const record = records[0];
  return Math.max(0, record.max_attempts - record.attempt_count);
}

/**
 * Clean up expired OTP records (older than 24 hours).
 *
 * This should be called periodically (e.g., via a cron job) to remove
 * old verification records and keep the table size manageable.
 *
 * @returns Number of records deleted
 */
export async function cleanupExpiredOTPs(): Promise<number> {
  logger.info('[OTP] Starting cleanup of expired OTP records');

  // Keep expired records for 24 hours for audit purposes, then delete

const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { error, data } = await supabaseAdmin
    .from('email_verifications')
    .delete()
    .lt('expires_at', cutoffTime)
    .select();

  if (error) {
    logger.error('[OTP] Failed to cleanup expired OTP records', { error });
    throw new Error(`Failed to cleanup OTP records: ${error.message}`);
  }

const deletedCount = Array.isArray(data) ? data.length : 0;

  logger.info('[OTP] Cleanup completed', { deletedCount, cutoffTime });

  return deletedCount;
}

/**
 * Get OTP statistics for monitoring and debugging.
 *
 * @param email Optional email to get stats for specific email only
 * @returns Statistics object with counts
 */
export async function getOTPStats(email?: string): Promise<{
  totalRecords: number;
  pendingRecords: number;
  expiredRecords: number;
  verifiedRecords: number;
  lockedRecords: number;
}> {
  let query = supabaseAdmin.from('email_verifications').select('*', { count: 'exact' });

  if (email) {
    query = query.eq('email', email);
  }

  // Get all records

const { count: total, error: totalError } = await query;

  if (totalError) {
    logger.warn('[OTP] Failed to fetch OTP stats', { error: totalError });
    return { totalRecords: 0, pendingRecords: 0, expiredRecords: 0, verifiedRecords: 0, lockedRecords: 0 };
  }

let pendingQuery = supabaseAdmin
    .from('email_verifications')
    .select('*', { count: 'exact' })
    .is('verified_at', null)
    .gt('expires_at', new Date().toISOString());

  if (email) {
    pendingQuery = pendingQuery.eq('email', email);
  }

const { count: pending } = await pendingQuery;

  let expiredQuery = supabaseAdmin
    .from('email_verifications')
    .select('*', { count: 'exact' })
    .is('verified_at', null)
    .lt('expires_at', new Date().toISOString());

  if (email) {
    expiredQuery = expiredQuery.eq('email', email);
  }

const { count: expired } = await expiredQuery;

  let verifiedQuery = supabaseAdmin
    .from('email_verifications')
    .select('*', { count: 'exact' })
    .not('verified_at', 'is', null);

  if (email) {
    verifiedQuery = verifiedQuery.eq('email', email);
  }

const { count: verified } = await verifiedQuery;

  let lockedQuery = supabaseAdmin
    .from('email_verifications')
    .select('attempt_count, max_attempts', { count: 'exact' })
    .is('verified_at', null);

  if (email) {
    lockedQuery = lockedQuery.eq('email', email);
  }

const { data: lockedRecords, count: lockedTotal } = await lockedQuery;

  const locked = (lockedRecords || []).filter(
    (r: any) => r.attempt_count >= r.max_attempts
  ).length;

  return {
    totalRecords: total || 0,
    pendingRecords: pending || 0,
    expiredRecords: expired || 0,
    verifiedRecords: verified || 0,
    lockedRecords: locked,
  };
}
