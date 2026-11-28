/**
 * POST /api/notifications/attendance-reminders
 *
 * Dispatches Web Push attendance reminders to enrolled trainees who have NOT yet
 * checked in for today's scheduled session.
 *
 * Dual authorization:
 *   1. Cron / external scheduler: `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`
 *   2. Staff / Admin manual trigger: JWT (`local_admin`, `staff_training_coordinator`, `super_admin`)
 *      with required `program_id` (scoped strictly to caller's tenant unless super_admin).
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { successResponse, forbiddenResponse, errorResponse, notFoundResponse } from '@/utils/responses';
import { attendanceService } from '@/services/attendanceService';
import { sendPushNotificationToTargets } from '@/services/pushService';
import { activityLogService } from '@/services/activityLogService';
import { getTodayDatePHT, formatHHMM12 } from '@/lib/traineeAttendanceStatus';

const reminderBodySchema = z.object({
  program_id: z.string().uuid('Invalid program ID').optional(),
  tenant_id: z.string().uuid('Invalid tenant ID').optional(),
  session_label: z.enum(['morning', 'afternoon']).optional(),
});

function hasValidCronSecret(request: NextRequest): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured || configured.length < 12) return false;

  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const headerSecret = request.headers.get('x-cron-secret')?.trim() || bearer;
  if (!headerSecret) return false;

  const expectedBuf = Buffer.from(configured, 'utf8');
  const providedBuf = Buffer.from(headerSecret, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const isCron = hasValidCronSecret(request);

  let callerTenantId: string | undefined;
  let callerUserId: string | undefined;
  let isSuperAdmin = false;

  if (!isCron) {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, userId, role, isSuperAdmin: superAdmin } = ctxResult.context;
    const allowedRoles = ['local_admin', 'staff_training_coordinator', 'super_admin'];
    if (!allowedRoles.includes(role)) {
      return forbiddenResponse('Insufficient permissions to send attendance reminders');
    }

    callerTenantId = superAdmin ? undefined : tenantId;
    callerUserId = userId;
    isSuperAdmin = superAdmin;
  }

  let rawBody: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim()) rawBody = JSON.parse(text);
  } catch {
    return errorResponse('Invalid JSON in request body', 400);
  }

  let validated: z.infer<typeof reminderBodySchema>;
  try {
    validated = reminderBodySchema.parse(rawBody);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues || (err as any).errors || [];
      return errorResponse(`Validation failed: ${issues[0]?.message || 'Invalid request'}`, 400);
    }
    return errorResponse('Validation failed', 400);
  }

  // Manual staff triggers must specify a program_id to prevent accidental tenant-wide blasts
  if (!isCron && !validated.program_id) {
    return errorResponse('program_id is required when triggering attendance reminders manually', 400);
  }

  const today = getTodayDatePHT();

  // 1. Load target sessions scheduled for today
  let sessionQuery = supabaseAdmin
    .from('program_sessions')
    .select('id, program_id, tenant_id, title, session_date, program:programs!inner(id, name, status, deleted_at)')
    .eq('session_date', today)
    .neq('status', 'cancelled')
    .is('program.deleted_at', null);

  if (validated.program_id) {
    sessionQuery = sessionQuery.eq('program_id', validated.program_id);
  }
  const effectiveTenantFilter = callerTenantId || (isCron || isSuperAdmin ? validated.tenant_id : undefined);
  if (effectiveTenantFilter) {
    sessionQuery = sessionQuery.eq('tenant_id', effectiveTenantFilter);
  }

  const { data: todaySessions, error: sessErr } = await sessionQuery;
  if (sessErr) throw sessErr;

  if (!todaySessions || todaySessions.length === 0) {
    if (!isCron && validated.program_id) {
      return notFoundResponse('No session is scheduled for this program today');
    }
    return successResponse(
      {
        date: today,
        programsChecked: 0,
        pendingTrainees: 0,
        pushSent: 0,
        pushFailed: 0,
        pushRemoved: 0,
      },
      'No sessions scheduled for today'
    );
  }

  let totalPending = 0;
  let totalPushSent = 0;
  let totalPushFailed = 0;
  let totalPushRemoved = 0;
  let programsProcessed = 0;
  const programSummaries: Array<{
    programId: string;
    programName: string;
    sessionLabel: 'morning' | 'afternoon';
    pendingTrainees: number;
    pushSent: number;
  }> = [];

  for (const session of todaySessions as any[]) {
    const programId = session.program_id as string;
    const tenantId = session.tenant_id as string;
    const programName = session.program?.name || 'Training Program';

    // Skip if today is a global or program-specific non-attendance exception
    const { data: exceptions } = await supabaseAdmin
      .from('attendance_exceptions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('exception_date', today)
      .in('exception_type', ['no_attendance_day', 'holiday'])
      .or(`program_id.is.null,program_id.eq.${programId}`)
      .limit(1);

    if (exceptions && exceptions.length > 0) {
      continue;
    }

    // Determine morning vs afternoon slot
    const windowStatus = await attendanceService
      .getCurrentWindowStatus(programId, tenantId)
      .catch(() => null);
    const resolvedSlot: 'morning' | 'afternoon' =
      validated.session_label ||
      windowStatus?.session_label ||
      (new Date().getUTCHours() + 8 >= 12 ? 'afternoon' : 'morning');

    // Fetch active enrolled trainees for this program
    const { data: enrollments, error: enrollErr } = await supabaseAdmin
      .from('enrollments')
      .select('trainee_id')
      .eq('program_id', programId)
      .eq('tenant_id', tenantId)
      .in('status', ['enrolled', 'active']);

    if (enrollErr) throw enrollErr;
    const enrolledTraineeIds = Array.from(
      new Set((enrollments || []).map((e: any) => e.trainee_id).filter(Boolean))
    ) as string[];

    if (enrolledTraineeIds.length === 0) continue;

    // Fetch today's existing attendance rows for this session
    const { data: attRows, error: attErr } = await supabaseAdmin
      .from('attendance')
      .select('trainee_id, status, morning_status, afternoon_status, morning_time_in, afternoon_time_out')
      .eq('session_id', session.id);

    if (attErr) throw attErr;

    const doneSet = new Set<string>();
    for (const r of attRows || []) {
      if (r.status === 'excused') {
        doneSet.add(r.trainee_id);
        continue;
      }
      const morningOk =
        r.morning_status === 'present' ||
        r.morning_status === 'late' ||
        Boolean(r.morning_time_in);
      const afternoonOk =
        r.afternoon_status === 'present' ||
        r.afternoon_status === 'late' ||
        Boolean(r.afternoon_time_out);
      if (resolvedSlot === 'morning' && morningOk) doneSet.add(r.trainee_id);
      if (resolvedSlot === 'afternoon' && afternoonOk) doneSet.add(r.trainee_id);
    }

    const pendingTraineeIds = enrolledTraineeIds.filter((tid) => !doneSet.has(tid));
    programsProcessed++;

    if (pendingTraineeIds.length === 0) {
      programSummaries.push({
        programId,
        programName,
        sessionLabel: resolvedSlot,
        pendingTrainees: 0,
        pushSent: 0,
      });
      continue;
    }

    // Respect per-trainee notification opt-out preferences
    const { data: prefsRows } = await supabaseAdmin
      .from('trainee_notification_preferences')
      .select('trainee_id, push_enabled, event_reminders')
      .eq('tenant_id', tenantId)
      .in('trainee_id', pendingTraineeIds);

    const optedOutSet = new Set<string>();
    for (const pref of prefsRows || []) {
      if (pref.push_enabled === false || pref.event_reminders === false) {
        optedOutSet.add(pref.trainee_id);
      }
    }

    const eligibleTraineeIds = pendingTraineeIds.filter((tid) => !optedOutSet.has(tid));
    totalPending += pendingTraineeIds.length;

    if (eligibleTraineeIds.length === 0) {
      programSummaries.push({
        programId,
        programName,
        sessionLabel: resolvedSlot,
        pendingTrainees: pendingTraineeIds.length,
        pushSent: 0,
      });
      continue;
    }

    // Resolve linked user_ids so push_subscriptions matches whether registered by user_id or trainee_id
    const [accountsRes, traineesRes] = await Promise.all([
      supabaseAdmin
        .from('trainee_accounts')
        .select('user_id')
        .in('trainee_id', eligibleTraineeIds),
      supabaseAdmin
        .from('trainees')
        .select('user_id')
        .in('id', eligibleTraineeIds)
        .not('user_id', 'is', null),
    ]);

    const userIds = Array.from(
      new Set([
        ...(accountsRes.data || []).map((a: any) => a.user_id),
        ...(traineesRes.data || []).map((t: any) => t.user_id),
      ].filter(Boolean))
    ) as string[];

    const slotCapitalized = resolvedSlot === 'morning' ? 'Morning' : 'Afternoon';
    const openTime = resolvedSlot === 'morning' ? windowStatus?.morning_open : windowStatus?.afternoon_open;
    const closeTime = resolvedSlot === 'morning' ? windowStatus?.morning_close : windowStatus?.afternoon_close;
    const timeSuffix = openTime && closeTime ? ` (${formatHHMM12(openTime)} – ${formatHHMM12(closeTime)})` : '';

    const pushResult = await sendPushNotificationToTargets(
      tenantId,
      { userIds, traineeIds: eligibleTraineeIds },
      {
        title: `${slotCapitalized} Attendance Reminder`,
        body: `Don't forget to submit your ${resolvedSlot} attendance for ${programName}${timeSuffix}.`,
        tag: `attendance-reminder-${today}-${resolvedSlot}`,
        url: '/trainee/attendance',
        data: {
          type: 'attendance-reminder',
          programId,
          sessionId: session.id,
          date: today,
          sessionLabel: resolvedSlot,
        },
      }
    );

    totalPushSent += pushResult.sent;
    totalPushFailed += pushResult.failed;
    totalPushRemoved += pushResult.removed;

    programSummaries.push({
      programId,
      programName,
      sessionLabel: resolvedSlot,
      pendingTrainees: pendingTraineeIds.length,
      pushSent: pushResult.sent,
    });

    if (callerUserId) {
      await activityLogService.logAction(
        callerUserId,
        'send_attendance_reminder',
        'program',
        programId,
        {
          date: today,
          sessionLabel: resolvedSlot,
          pendingTrainees: pendingTraineeIds.length,
          pushSent: pushResult.sent,
        },
        undefined,
        tenantId
      );
    }
  }

  return successResponse(
    {
      date: today,
      programsChecked: programsProcessed,
      pendingTrainees: totalPending,
      pushSent: totalPushSent,
      pushFailed: totalPushFailed,
      pushRemoved: totalPushRemoved,
      programs: programSummaries,
    },
    totalPending === 0
      ? 'All enrolled trainees have already recorded attendance for this session'
      : `Attendance reminders processed for ${totalPending} pending trainee(s) (${totalPushSent} push delivered)`
  );
});
