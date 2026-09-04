/**
 * POST /api/trainees/[id]/request-email-change
 *
 * Request to change a trainee's email address.
 *
 * This initiates the email change flow by:
 *   1. Validating the new email is not already in use
 *   2. Generating an OTP code
 *   3. Sending verification email to the NEW address
 *   4. Requiring trainee to verify they own the new email
 *
 * Request body:
 * { *   "newEmail": "newemail@example.com"
 * }
 *
 * Response:
 * { *   "success": true,
 *   "message": "Verification email sent to newemail@example.com",
 *   "expiresIn": 900
 * }
 *
 * Error responses:
 * - 400: Invalid email format or email already in use
 * - 404: Trainee not found
 * - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { createOTPVerification } from '@/services/otpService';
import { sendEmailChangeOtpEmail } from '@/services/emailService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { requireTenantContext } from '@/middleware/tenantContext';

interface RequestEmailChangeRequest { newEmail: string; }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> { try { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;

  const { id } = await params;
  const traineeId = id;
  const body: RequestEmailChangeRequest = await request.json();
  const { newEmail } = body;

  // Validate input

if (!newEmail) { return NextResponse.json(
  { error: 'New email is required' },
  { status: 400 }
  ); }

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(newEmail)) { return NextResponse.json(
  { error: 'Invalid email format' },
  { status: 400 }
  ); }

const normalizedEmail = newEmail.toLowerCase().trim();

  logger.info('[EMAIL_CHANGE] Request to change email', { traineeId, newEmail: normalizedEmail });

  // Get trainee and verify ownership

const { data: trainee, error: traineeError } = await supabaseAdmin
  .from('trainees')
  .select('id, tenant_id, first_name, email')
  .eq('id', traineeId)
  .eq('tenant_id', context.tenantId)
  .single();

  if (traineeError || !trainee) { logger.warn('[EMAIL_CHANGE] Trainee not found', { traineeId, tenantId: context.tenantId });
  return NextResponse.json(
  { error: 'Trainee not found' },
  { status: 404 }
  ); }

  // Check if new email is the same as current email

if (trainee.email === normalizedEmail) { logger.info('[EMAIL_CHANGE] New email same as current', { traineeId });
  return NextResponse.json(
  { error: 'New email must be different from current email' },
  { status: 400 }
  ); }

  // Check if new email already in use in trainees table
  const { data: existingTrainee, error: existingTraineeError } = await supabaseAdmin
  .from('trainees')
  .select('id')
  .eq('email', normalizedEmail)
  .eq('tenant_id', context.tenantId)
  .maybeSingle();

  if (existingTraineeError && existingTraineeError.code !== 'PGRST116') { logger.error('[EMAIL_CHANGE] Error checking email uniqueness', { error: existingTraineeError });
  return NextResponse.json(
  { error: 'Database error' },
  { status: 500 }
  ); }

if (existingTrainee) { logger.warn('[EMAIL_CHANGE] Email already in use', { newEmail: normalizedEmail, traineeId });
  return NextResponse.json(
  { error: 'This email is already registered' },
  { status: 400 }
  ); }

  // Check if new email already in use in users table
  const { data: existingUser, error: existingUserError } = await supabaseAdmin
  .from('users')
  .select('id')
  .ilike('email', normalizedEmail)
  .maybeSingle();

  if (existingUserError && existingUserError.code !== 'PGRST116') { logger.error('[EMAIL_CHANGE] Error checking users table', { error: existingUserError });
  return NextResponse.json(
  { error: 'Database error' },
  { status: 500 }
  ); }

if (existingUser) { logger.warn('[EMAIL_CHANGE] Email already registered as user', { newEmail: normalizedEmail });
  return NextResponse.json(
  { error: 'This email is already registered' },
  { status: 400 }
  ); }

  // Generate OTP

const otpResponse = await createOTPVerification({ email: normalizedEmail,
  type: 'email_change',
  traineeId,
  expiryMinutes: 15,
  maxAttempts: 5, });

  logger.debug('[EMAIL_CHANGE] OTP generated', { traineeId, verificationId: otpResponse.verificationId });

  // Send verification email to NEW address

const emailResult = await sendEmailChangeOtpEmail({ tenantId: context.tenantId,
  recipientEmail: normalizedEmail,
  otpCode: otpResponse.code, });

  if (!emailResult.success) { logger.error('[EMAIL_CHANGE] Failed to send verification email', { traineeId,
  error: emailResult.error, });
  return NextResponse.json(
  { error: 'Failed to send verification email' },
  { status: 500 }
  ); }

  logger.info('[EMAIL_CHANGE] Verification email sent', { traineeId, newEmail: normalizedEmail });

  // Log to audit_logs

await supabaseAdmin.from('audit_logs').insert({ tenant_id: context.tenantId,
  user_id: context.userId,
  action: 'email_change.requested',
  entity_type: 'trainee',
  entity_id: traineeId,
  details: { oldEmail: trainee.email,
  newEmail: normalizedEmail, }, });

  return NextResponse.json(
  { success: true,
  message: `Verification email sent to ${normalizedEmail}`,
  expiresIn: 900, },
  { status: 200 }
  ); } catch (error: any) { logger.error('[EMAIL_CHANGE] Error in request-email-change', { error: error?.message });
  return NextResponse.json(
  { error: 'Failed to process email change request' },
  { status: 500 }
  ); } }
