/**
 * POST /api/programs/[id]/notify-trainees
 *
 * Send program availability notifications to all interested trainees in the tenant.
 *
 * This endpoint is typically called when a program is published or status changes.
 * It respects both:
 *   - Tenant-level configuration (notifications enabled/disabled globally)
 *   - Trainee-level preferences (individual opt-in/opt-out)
 *
 * Features:
 *   - Batch sending with rate limiting
 *   - Circuit breaker for failure handling
 *   - Progress checkpointing
 *   - Retry logic for failed sends
 *   - Comprehensive audit logging
 *
 * Request body:
 * { *   "sendNow": true
 * }
 *
 * Response:
 * { *   "success": true,
 *   "batchJobId": "uuid",
 *   "totalRecipients": 150,
 *   "estimatedDurationSeconds": 30
 * }
 *
 * Error responses:
 * - 400: Invalid program or no recipients
 * - 404: Program not found
 * - 500: Server error
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendBatchEmails, getBatchJobStatus } from '@/services/emailBatchService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { requireTenantContext } from '@/middleware/tenantContext';

interface NotifyTraineesRequest { sendNow?: boolean; }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> { try { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;

  const { id: programId } = await params;
  const body: NotifyTraineesRequest = await request.json();
  const { sendNow = true } = body;

  logger.info('[PROGRAM_NOTIFY] Starting program notification process', { programId,
  tenantId: context.tenantId,
  sendNow, });

  // Get program details

const { data: program, error: programError } = await supabaseAdmin
  .from('programs')
  .select('id, name, description, duration_weeks, start_date, level, tenant_id')
  .eq('id', programId)
  .eq('tenant_id', context.tenantId)
  .single();

  if (programError || !program) { logger.warn('[PROGRAM_NOTIFY] Program not found', { programId, tenantId: context.tenantId });
  return NextResponse.json(
  { error: 'Program not found' },
  { status: 404 }
  ); }

  logger.info('[PROGRAM_NOTIFY] Program found', { programId,
  programName: program.name, });

  // Check if notifications are enabled for this tenant
  const { data: tenant, error: tenantError } = await supabaseAdmin
  .from('tenants')
  .select('configuration')
  .eq('id', context.tenantId)
  .single();

  if (tenantError || !tenant) { logger.error('[PROGRAM_NOTIFY] Tenant not found', { tenantId: context.tenantId });
  return NextResponse.json(
  { error: 'Tenant not found' },
  { status: 500 }
  ); }

const tenantConfig = tenant.configuration || {};
  const notificationsConfig = tenantConfig.notifications || {};
  const emailConfig = notificationsConfig.email || {};
  const notificationsEnabled = emailConfig.defaultProgramNotifications !== false; // Default to true

if (!notificationsEnabled) { logger.info('[PROGRAM_NOTIFY] Program notifications disabled for tenant', { tenantId: context.tenantId, });
  return NextResponse.json(
  { success: true,
  message: 'Program notifications are disabled for this tenant',
  batchJobId: null,
  totalRecipients: 0, },
  { status: 200 }
  ); }

  // Get all trainees in the tenant who want program notifications

const { data: trainees, error: traineesError } = await supabaseAdmin
  .from('trainees')
  .select('id, email, first_name, tenant_id')
  .eq('tenant_id', context.tenantId)
  .eq('notify_on_program_posting', true)
  .eq('status', 'active');

  if (traineesError) { logger.error('[PROGRAM_NOTIFY] Failed to fetch trainees', { error: traineesError });
  return NextResponse.json(
  { error: 'Failed to fetch trainees' },
  { status: 500 }
  ); }

if (!trainees || trainees.length === 0) { logger.info('[PROGRAM_NOTIFY] No trainees to notify', { programId,
  tenantId: context.tenantId, });

  await supabaseAdmin.from('audit_logs').insert({ tenant_id: context.tenantId,
  user_id: context.userId,
  action: 'program_notification.no_recipients',
  entity_type: 'program',
  entity_id: programId,
  details: { programName: program.name,
  reason: 'No active trainees with notifications enabled', }, });

  return NextResponse.json(
  { success: true,
  message: 'No trainees to notify',
  batchJobId: null,
  totalRecipients: 0, },
  { status: 200 }
  ); }

  logger.info('[PROGRAM_NOTIFY] Found trainees to notify', { programId,
  count: trainees.length, });

  if (!sendNow) { logger.info('[PROGRAM_NOTIFY] Notifications queued (not sending now)', { programId });
  return NextResponse.json(
  { success: true,
  message: 'Notifications queued for sending',
  batchJobId: null,
  totalRecipients: trainees.length, },
  { status: 200 }
  ); }

  // Prepare recipients for batch send

const recipients = trainees.map((trainee: any) => ({ email: trainee.email,
  name: trainee.first_name,
  variables: { programName: program.name,
  programDescription: program.description || 'A new training program',
  duration: String(program.duration_weeks || 0),
  startDate: program.start_date || 'TBA',
  level: program.level || 'All Levels',
  enrollmentUrl: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://localhost:3000'}/programs/${programId}/enroll`, }, }));

  logger.debug('[PROGRAM_NOTIFY] Prepared recipient list', { programId,
  recipientCount: recipients.length, });

  // Send batch notifications

const batchResult = await sendBatchEmails({ tenantId: context.tenantId,
  recipients,
  template: 'program_notification',
  subject: `New Program Available: ${program.name}`,
  templateBody: '',
  batchType: 'program_notification',
  referenceId: programId, });

  logger.info('[PROGRAM_NOTIFY] Batch job created', { jobId: batchResult.jobId,
  totalRecipients: batchResult.totalRecipients,
  validRecipients: batchResult.validRecipients,
  invalidRecipients: batchResult.invalidRecipients, });

  // Log to audit_logs

await supabaseAdmin.from('audit_logs').insert({ tenant_id: context.tenantId,
  user_id: context.userId,
  action: 'program_notification.sent',
  entity_type: 'program',
  entity_id: programId,
  details: { programName: program.name,
  batchJobId: batchResult.jobId,
  totalRecipients: batchResult.totalRecipients,
  validRecipients: batchResult.validRecipients,
  invalidRecipients: batchResult.invalidRecipients,
  estimatedDuration: batchResult.estimatedDurationSeconds, }, });

  return NextResponse.json(
  { success: true,
  batchJobId: batchResult.jobId,
  totalRecipients: batchResult.totalRecipients,
  validRecipients: batchResult.validRecipients,
  invalidRecipients: batchResult.invalidRecipients,
  estimatedDurationSeconds: batchResult.estimatedDurationSeconds, },
  { status: 200 }
  ); } catch (error: any) { logger.error('[PROGRAM_NOTIFY] Error in notify-trainees', { error: error?.message });
  return NextResponse.json(
  { error: 'Failed to send notifications' },
  { status: 500 }
  ); } }

/**
 * GET /api/programs/[id]/notify-trainees?jobId=xxx
 *
 * Get status of a notification batch job.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> { try { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;

  const { id: _programId } = await params;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) { return NextResponse.json(
  { error: 'jobId parameter is required' },
  { status: 400 }
  ); }

  logger.info('[PROGRAM_NOTIFY] Getting batch job status', { jobId });

  const batchStatus = await getBatchJobStatus(jobId);

  if (!batchStatus) { return NextResponse.json(
  { error: 'Batch job not found' },
  { status: 404 }
  ); }

  return NextResponse.json(batchStatus, { status: 200 }); } catch (error: any) { logger.error('[PROGRAM_NOTIFY] Error getting job status', { error: error?.message });
  return NextResponse.json(
  { error: 'Failed to get batch status' },
  { status: 500 }
  ); } }
