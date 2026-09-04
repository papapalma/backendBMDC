/**
 * POST /api/auth/verify-2fa
 *
 * Verify a 2FA OTP code during trainee account creation.
 *
 * Request body:
 * {
 *   "email": "trainee@example.com",
 *   "code": "123456"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "traineeId": "uuid",
 *   "message": "2FA verification successful"
 * }
 *
 * Error responses:
 * - 400: Invalid or expired OTP
 * - 404: No pending verification found
 * - 429: Too many attempts
 * - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateOTP, markOTPAsVerified, getRemainingAttempts } from '@/services/otpService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

interface Verify2FARequest {
  email: string;
  code: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
  const body: Verify2FARequest = await request.json();
  const { email, code } = body;

  // Validate input

if (!email || !code) {
  logger.warn('[2FA] Missing required fields', { email: !!email, code: !!code });
  return NextResponse.json(
  { error: 'Email and code are required' },
  { status: 400 }
  );
  }

if (code.length !== 6 || !/^\d+$/.test(code)) {
  logger.warn('[2FA] Invalid code format', { email, codeLength: code.length });
  return NextResponse.json(
  { error: 'Code must be 6 digits' },
  { status: 400 }
  );
  }

  logger.info('[2FA] Attempting verification', { email });

  // Validate OTP

const validationResult = await validateOTP(email, code, '2fa');

  if (!validationResult.valid) {
  const remainingAttempts = validationResult.remainingAttempts ?? 0;

  logger.warn('[2FA] Validation failed', {
  email,
  error: validationResult.error,
  remainingAttempts,
  });

  // Return 429 if locked out

if (remainingAttempts === 0) {
  return NextResponse.json(
  {
  error: 'Too many failed attempts. Please request a new code.',
  locked: true,
  },
  { status: 429 }
  );
  }

  return NextResponse.json(
  {
  error: validationResult.error,
  remainingAttempts,
  },
  { status: 400 }
  );
  }

  // OTP is valid - mark trainee as verified

const record = validationResult.record;

  if (!record) {
  logger.error('[2FA] No OTP record found after validation', { email });
  return NextResponse.json(
  { error: 'Verification record not found' },
  { status: 404 }
  );
  }

  // Update trainee is_verified status

const traineeId = record.trainee_id;

  if (!traineeId) {
  logger.error('[2FA] OTP record missing trainee_id', { email, recordId: record.id });
  return NextResponse.json(
  { error: 'Trainee not linked to verification' },
  { status: 400 }
  );
  }

const { error: updateError } = await supabaseAdmin
  .from('trainees')
  .update({ is_verified: true })
  .eq('id', traineeId);

  if (updateError) {
  logger.error('[2FA] Failed to update trainee verification status', {
  traineeId,
  error: updateError,
  });
  return NextResponse.json(
  { error: 'Failed to complete verification' },
  { status: 500 }
  );
  }

  // Mark OTP as verified

await markOTPAsVerified(record.id);

  logger.info('[2FA] Verification successful', { email, traineeId });

  // Log to audit_logs

await supabaseAdmin.from('audit_logs').insert({
  tenant_id: null,
  action: '2fa.verified',
  entity_type: 'trainee',
  entity_id: traineeId,
  details: {
  email,
  method: '2fa',
  },
  });

  return NextResponse.json(
  {
  success: true,
  traineeId,
  message: '2FA verification successful',
  },
  { status: 200 }
  );
  } catch (error: any) {
  logger.error('[2FA] Verification error', { error: error?.message });
  return NextResponse.json(
  { error: 'Failed to verify 2FA code' },
  { status: 500 }
  );
  }
}
