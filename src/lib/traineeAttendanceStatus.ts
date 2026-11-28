import { supabaseAdmin } from '@/lib/supabase-admin';
import { resolveTraineeForUser } from '@/lib/resolveTraineeId';
import { attendanceService } from '@/services/attendanceService';
import { getPHTDateComponents } from '@/lib/timezone';

export interface TodayAttendanceStatus {
  date: string;
  hasSession: boolean;
  isExcludedDay: boolean;
  sessionId: string | null;
  sessionTitle: string | null;
  programId: string | null;
  programName: string | null;
  morningDone: boolean;
  afternoonDone: boolean;
  needsAttendance: boolean;
  pendingSessionLabel: 'morning' | 'afternoon' | null;
  windowOpen: boolean;
  windowSessionLabel: 'morning' | 'afternoon' | null;
  windowOpenTime: string | null;
  windowCloseTime: string | null;
  secondsUntilOpen: number | null;
  secondsUntilClose: number | null;
}

export function getTodayDatePHT(): string {
  const c = getPHTDateComponents(new Date());
  const month = String(c.month + 1).padStart(2, '0');
  const day = String(c.date).padStart(2, '0');
  return `${c.year}-${month}-${day}`;
}

export function formatHHMM12(hhmm?: string | null): string {
  if (!hhmm) return '';
  const [hStr, mStr = '00'] = hhmm.split(':');
  const h = Number(hStr);
  if (!Number.isFinite(h)) return hhmm;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mStr.slice(0, 2)} ${ampm}`;
}

/**
 * Pure helper computing whether a trainee still needs to submit attendance today.
 * Follows high signal-to-noise gating: returns false on weekends/holidays/no-session
 * days, excused absences, and once the active/current slot has been submitted.
 */
export function evaluateNeedsAttendance(params: {
  hasSession: boolean;
  isExcludedDay: boolean;
  isExcused: boolean;
  morningDone: boolean;
  afternoonDone: boolean;
  windowSessionLabel: 'morning' | 'afternoon' | null;
  hasSchedule: boolean;
}): { needsAttendance: boolean; pendingSessionLabel: 'morning' | 'afternoon' | null } {
  if (!params.hasSession || params.isExcludedDay || params.isExcused) {
    return { needsAttendance: false, pendingSessionLabel: null };
  }

  if (params.windowSessionLabel === 'morning') {
    return {
      needsAttendance: !params.morningDone,
      pendingSessionLabel: !params.morningDone ? 'morning' : null,
    };
  }

  if (params.windowSessionLabel === 'afternoon') {
    return {
      needsAttendance: !params.afternoonDone,
      pendingSessionLabel: !params.afternoonDone ? 'afternoon' : null,
    };
  }

  // Both windows already closed for today (or no schedule defined)
  if (params.hasSchedule) {
    // Only flag if trainee has zero check-ins recorded at all today
    const missedCompletely = !params.morningDone && !params.afternoonDone;
    return {
      needsAttendance: missedCompletely,
      pendingSessionLabel: null,
    };
  }

  const anyDone = params.morningDone || params.afternoonDone;
  return {
    needsAttendance: !anyDone,
    pendingSessionLabel: !anyDone ? 'morning' : null,
  };
}

/**
 * Resolve today's attendance reminder status for a trainee (by userId + tenantId,
 * or directly with an already-resolved traineeId & programId).
 */
export async function getTraineeTodayAttendanceStatus(params: {
  userId?: string;
  traineeId?: string;
  tenantId: string;
  programId?: string | null;
  programName?: string | null;
}): Promise<TodayAttendanceStatus> {
  const today = getTodayDatePHT();
  const emptyStatus: TodayAttendanceStatus = {
    date: today,
    hasSession: false,
    isExcludedDay: false,
    sessionId: null,
    sessionTitle: null,
    programId: params.programId ?? null,
    programName: params.programName ?? null,
    morningDone: false,
    afternoonDone: false,
    needsAttendance: false,
    pendingSessionLabel: null,
    windowOpen: false,
    windowSessionLabel: null,
    windowOpenTime: null,
    windowCloseTime: null,
    secondsUntilOpen: null,
    secondsUntilClose: null,
  };

  let traineeId = params.traineeId ?? null;
  if (!traineeId && params.userId) {
    const resolved = await resolveTraineeForUser(params.userId, 'trainee');
    traineeId = resolved?.id ?? null;
  }
  if (!traineeId) return emptyStatus;

  let programId = params.programId ?? null;
  let programName = params.programName ?? null;

  if (!programId) {
    const { data: enrollment } = await supabaseAdmin
      .from('enrollments')
      .select('program_id, program:programs(id, name)')
      .eq('trainee_id', traineeId)
      .in('status', ['enrolled', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    programId = enrollment?.program_id ?? null;
    programName = (enrollment as any)?.program?.name ?? null;
  }

  if (!programId) return emptyStatus;

  const [sessionRes, exceptionRes, windowStatus] = await Promise.all([
    supabaseAdmin
      .from('program_sessions')
      .select('id, title, session_date, status')
      .eq('program_id', programId)
      .eq('session_date', today)
      .neq('status', 'cancelled')
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('attendance_exceptions')
      .select('id')
      .eq('tenant_id', params.tenantId)
      .eq('exception_date', today)
      .in('exception_type', ['no_attendance_day', 'holiday'])
      .or(`program_id.is.null,program_id.eq.${programId}`)
      .limit(1),
    attendanceService.getCurrentWindowStatus(programId, params.tenantId).catch(() => null),
  ]);

  const todaySession = sessionRes.data ?? null;
  const isExcludedDay = Boolean(exceptionRes.data && exceptionRes.data.length > 0);

  if (!programName && programId) {
    const { data: prog } = await supabaseAdmin
      .from('programs')
      .select('name')
      .eq('id', programId)
      .maybeSingle();
    programName = prog?.name ?? null;
  }

  let morningDone = false;
  let afternoonDone = false;
  let isExcused = false;

  if (todaySession) {
    const { data: attRecord } = await supabaseAdmin
      .from('attendance')
      .select('status, morning_status, afternoon_status, morning_time_in, afternoon_time_out, check_in_time, check_out_time')
      .eq('session_id', todaySession.id)
      .eq('trainee_id', traineeId)
      .maybeSingle();

    if (attRecord) {
      isExcused = attRecord.status === 'excused';
      morningDone =
        attRecord.morning_status === 'present' ||
        attRecord.morning_status === 'late' ||
        Boolean(attRecord.morning_time_in);
      afternoonDone =
        attRecord.afternoon_status === 'present' ||
        attRecord.afternoon_status === 'late' ||
        Boolean(attRecord.afternoon_time_out);

      // Legacy manual mark without morning/afternoon split
      if (!morningDone && !afternoonDone && (attRecord.status === 'present' || attRecord.status === 'late')) {
        morningDone = true;
        if (attRecord.check_out_time) afternoonDone = true;
      }
    }
  }

  const hasSchedule = Boolean(windowStatus?.morning_open || windowStatus?.afternoon_open);
  const { needsAttendance, pendingSessionLabel } = evaluateNeedsAttendance({
    hasSession: Boolean(todaySession),
    isExcludedDay,
    isExcused,
    morningDone,
    afternoonDone,
    windowSessionLabel: windowStatus?.session_label ?? null,
    hasSchedule,
  });

  return {
    date: today,
    hasSession: Boolean(todaySession),
    isExcludedDay,
    sessionId: todaySession?.id ?? null,
    sessionTitle: todaySession?.title ?? null,
    programId,
    programName,
    morningDone,
    afternoonDone,
    needsAttendance,
    pendingSessionLabel,
    windowOpen: Boolean(windowStatus?.isOpen),
    windowSessionLabel: windowStatus?.session_label ?? null,
    windowOpenTime: windowStatus?.window_open ?? null,
    windowCloseTime: windowStatus?.window_close ?? null,
    secondsUntilOpen: windowStatus?.seconds_until_open ?? null,
    secondsUntilClose: windowStatus?.seconds_until_close ?? null,
  };
}
