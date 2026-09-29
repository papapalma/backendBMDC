/**
 * POST /api/trainees/[id]/confirm-email-change
 *
 * Confirm email change by verifying OTP sent to the new email address.
 *
 * This is step 2 of the email change flow:
 *   1. User requested email change, OTP sent to new email
 *   2. User enters OTP from email verification link/email body
 *   3. System updates trainee.email and linked user.email (if exists)
 *   4. Change is logged to audit_logs for compliance
 *
 * Request body:
 * { *   "newEmail": "newemail@example.com",
 *   "code": "123456"
 * }
 *
 * Response:
 * { *   "success": true,
 *   "message": "Email changed successfully",
 *   "newEmail": "newemail@example.com"
 * }
 *
 * Error responses:
 * - 400: Invalid or expired OTP
 * - 404: Trainee not found
 * - 429: Too many attempts
 * - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateOTP, markOTPAsVerified } from '@/services/otpService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { requireTenantContext } from '@/middleware/tenantContext';

interface ConfirmEmailChangeRequest { newEmail: string;
  code: string; }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> { try { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;

  const { id: traineeId } = await params;
  const body: ConfirmEmailChangeRequest = await request.json();
  const { newEmail, code } = body;

  // Validate input

if (!newEmail || !code) { return NextResponse.json(
  { error: 'New email and verification code are required' },
  { status: 400 }
  ); }

if (code.length !== 6 || !/^\d+$/.test(code)) { return NextResponse.json(
  { error: 'Code must be 6 digits' },
  { status: 400 }
  ); }

const normalizedEmail = newEmail.toLowerCase().trim();

  logger.info('[EMAIL_CHANGE] Confirming email change', { traineeId, newEmail: normalizedEmail });

  // Get trainee

const { data: trainee, error: traineeError } = await supabaseAdmin
  .from('trainees')
  .select('id, tenant_id, user_id, email')
  .eq('id', traineeId)
  .eq('tenant_id', context.tenantId)
  .single();

  if (traineeError || !trainee) { logger.warn('[EMAIL_CHANGE] Trainee not found', { traineeId });
  return NextResponse.json(
  { error: 'Trainee not found' },
  { status: 404 }
  ); }

  // Validate OTP

const validationResult = await validateOTP(normalizedEmail, code, 'email_change');

  if (!validationResult.valid) { const remainingAttempts = validationResult.remainingAttempts ?? 0;

  logger.warn('[EMAIL_CHANGE] OTP validation failed', { traineeId,
  newEmail: normalizedEmail,
  error: validationResult.error,
  remainingAttempts, });

  // Return 429 if locked out

if (remainingAttempts === 0) { return NextResponse.json(
  { error: 'Too many failed attempts. Please request a new email change.',
  locked: true, },
  { status: 429 }
  ); }

  return NextResponse.json(
  { error: validationResult.error,
  remainingAttempts, },
  { status: 400 }
  ); }

if (!validationResult.record) { logger.error('[EMAIL_CHANGE] No OTP record after validation', { traineeId, newEmail: normalizedEmail });
  return NextResponse.json(
  { error: 'Verification failed' },
  { status: 500 }
  ); }

const oldEmail = trainee.email;

  // Update trainee email

const { error: updateTraineeError } = await supabaseAdmin
  .from('trainees')
  .update({ email: normalizedEmail,
  updated_at: new Date().toISOString(), })
  .eq('id', traineeId);

  if (updateTraineeError) { logger.error('[EMAIL_CHANGE] Failed to update trainee email', { traineeId,
  error: updateTraineeError, });
  return NextResponse.json(
  { error: 'Failed to update email' },
  { status: 500 }
  ); }

  logger.info('[EMAIL_CHANGE] Trainee email updated', { traineeId, oldEmail, newEmail: normalizedEmail });

  // If trainee has linked user account, update user email as well

if (trainee.user_id) { const { error: updateUserError } = await supabaseAdmin
  .from('users')
  .update({ email: normalizedEmail,
  updated_at: new Date().toISOString(), })
  .eq('id', trainee.user_id);

  if (updateUserError) { logger.error('[EMAIL_CHANGE] Failed to update user email', { userId: trainee.user_id,
  error: updateUserError, });
  // Don't fail the entire operation, but log the issue

await supabaseAdmin.from('audit_logs').insert({ tenant_id: context.tenantId,
  action: 'email_change.user_sync_failed',
  entity_type: 'trainee',
  entity_id: traineeId,
  details: { traineeEmailChanged: true,
  userEmailFailedToUpdate: true,
  userId: trainee.user_id,
  error: updateUserError?.message, }, }); } else { logger.info('[EMAIL_CHANGE] User email updated', { userId: trainee.user_id,
  newEmail: normalizedEmail, }); } }

  // Mark OTP as verified

await markOTPAsVerified(validationResult.record.id);

  logger.info('[EMAIL_CHANGE] Email change completed successfully', { traineeId,
  oldEmail,
  newEmail: normalizedEmail, });

  // Log to audit_logs with compliance details (RA 10173)

await supabaseAdmin.from('audit_logs').insert({ tenant_id: context.tenantId,
  user_id: context.userId,
  action: 'email_change.completed',
  entity_type: 'trainee',
  entity_id: traineeId,
  details: { oldEmail,
  newEmail: normalizedEmail,
  linkedUserId: trainee.user_id || null,
  method: 'otp_verification',
  timestamp: new Date().toISOString(), }, });

  return NextResponse.json(
  { success: true,
  message: 'Email changed successfully',
  newEmail: normalizedEmail, },
  { status: 200 }
  ); } catch (error: any) { logger.error('[EMAIL_CHANGE] Error in confirm-email-change', { error: error?.message });
  return NextResponse.json(
  { error: 'Failed to confirm email change' },
  { status: 500 }
  ); } }
