/**
 * POST /api/auth/forgot-password
 *
 * Initiate password reset by sending an OTP to the user's email.
 *
 * This is step 1 of the password reset flow:
 *   1. User requests password reset with email
 *   2. System generates OTP and sends to email
 *   3. User enters OTP on frontend
 *
 * Request body:
 * {
 *   "email": "user@example.com"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Password reset code sent to your email",
 *   "expiresIn": 900
 * }
 *
 * Security: Does not reveal whether email exists (prevents user enumeration)
 *
 * Error responses:
 * - 400: Invalid email format
 * - 429: Too many reset requests (rate limited)
 * - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { createOTPVerification } from '@/services/otpService';
import { sendPasswordResetOtpEmail } from '@/services/emailService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

interface ForgotPasswordRequest {
  email: string;
}

// Rate limiting: track reset requests per email per hour
const resetAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_RESET_ATTEMPTS_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

function checkRateLimit(email: string): boolean {
  const now = Date.now();
  const existing = resetAttempts.get(email);

  if (!existing) {
  resetAttempts.set(email, { count: 1, resetAt: now + HOUR_MS });
  return true;
  }

if (now > existing.resetAt) {
  resetAttempts.set(email, { count: 1, resetAt: now + HOUR_MS });
  return true;
  }

if (existing.count >= MAX_RESET_ATTEMPTS_PER_HOUR) {
  return false;
  }

  existing.count++;
  return true;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
  const body: ForgotPasswordRequest = await request.json();
  const { email } = body;

  // Validate input

if (!email) {
  return NextResponse.json(
  { error: 'Email is required' },
  { status: 400 }
  );
  }

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
  return NextResponse.json(
  { error: 'Invalid email format' },
  { status: 400 }
  );
  }

const normalizedEmail = email.toLowerCase().trim();

  logger.info('[PASSWORD_RESET] Forgot password request', { email: normalizedEmail });

  // Check rate limit

if (!checkRateLimit(normalizedEmail)) {
  logger.warn('[PASSWORD_RESET] Rate limit exceeded', { email: normalizedEmail });
  return NextResponse.json(
  {
  error: 'Too many reset requests. Please try again in an hour.',
  },
  { status: 429 }
  );
  }

  // Find user by email (case-insensitive)

const { data: user, error: userError } = await supabaseAdmin
  .from('users')
  .select('id, email')
  .ilike('email', normalizedEmail)
  .single();

  // Always return same response for security (prevent user enumeration)
  if (userError || !user) {
  logger.info('[PASSWORD_RESET] Email not found in system', { email: normalizedEmail });
  // Don't reveal that user doesn't exist

return NextResponse.json(
  {
  success: true,
  message: 'If this email is registered, you will receive a reset code shortly.',
  expiresIn: 900,
  },
  { status: 200 }
  );
  }

  // Generate OTP

const otpResponse = await createOTPVerification({
  email: user.email,
  type: 'password_reset',
  userId: user.id,
  expiryMinutes: 15,
  maxAttempts: 5,
  });

  logger.debug('[PASSWORD_RESET] OTP generated', {
  userId: user.id,
  verificationId: otpResponse.verificationId,
  });

  // Send email

const emailResult = await sendPasswordResetOtpEmail({
  tenantId: user.id, // Use user ID as tenant identifier for platform-level operation
  recipientEmail: user.email,
  otpCode: otpResponse.code,
  });

  if (!emailResult.success) {
  logger.error('[PASSWORD_RESET] Failed to send email', {
  userId: user.id,
  error: emailResult.error,
  });
  // Still return success to user for security

return NextResponse.json(
  {
  success: true,
  message: 'If this email is registered, you will receive a reset code shortly.',
  expiresIn: 900,
  },
  { status: 200 }
  );
  }

  logger.info('[PASSWORD_RESET] Reset code sent', { userId: user.id });

  // Log to audit_logs

await supabaseAdmin.from('audit_logs').insert({
  tenant_id: null,
  user_id: user.id,
  action: 'password_reset.requested',
  entity_type: 'user',
  entity_id: user.id,
  details: {
  email: user.email,
  method: 'email_otp',
  },
  });

  return NextResponse.json(
  {
  success: true,
  message: 'If this email is registered, you will receive a reset code shortly.',
  expiresIn: 900,
  },
  { status: 200 }
  );
  } catch (error: any) {
  logger.error('[PASSWORD_RESET] Error in forgot password', { error: error?.message });
  return NextResponse.json(
  {
  success: true,
  message: 'If this email is registered, you will receive a reset code shortly.',
  expiresIn: 900,
  },
  { status: 200 }
  );
  }
}
