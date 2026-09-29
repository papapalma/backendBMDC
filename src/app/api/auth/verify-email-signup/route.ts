/**
 * POST /api/auth/verify-email-signup
 *
 * Verify email during trainee account creation (2FA).
 *
 * This endpoint validates the OTP code sent to the trainee's email during
 * registration. It marks the trainee as email-verified upon successful validation.
 *
 * Request body:
 * {
 *   "email": "trainee@example.com",
 *   "otp": "123456"
 * }
 *
 * Response on success:
 * {
 *   "success": true,
 *   "traineeId": "uuid",
 *   "message": "Email verified successfully"
 * }
 *
 * Error responses:
 * - 400: Invalid or expired OTP, missing required fields
 * - 404: No pending verification found
 * - 429: Too many attempts (locked out)
 * - 500: Server error
 *
 * Rate limiting:
 * - 10 attempts per minute per tenant (tenant-aware)
 * - 5 OTP verification attempts before lockout
 * - Retry-After header included in 429 responses
 *
 * Security:
 * - OTP codes expire after 15 minutes
 * - Attempt counter prevents brute force attacks
 * - Lockout persists across requests until timeout
 * - All verification attempts logged to audit_logs
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyEmailSignupSchema } from '@/utils/validators';
import { validateOTP, markOTPAsVerified, getRemainingAttempts } from '@/services/otpService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { checkRateLimit, getRateLimitKey } from '@/utils/rateLimit';
import { validationErrorResponse, successResponse, errorResponse } from '@/utils/responses';

interface VerifyEmailSignupRequest {
  email: string;
  otp: string;
}

/**
 * POST handler: Verify email during signup with OTP
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: VerifyEmailSignupRequest = await request.json();

    // ────────────────────────────────────────────────────────────────────
    // STEP 1: Validate input schema
    // ────────────────────────────────────────────────────────────────────

const validation = verifyEmailSignupSchema.safeParse(body);
    if (!validation.success) {
      logger.warn('[VERIFY_EMAIL_SIGNUP] Validation failed', {
        email: body.email,
        errors: validation.error.flatten(),
      });

      return validationErrorResponse(
        Object.fromEntries(
          validation.error.errors.map((err) => [
            err.path.join('.'),
            [err.message],
          ])
        )
      );
    }

const { email, otp } = validation.data;
    const normalizedEmail = email.toLowerCase().trim();

    logger.info('[VERIFY_EMAIL_SIGNUP] Starting email verification', { email: normalizedEmail });

    // ────────────────────────────────────────────────────────────────────
    // STEP 2: Rate limiting check
    // ────────────────────────────────────────────────────────────────────

const rateLimitKey = `verify-email-signup:${normalizedEmail}`;
    const rateLimitResponse = checkRateLimit(rateLimitKey, {
      limit: 10,
      windowMs: 60 * 1000, // 1 minute
    });

    if (rateLimitResponse) {
      logger.warn('[VERIFY_EMAIL_SIGNUP] Rate limit exceeded', { email: normalizedEmail });
      return rateLimitResponse as NextResponse;
    }

    // ────────────────────────────────────────────────────────────────────
    // STEP 3: Find trainee with pending verification
    // ────────────────────────────────────────────────────────────────────

const { data: trainee, error: traineeError } = await supabaseAdmin
      .from('trainees')
      .select('id, email, is_verified')
      .ilike('email', normalizedEmail)
      .single();

    if (traineeError || !trainee) {
      logger.warn('[VERIFY_EMAIL_SIGNUP] Trainee not found', {
        email: normalizedEmail,
        error: traineeError?.message,
      });

      return errorResponse(
        'No registration found for this email. Please complete registration first.',
        404
      );
    }

    // Check if already verified

if (trainee.is_verified) {
      logger.info('[VERIFY_EMAIL_SIGNUP] Trainee already verified', {
        traineeId: trainee.id,
        email: normalizedEmail,
      });

      return successResponse(
        {
          traineeId: trainee.id,
        },
        'Email already verified',
        200
      );
    }

    // ────────────────────────────────────────────────────────────────────
    // STEP 4: Validate OTP
    // ────────────────────────────────────────────────────────────────────

const validationResult = await validateOTP(normalizedEmail, otp, '2fa');

    if (!validationResult.valid) {
      const remainingAttempts = validationResult.remainingAttempts ?? 0;

      logger.warn('[VERIFY_EMAIL_SIGNUP] OTP validation failed', {
        email: normalizedEmail,
        traineeId: trainee.id,
        error: validationResult.error,
        remainingAttempts,
      });

      // Log failed attempt to audit_logs

await supabaseAdmin.from('audit_logs').insert({
        tenant_id: null,
        action: 'email_verification.failed',
        entity_type: 'trainee',
        entity_id: trainee.id,
        details: {
          email: normalizedEmail,
          reason: validationResult.error,
          remainingAttempts,
        },
      }).catch((e) => logger.warn('[AUDIT] Failed to log verification attempt', { error: e }));

      // Return 429 if locked out

if (remainingAttempts === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Too many failed attempts. Please request a new verification code.',
            locked: true,
          },
          { status: 429, headers: { 'Retry-After': '300' } }
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: validationResult.error,
          remainingAttempts,
        },
        { status: 400 }
      );
    }

    // ────────────────────────────────────────────────────────────────────
    // STEP 5: Update trainee verification status
    // ────────────────────────────────────────────────────────────────────

const { error: updateError } = await supabaseAdmin
      .from('trainees')
      .update({
        is_verified: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', trainee.id);

    if (updateError) {
      logger.error('[VERIFY_EMAIL_SIGNUP] Failed to update trainee verification status', {
        traineeId: trainee.id,
        error: updateError,
      });

      return errorResponse(
        'Failed to complete verification. Please try again.',
        500
      );
    }

    // ────────────────────────────────────────────────────────────────────
    // STEP 6: Mark OTP as verified
    // ────────────────────────────────────────────────────────────────────

if (validationResult.record?.id) {
      try {
        await markOTPAsVerified(validationResult.record.id);
      } catch (markError) {
        logger.warn('[VERIFY_EMAIL_SIGNUP] Failed to mark OTP as verified', {
          verificationId: validationResult.record.id,
          error: markError,
        });
        // Don't fail the request - the main verification is complete
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // STEP 7: Log successful verification
    // ────────────────────────────────────────────────────────────────────

    logger.info('[VERIFY_EMAIL_SIGNUP] Email verification successful', {
      traineeId: trainee.id,
      email: normalizedEmail,
    });

    await supabaseAdmin.from('audit_logs').insert({
      tenant_id: null,
      action: 'email_verification.success',
      entity_type: 'trainee',
      entity_id: trainee.id,
      details: {
        email: normalizedEmail,
        method: 'otp',
        timestamp: new Date().toISOString(),
      },
    }).catch((e) => logger.warn('[AUDIT] Failed to log verification success', { error: e }));

    return successResponse(
      {
        traineeId: trainee.id,
      },
      'Email verified successfully',
      200
    );
  } catch (error: any) {
    logger.error('[VERIFY_EMAIL_SIGNUP] Unexpected error', {
      error: error?.message,
      stack: error?.stack,
    });

    return errorResponse(
      'An unexpected error occurred. Please try again.',
      500
    );
  }
}
