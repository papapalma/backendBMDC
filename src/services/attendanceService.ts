/**
 * Attendance Service — tenant-scoped attendance tracking.
 *
 * All query methods accept an optional `tenantId` parameter. When provided,
 * queries are filtered to that tenant. Super Admin callers pass `undefined`
 * to bypass tenant filtering.
 *
 * QR code scanning validates that the scanned code belongs to the same
 * tenant as the scanner (Req 17.2, 17.3, 17.4).
 *
 * Attendance Module additions (migration 012):
 *   - getActiveSchedule          — resolve effective window for a date
 *   - getCurrentWindowStatus     — is the window open right now?
 *   - submitTraineeAttendance    — trainee self-service submission
 *   - getMonthlyCalendar         — CalendarDayData[] for a full month
 *   - getDayAttendanceForAdmin   — all records for a specific date (admin day-view)
 *   - getAttendanceStats         — extended with `pending` count
 */
import { supabaseAdmin } from '@/lib/supabase-admin';
import { fetchAllRows } from '@/lib/supabasePagination';
import {
  getNowHHMMInPHT,
  getPHTDateComponents,
  calculateDateRangeInPHT,
} from '@/lib/timezone';
import { mergeAttendanceCvVerification } from '@/lib/cvVerification';
import type {
  AttendanceCvVerification,
  SessionCvVerification,
} from '@/types/advisory';

// ---------------------------------------------------------------------------
// Shared interfaces
// ---------------------------------------------------------------------------

export interface Attendance {
  id: string;
  session_id: string;
  trainee_id: string;
  tenant_id?: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  check_in_time?: string;
  check_out_time?: string;
  scanned_by?: string;
  notes?: string;
  // Attendance module fields
  selfie_morning_path?: string;
  selfie_afternoon_path?: string;
  morning_time_in?: string;
  afternoon_time_out?: string;
  late_duration_minutes?: number;
  morning_status?: 'present' | 'late' | 'absent' | 'pending';
  afternoon_status?: 'present' | 'late' | 'absent' | 'pending';
  gps_lat?: number;
  gps_lng?: number;
  gps_accuracy?: number;
  gps_address?: string;
  device_info?: Record<string, unknown>;
  cv_verification?: AttendanceCvVerification | null;
  submission_method?: 'self_service' | 'manual' | 'qr_scan';
  attempt_number?: number;
  verified_by?: string;
  verified_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AttendanceWithDetails extends Attendance {
  trainee?: {
    id: string;
    first_name: string;
    last_name: string;
    middle_name: string;
    photo_path?: string;
  };
  session?: {
    id: string;
    title: string;
    session_date: string;
    start_time: string;
    end_time: string;
    program_id: string;
  };
}

export interface MarkAttendanceData {
  session_id: string;
  trainee_id: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  scanned_by?: string;
  notes?: string;
  tenant_id?: string;
}

/** Shape returned by getActiveSchedule — effective window for a specific date */
export interface EffectiveScheduleWindow {
  schedule_id: string;
  morning_open: string;         // HH:MM
  morning_close: string;
  morning_late_threshold: number;
  afternoon_open: string;
  afternoon_close: string;
  afternoon_late_threshold: number;
}

/** Shape returned by getCurrentWindowStatus */
export interface AttendanceWindowStatus {
  isOpen: boolean;
  session_label: 'morning' | 'afternoon' | null;
  window_open: string | null;          // HH:MM
  window_close: string | null;
  seconds_until_open: number | null;
  seconds_until_close: number | null;
  morning_open?: string | null;
  morning_close?: string | null;
  morning_late_threshold?: number | null;
  afternoon_open?: string | null;
  afternoon_close?: string | null;
  afternoon_late_threshold?: number | null;
}

export type CalendarDayStatus =
  | 'present' | 'late' | 'absent' | 'pending' | 'excused'
  | 'holiday' | 'weekend' | 'future' | 'no_session';

export interface CalendarDayData {
  date: string;  // YYYY-MM-DD
  status: CalendarDayStatus;
  record?: Attendance;
}

/** Data passed to submitTraineeAttendance */
export interface SubmitAttendanceData {
  trainee_id: string;
  session_id: string;
  session_label: 'morning' | 'afternoon';
  selfie_path: string;          // relative path stored in DB
  gps_lat?: number;
  gps_lng?: number;
  gps_accuracy?: number;
  gps_address?: string;
  device_info?: Record<string, unknown>;
  cv_verification?: SessionCvVerification | null;
  tenant_id?: string;
}

// ---------------------------------------------------------------------------
// Helper utilities — All use Philippine Time (PHT, UTC+8)
// ---------------------------------------------------------------------------

/** Convert a HH:MM string into total minutes from midnight */
function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 
 * Return the current time as HH:MM string in Philippine Time (PHT, UTC+8)
 * ponytail: uses getNowHHMMInPHT from timezone module
 */
function nowHHMM(): string {
  return getNowHHMMInPHT();
}

/** Seconds between now and a future HH:MM time today (0 if already past) */
function secondsUntil(hhmm: string): number {
  const targetMins = timeToMinutes(hhmm);
  const nowMins = timeToMinutes(nowHHMM());
  return Math.max(0, (targetMins - nowMins) * 60);
}

/** Seconds remaining until a HH:MM time today (0 if already past) */
function secondsRemaining(hhmm: string): number {
  return secondsUntil(hhmm);
}

/** 
 * Today's date as YYYY-MM-DD in Philippine Time (PHT)
 * ponytail: uses getPHTDateComponents to get PHT date
 */
function todayString(): string {
  const components = getPHTDateComponents(new Date());
  const year = components.year;
  const month = String(components.month + 1).padStart(2, '0');
  const date = String(components.date).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

/** Check if a date string (YYYY-MM-DD) is a weekend */
function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Get the last day of a month as YYYY-MM-DD */
function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0); // day 0 of next month = last day of this month
  const yearStr = d.getFullYear();
  const monthStr = String(d.getMonth() + 1).padStart(2, '0');
  const dateStr = String(d.getDate()).padStart(2, '0');
  return `${yearStr}-${monthStr}-${dateStr}`;
}

// ---------------------------------------------------------------------------
// AttendanceService class
// ---------------------------------------------------------------------------

class AttendanceService {

  // =========================================================================
  // EXISTING METHODS (preserved exactly, no behaviour changes)
  // =========================================================================

  /**
   * Get attendance records for a session, scoped to the given tenant.
   * Req 7.5, 17.2
   */
  async getAttendanceBySession(sessionId: string, tenantId?: string) {
    let query = supabaseAdmin
      .from('attendance')
      .select(`
        *,
        trainee:trainees(id, first_name, last_name, middle_name, photo_path)
      `)
      .eq('session_id', sessionId);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    query = query.order('created_at', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  /**
   * Get attendance records for a trainee, scoped to the given tenant.
   * Supports optional date filter (YYYY-MM-DD) for the details page.
   * Req 7.5, 17.2
   */
  async getAttendanceByTrainee(
    traineeId: string,
    tenantId?: string,
    dateFilter?: string
  ) {
    const sessionJoin = dateFilter
      ? 'session:program_sessions!inner(id, title, session_date, start_time, end_time, program_id, program:programs(id, name))'
      : 'session:program_sessions(id, title, session_date, start_time, end_time, program_id, program:programs(id, name))';

    let query = supabaseAdmin
      .from('attendance')
      .select(`
        *,
        ${sessionJoin}
      `)
      .eq('trainee_id', traineeId);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    // Date filter: match sessions on that specific date
    if (dateFilter) {
      query = query.eq('session.session_date', dateFilter);
    }

    query = query
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    if (dateFilter) {
      return (data || []).filter((row: any) => row.session !== null);
    }
    return data;
  }

  /**
   * Record or update an attendance entry (admin manual mark / QR scan).
   * Injects tenant_id when provided so the record is properly scoped.
   */
  async markAttendance(data: MarkAttendanceData) {
    const attendanceData: Record<string, unknown> = {
      session_id: data.session_id,
      trainee_id: data.trainee_id,
      status: data.status,
      notes: data.notes ?? null,
    };

    if (data.status === 'present' || data.status === 'late') {
      attendanceData.check_in_time = new Date().toISOString();
      attendanceData.check_out_time = null;
    } else {
      attendanceData.check_in_time = null;
      attendanceData.check_out_time = null;
    }

if (data.scanned_by) {
      attendanceData.scanned_by = data.scanned_by;
    }

if (data.tenant_id) {
      attendanceData.tenant_id = data.tenant_id;
    }

const { data: result, error } = await supabaseAdmin
      .from('attendance')
      .upsert(attendanceData, {
        onConflict: 'session_id,trainee_id',
        ignoreDuplicates: false,
      })
      .select(`
        *,
        trainee:trainees(id, first_name, last_name, middle_name, photo_path)
      `)
      .single();

    if (error) throw error;
    return result;
  }

  /**
   * Mark attendance by scanning a QR code.
   * Validates that the QR code belongs to the same tenant as the scanner.
   * Req 17.2, 17.3, 17.4
   */
  async markAttendanceByQR(
    sessionId: string,
    qrCode: string,
    scannedBy: string,
    tenantId?: string
  ): Promise<never> {
    throw new Error('QR code attendance scanning is no longer supported');
  }

  async checkOut(sessionId: string, traineeId: string) {
    const { data, error } = await supabaseAdmin
      .from('attendance')
      .update({ check_out_time: new Date().toISOString() })
      .eq('session_id', sessionId)
      .eq('trainee_id', traineeId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Bulk mark absent for all trainees in a session with no attendance record.
   */
  async bulkMarkAbsent(sessionId: string, tenantId?: string) {
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('program_sessions')
      .select('program_id, session_date')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;

    // Query enrollments table instead of trainees.program_id (3NF normalized)
    let traineesQuery = supabaseAdmin
      .from('enrollments')
      .select('trainee_id')
      .eq('program_id', session.program_id)
      .in('status', ['enrolled', 'active']);

    if (tenantId) traineesQuery = traineesQuery.eq('tenant_id', tenantId);

    const { data: trainees, error: traineesError } = await traineesQuery;
    if (traineesError) throw traineesError;

    const { data: existingAttendance, error: attendanceError } = await supabaseAdmin
      .from('attendance')
      .select('trainee_id')
      .eq('session_id', sessionId);

    if (attendanceError) throw attendanceError;

    // ponytail: one WHERE clause guards exceptions check (upgrade: move to RLS)
    // Query exceptions for this date and filter by trainee_id
    let exceptionsQuery = supabaseAdmin
      .from('attendance_exceptions')
      .select('trainee_id')
      .eq('exception_date', session.session_date);

    if (tenantId) exceptionsQuery = exceptionsQuery.eq('tenant_id', tenantId);

    const { data: exceptions, error: exceptionsError } = await exceptionsQuery;
    if (exceptionsError) throw exceptionsError;

    const existingTraineeIds = new Set(
      existingAttendance?.map((a) => a.trainee_id) || []
    );
    const exceptionTraineeIds = new Set(
      exceptions?.map((e) => e.trainee_id) || []
    );

    const absentRecords = (trainees || [])
      .filter((t) => !existingTraineeIds.has(t.trainee_id) && !exceptionTraineeIds.has(t.trainee_id))
      .map((t) => ({
        session_id: sessionId,
        trainee_id: t.trainee_id,
        status: 'absent' as const,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      }));

    const skippedCount = (trainees || []).length - existingTraineeIds.size - absentRecords.length;

    if (absentRecords.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('attendance')
        .insert(absentRecords);
      if (insertError) throw insertError;
    }

    return { markedAbsent: absentRecords.length, skipped: skippedCount };
  }

  /**
   * Get attendance statistics for a program.
   * Extended with `pending` count (attendance module).
   */
  async getAttendanceStats(programId: string, tenantId?: string) {
    const data = await fetchAllRows<any>(() => {
      let query = supabaseAdmin
        .from('attendance')
        .select(`
          status,
          morning_status,
          afternoon_status,
          session:program_sessions!inner(program_id, session_date)
        `)
        .eq('session.program_id', programId);

      if (tenantId) query = query.eq('tenant_id', tenantId);
      return query;
    });

    // Fetch excluded dates (holidays, no-attendance days) from attendance_exceptions (3NF normalized)
    const { data: exceptions, error: exceptionsError } = await supabaseAdmin
      .from('attendance_exceptions')
      .select('exception_date')
      .eq('program_id', programId)
      .in('exception_type', ['no_attendance_day', 'holiday']);

    if (exceptionsError) throw exceptionsError;
    const excludedDateSet = new Set((exceptions || []).map((e) => e.exception_date));

    const valid = (data || []).filter((a) => {
      const sessionDate = (a.session as any).session_date;
      return !excludedDateSet.has(sessionDate);
    });

    const pending = valid.filter(
      (a) => a.morning_status === 'pending' || a.afternoon_status === 'pending'
    ).length;

    return {
      total: valid.length,
      present: valid.filter((a) => a.status === 'present').length,
      absent: valid.filter((a) => a.status === 'absent').length,
      late: valid.filter((a) => a.status === 'late').length,
      excused: valid.filter((a) => a.status === 'excused').length,
      pending,
    };
  }

  /**
   * Get attendance statistics for a trainee.
   */
  async getTraineeAttendanceStats(
    traineeId: string,
    programId?: string,
    tenantId?: string
  ) {
    let query = supabaseAdmin
      .from('attendance')
      .select(`
        status,
        session:program_sessions!inner(session_date, program_id)
      `)
      .eq('trainee_id', traineeId);

    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data, error } = await query;
    if (error) throw error;

    // Fetch excluded dates from attendance_exceptions table (3NF normalized)
    let exceptionsQuery = supabaseAdmin
      .from('attendance_exceptions')
      .select('exception_date')
      .in('exception_type', ['no_attendance_day', 'holiday']);
    
    if (programId) exceptionsQuery = exceptionsQuery.eq('program_id', programId);
    
    const { data: exceptions, error: exceptionsError } = await exceptionsQuery;
    if (exceptionsError) throw exceptionsError;
    
    const excludedDateSet = new Set((exceptions || []).map((e) => e.exception_date));

    const valid = (data || []).filter((a) => {
      const session = a.session as any;
      return !excludedDateSet.has(session.session_date);
    });

    const stats = {
      total: valid.length,
      present: valid.filter((a) => a.status === 'present').length,
      absent: valid.filter((a) => a.status === 'absent').length,
      late: valid.filter((a) => a.status === 'late').length,
      excused: valid.filter((a) => a.status === 'excused').length,
      attendanceRate: 0,
    };

    if (stats.total > 0) {
      stats.attendanceRate = Math.round(
        ((stats.present + stats.late) / stats.total) * 100
      );
    }

    return stats;
  }

  // =========================================================================
  // NEW METHODS — Attendance Module (migration 012)
  // =========================================================================

  /**
   * Resolve the effective attendance schedule window for a given program and date.
   *
   * Priority:
   *   1. Check attendance_exceptions for the exact date (schedule override exception type).
   *      - is_full_day_off = true  → return null (no attendance today)
   *      - partial override        → merge custom times over base schedule
   *   2. Return the active schedule's base times.
   *   3. No active schedule → return null.
   */
  async getActiveSchedule(
    programId: string,
    date: string,
    tenantId?: string
  ): Promise<EffectiveScheduleWindow | null> {
    // Find active schedule covering this date

    let schedQuery = supabaseAdmin
      .from('attendance_schedules')
      .select('*')
      .eq('program_id', programId)
      .eq('status', 'active')
      .lte('effective_date_start', date)
      .gte('effective_date_end', date)
      .limit(1);

    if (tenantId) schedQuery = schedQuery.eq('tenant_id', tenantId);

    const { data: schedules, error: schedError } = await schedQuery;
    if (schedError) throw schedError;
    if (!schedules || schedules.length === 0) return null;

    const schedule = schedules[0];

    // Check for a single-day override in attendance_exceptions table (3NF normalized)
    const { data: override, error: overrideError } = await supabaseAdmin
      .from('attendance_exceptions')
      .select('*')
      .eq('program_id', programId)
      .eq('exception_date', date)
      .eq('exception_type', 'schedule_override')
      .maybeSingle();

    if (overrideError) throw overrideError;

    if (override) {
      if (override.is_full_day_off) return null;

      // Merge custom times — fall back to schedule base times when null
      return {
        schedule_id: schedule.id,
        morning_open:             override.custom_morning_open    ?? schedule.morning_open,
        morning_close:            override.custom_morning_close   ?? schedule.morning_close,
        morning_late_threshold:   schedule.morning_late_threshold,
        afternoon_open:           override.custom_afternoon_open  ?? schedule.afternoon_open,
        afternoon_close:          override.custom_afternoon_close ?? schedule.afternoon_close,
        afternoon_late_threshold: schedule.afternoon_late_threshold,
      };
    }

    return {
      schedule_id:              schedule.id,
      morning_open:             schedule.morning_open,
      morning_close:            schedule.morning_close,
      morning_late_threshold:   schedule.morning_late_threshold,
      afternoon_open:           schedule.afternoon_open,
      afternoon_close:          schedule.afternoon_close,
      afternoon_late_threshold: schedule.afternoon_late_threshold,
    };
  }

  /**
   * Return the current window status for a program based on server time.
   * Used by the trainee calendar page countdown and the Take Attendance button.
   * 
   * IMPORTANT: The window remains "open" (isOpen: true) for the entire period from
   * window open time through the late threshold. This means submissions are accepted
   * after the regular close time as "late" submissions. The window closes only after
   * the late threshold expires.
   */
  async getCurrentWindowStatus(
    programId: string,
    tenantId?: string
  ): Promise<AttendanceWindowStatus> {
    const today = todayString();
    const window = await this.getActiveSchedule(programId, today, tenantId);

    const closed: AttendanceWindowStatus = {
      isOpen: false,
      session_label: null,
      window_open: null,
      window_close: null,
      seconds_until_open: null,
      seconds_until_close: null,
    };

    if (!window) return closed;

    const scheduleMeta = {
      morning_open: window.morning_open,
      morning_close: window.morning_close,
      morning_late_threshold: window.morning_late_threshold,
      afternoon_open: window.afternoon_open,
      afternoon_close: window.afternoon_close,
      afternoon_late_threshold: window.afternoon_late_threshold,
    };

    const current = timeToMinutes(nowHHMM());
    const morningOpen    = timeToMinutes(window.morning_open);
    const morningClose   = timeToMinutes(window.morning_close);
    const afternoonOpen  = timeToMinutes(window.afternoon_open);
    const afternoonClose = timeToMinutes(window.afternoon_close);

    // Morning window is open from morning_open until morning_close
    // (check-ins after morning_open + morning_late_threshold are marked 'late')
    if (current >= morningOpen && current < morningClose) {
      return {
        isOpen: true,
        session_label: 'morning',
        window_open: window.morning_open,
        window_close: window.morning_close,
        seconds_until_open: 0,
        seconds_until_close: secondsRemaining(window.morning_close),
        ...scheduleMeta,
      };
    }

    // Afternoon window is open from afternoon_open until afternoon_close
    // (check-ins after afternoon_open + afternoon_late_threshold are marked 'late')
    if (current >= afternoonOpen && current < afternoonClose) {
      return {
        isOpen: true,
        session_label: 'afternoon',
        window_open: window.afternoon_open,
        window_close: window.afternoon_close,
        seconds_until_open: 0,
        seconds_until_close: secondsRemaining(window.afternoon_close),
        ...scheduleMeta,
      };
    }

    // Before morning window
    if (current < morningOpen) {
      return {
        ...closed,
        session_label: 'morning',
        window_open: window.morning_open,
        window_close: window.morning_close,
        seconds_until_open: secondsUntil(window.morning_open),
        ...scheduleMeta,
      };
    }

    // Between windows (morning window closed, afternoon not yet open)
    if (current >= morningClose && current < afternoonOpen) {
      return {
        ...closed,
        session_label: 'afternoon',
        window_open: window.afternoon_open,
        window_close: window.afternoon_close,
        seconds_until_open: secondsUntil(window.afternoon_open),
        ...scheduleMeta,
      };
    }

    // Both windows have passed for today
    return {
      ...closed,
      ...scheduleMeta,
    };
  }

  /**
   * Trainee self-service attendance submission.
   *
   * - Determines lateness against the active schedule window.
   * - Upserts on (session_id, trainee_id): updates only the columns for
   *   the matching session_label so morning and afternoon data never overwrite
   *   each other.
   * - Increments attempt_number on re-submission.
   * - Updates top-level status: late > present > pending.
   */
  async submitTraineeAttendance(data: SubmitAttendanceData): Promise<Attendance> {
    const today = todayString();
    // Re-fetch window using the session's program_id

const { data: sessionRow, error: sessionErr } = await supabaseAdmin
      .from('program_sessions')
      .select('program_id, session_date')
      .eq('id', data.session_id)
      .single();
    if (sessionErr) throw sessionErr;

    const effectiveWindow = await this.getActiveSchedule(
      sessionRow.program_id,
      today,
      data.tenant_id
    );
    if (!effectiveWindow) {
      throw new Error('No active attendance schedule found for today');
    }

    // Determine lateness for this session_label

const current = timeToMinutes(nowHHMM());
    let isLate = false;
    let lateDurationMinutes = 0;

    if (data.session_label === 'morning') {
      const openMins = timeToMinutes(effectiveWindow.morning_open);
      const lateCutoff = openMins + effectiveWindow.morning_late_threshold;
      if (current > lateCutoff) {
        isLate = true;
        lateDurationMinutes = current - lateCutoff;
      }
    } else {
      const openMins = timeToMinutes(effectiveWindow.afternoon_open);
      const lateCutoff = openMins + effectiveWindow.afternoon_late_threshold;
      if (current > lateCutoff) {
        isLate = true;
        lateDurationMinutes = current - lateCutoff;
      }
    }

const computedSessionStatus: 'present' | 'late' = isLate ? 'late' : 'present';
    const nowIso = new Date().toISOString();

    // Fetch existing record to handle upsert correctly
    let existing: Record<string, any> | null = null;
    {
      const { data: existingWithCv, error: existingErr } = await supabaseAdmin
        .from('attendance')
        .select('id, attempt_number, morning_status, afternoon_status, late_duration_minutes, gps_lat, gps_lng, gps_accuracy, gps_address, device_info, cv_verification')
        .eq('session_id', data.session_id)
        .eq('trainee_id', data.trainee_id)
        .maybeSingle();

      if (existingErr && /cv_verification/i.test(existingErr.message || '')) {
        const { data: existingLegacy } = await supabaseAdmin
          .from('attendance')
          .select('id, attempt_number, morning_status, afternoon_status, late_duration_minutes, gps_lat, gps_lng, gps_accuracy, gps_address, device_info')
          .eq('session_id', data.session_id)
          .eq('trainee_id', data.trainee_id)
          .maybeSingle();
        existing = existingLegacy;
      } else {
        existing = existingWithCv;
      }
    }

    const currentAttempt = (existing?.attempt_number ?? 0) + 1;
    const hasIncomingGps = data.gps_lat != null && data.gps_lng != null;

    // Merge optional advisory Computer Vision verification without overwriting the opposite session
    const existingCv =
      (existing?.cv_verification as AttendanceCvVerification | null | undefined) ??
      ((existing?.device_info as Record<string, unknown> | null | undefined)?._cv_advisory as
        | AttendanceCvVerification
        | null
        | undefined);
    const mergedCv = data.cv_verification
      ? mergeAttendanceCvVerification(existingCv, data.session_label, data.cv_verification)
      : existingCv ?? null;

    // Build update payload — only touch this session_label's columns
    // Preserve prior session GPS when a subsequent upsert omits coordinates
    const updatePayload: Record<string, unknown> = {
      session_id:        data.session_id,
      trainee_id:        data.trainee_id,
      submission_method: 'self_service',
      attempt_number:    currentAttempt,
      gps_lat:           hasIncomingGps ? data.gps_lat : (existing?.gps_lat ?? null),
      gps_lng:           hasIncomingGps ? data.gps_lng : (existing?.gps_lng ?? null),
      gps_accuracy:      hasIncomingGps ? (data.gps_accuracy ?? null) : (existing?.gps_accuracy ?? null),
      gps_address:       hasIncomingGps ? (data.gps_address ?? null) : (existing?.gps_address ?? null),
      device_info:       data.device_info  ?? null,
      ...(mergedCv ? { cv_verification: mergedCv } : {}),
      ...(data.tenant_id ? { tenant_id: data.tenant_id } : {}),
    };

    if (data.session_label === 'morning') {
      updatePayload.selfie_morning_path  = data.selfie_path;
      updatePayload.morning_time_in      = nowIso;
      updatePayload.morning_status       = computedSessionStatus;
      updatePayload.check_in_time        = nowIso;
    } else {
      updatePayload.selfie_afternoon_path = data.selfie_path;
      updatePayload.afternoon_time_out    = nowIso;
      updatePayload.afternoon_status      = computedSessionStatus;
      updatePayload.check_out_time        = nowIso;
    }

    // Accumulate late duration across independent sessions without double-counting re-submissions
    const prevLate = existing?.late_duration_minutes ?? 0;
    const isResubmitSameSession =
      (data.session_label === 'morning' && Boolean(existing?.morning_status && existing.morning_status !== 'pending')) ||
      (data.session_label === 'afternoon' && Boolean(existing?.afternoon_status && existing.afternoon_status !== 'pending'));
    const otherSessionWasLate =
      (data.session_label === 'morning' && existing?.afternoon_status === 'late') ||
      (data.session_label === 'afternoon' && existing?.morning_status === 'late');

    if (isResubmitSameSession && !otherSessionWasLate) {
      updatePayload.late_duration_minutes = lateDurationMinutes;
    } else if (!isResubmitSameSession) {
      updatePayload.late_duration_minutes = prevLate + lateDurationMinutes;
    } else {
      updatePayload.late_duration_minutes = Math.max(prevLate, lateDurationMinutes);
    }

    // Independent half-day session handling: if afternoon is submitted after morning closed
    // with no morning punch, mark morning_status as 'absent' while recording afternoon cleanly
    const morningMissed =
      data.session_label === 'afternoon' &&
      (!existing?.morning_status || existing.morning_status === 'pending') &&
      current >= timeToMinutes(effectiveWindow.morning_close);

    if (morningMissed) {
      updatePayload.morning_status = 'absent';
    }

    // Derive top-level status from both sessions
    const newMorningStatus = data.session_label === 'morning'
      ? computedSessionStatus
      : (existing?.morning_status ?? (morningMissed ? 'absent' : 'pending'));
    const newAfternoonStatus = data.session_label === 'afternoon'
      ? computedSessionStatus
      : (existing?.afternoon_status ?? 'pending');

    if (newMorningStatus === 'late' || newAfternoonStatus === 'late') {
      updatePayload.status = 'late';
    } else if (newMorningStatus === 'present' || newAfternoonStatus === 'present') {
      updatePayload.status = 'present';
    } else {
      updatePayload.status = 'pending';
    }

    let { data: result, error } = await supabaseAdmin
      .from('attendance')
      .upsert(updatePayload, { onConflict: 'session_id,trainee_id', ignoreDuplicates: false })
      .select('*')
      .single();

    // Graceful fallback if migration 018 (cv_verification column) has not yet been applied
    if (error && mergedCv && /cv_verification/i.test(error.message || '')) {
      const { cv_verification: _omit, ...fallbackPayload } = updatePayload;
      fallbackPayload.device_info = {
        ...((data.device_info as Record<string, unknown>) ?? {}),
        _cv_advisory: mergedCv,
      };
      const retry = await supabaseAdmin
        .from('attendance')
        .upsert(fallbackPayload, { onConflict: 'session_id,trainee_id', ignoreDuplicates: false })
        .select('*')
        .single();
      result = retry.data;
      error = retry.error;
    }

    if (error) throw error;
    return result as Attendance;
  }

  /**
   * Build a CalendarDayData[] for every calendar day in a given month.
   *
   * Classification priority (per day):
   *   1. future          — date > today
   *   2. weekend         — Saturday or Sunday
   *   3. holiday         — exists in attendance_exceptions for this program
   *   4. present/late/absent/excused/pending — from the attendance record
   *   5. no_session      — no program_session exists for this date
   */
  async getMonthlyCalendar(
    traineeId: string,
    year: number,
    month: number,           // 1-based (January = 1)
    tenantId?: string
  ): Promise<CalendarDayData[]> {
    const monthStr   = String(month).padStart(2, '0');
    const startDate  = `${year}-${monthStr}-01`;
    const endDate    = lastDayOfMonth(year, month);
    const today      = todayString();

    // Fetch trainee's program_id from active enrollment
    let programId: string | null = null;
    
    let enrollQuery = supabaseAdmin
      .from('enrollments')
      .select('program_id')
      .eq('trainee_id', traineeId)
      .in('status', ['enrolled', 'active'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (tenantId) enrollQuery = enrollQuery.eq('tenant_id', tenantId);
    const { data: enrollRows, error: enrollErr } = await enrollQuery;
    if (enrollErr) throw enrollErr;
    if (enrollRows && enrollRows.length > 0) {
      programId = enrollRows[0].program_id;
    }

    // If no active enrollment, return empty calendar
    if (!programId) {
      const result: CalendarDayData[] = [];
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const dayStr = `${year}-${monthStr}-${String(day).padStart(2, '0')}`;
        result.push({ date: dayStr, status: 'no_session' });
      }
      return result;
    }

    // Fetch all attendance records for this trainee in the month

let attQuery = supabaseAdmin
      .from('attendance')
      .select(`
        *,
        session:program_sessions!inner(session_date, program_id)
      `)
      .eq('trainee_id', traineeId)
      .gte('session.session_date', startDate)
      .lte('session.session_date', endDate);
    if (tenantId) attQuery = attQuery.eq('tenant_id', tenantId);
    const { data: attRecords, error: attErr } = await attQuery;
    if (attErr) throw attErr;

    // Index attendance by session_date (prefer the most recently updated row if multiple exist)
    const attByDate = new Map<string, any>();
    for (const rec of attRecords || []) {
      const sd = (rec.session as any)?.session_date;
      if (!sd) continue;
      const prev = attByDate.get(sd);
      if (!prev || String(rec.updated_at || '') >= String(prev.updated_at || '')) {
        attByDate.set(sd, rec);
      }
    }

    // Fetch sessions that exist for this program in the month

    const sessionDates = new Set<string>();
    if (programId) {
      const { data: sessions, error: sessErr } = await supabaseAdmin
        .from('program_sessions')
        .select('session_date, id, program_id')
        .eq('program_id', programId)
        .gte('session_date', startDate)
        .lte('session_date', endDate);
      
      if (sessErr) {
        throw sessErr;
      } else {
        for (const s of sessions || []) sessionDates.add(s.session_date);
      }
    }

    // Fetch non-attendance dates (holidays/exclusions) from attendance_exceptions table (3NF normalized)
    let exceptionsQuery = supabaseAdmin
      .from('attendance_exceptions')
      .select('exception_date')
      .in('exception_type', ['no_attendance_day', 'holiday'])
      .gte('exception_date', startDate)
      .lte('exception_date', endDate);
    
    if (programId) exceptionsQuery = exceptionsQuery.eq('program_id', programId);
    
    const { data: exceptions, error: exceptionsError } = await exceptionsQuery;
    if (exceptionsError) throw exceptionsError;
    
    const holidaySet = new Set((exceptions || []).map((e) => e.exception_date));

    // Build calendar

const result: CalendarDayData[] = [];
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = `${year}-${monthStr}-${String(day).padStart(2, '0')}`;

      if (dayStr > today) {
        result.push({ date: dayStr, status: 'future' });
        continue;
      }

      // Always surface real attendance records even on weekend/holiday makeup sessions
      const record = attByDate.get(dayStr);
      if (record) {
        const s = record.status as CalendarDayStatus;
        result.push({ date: dayStr, status: s, record });
        continue;
      }

      if (holidaySet.has(dayStr)) {
        result.push({ date: dayStr, status: 'holiday' });
        continue;
      }

      if (sessionDates.has(dayStr)) {
        // Explicit session scheduled (including weekend classes) with no record yet
        result.push({ date: dayStr, status: 'pending' });
        continue;
      }

      if (isWeekend(dayStr)) {
        result.push({ date: dayStr, status: 'weekend' });
        continue;
      }

      result.push({ date: dayStr, status: 'no_session' });
    }

    return result;
  }

  /**
   * Get all attendance records for a program on a specific date.
   * Used by the admin day-view panel.
   *
   * Returns:
   *   - records[]     — trainees who have a record on this date (with selfie paths)
   *   - noRecord[]    — enrolled trainees who have no record (for "No record" cards)
   */
  async getDayAttendanceForAdmin(
    programId: string,
    date: string,
    tenantId?: string
  ): Promise<{
    session_id: string | null;
    records: any[];
    noRecord: any[];
  }> {
    // Find the session for this program on this date

let sessionQuery = supabaseAdmin
      .from('program_sessions')
      .select('id')
      .eq('program_id', programId)
      .eq('session_date', date);
    if (tenantId) sessionQuery = sessionQuery.eq('tenant_id', tenantId);
    const { data: sessions, error: sessionErr } = await sessionQuery;
    if (sessionErr) throw sessionErr;

    const sessionIds = (sessions || []).map((s: any) => s.id);

    // Fetch attendance records joined with trainee details

let attQuery = supabaseAdmin
      .from('attendance')
      .select(`
        *,
        trainee:trainees(
          id, first_name, last_name, middle_name, email, photo_path, thumbnail_path
        )
      `)
      .in('session_id', sessionIds.length > 0 ? sessionIds : ['00000000-0000-0000-0000-000000000000']);

    if (tenantId) attQuery = attQuery.eq('tenant_id', tenantId);
    const { data: records, error: attErr } = await attQuery;
    if (attErr) throw attErr;

    const recordedTraineeIds = new Set((records || []).map((r: any) => r.trainee_id));

    // Fetch enrolled active trainees for the program using enrollments table (3NF normalized)
    let enrollmentQuery = supabaseAdmin
      .from('enrollments')
      .select('trainee:trainees(id, first_name, last_name, middle_name, email, photo_path, thumbnail_path)')
      .eq('program_id', programId)
      .in('status', ['enrolled', 'active']);
    if (tenantId) enrollmentQuery = enrollmentQuery.eq('tenant_id', tenantId);
    const { data: allEnrollments, error: enrollmentErr } = await enrollmentQuery;
    if (enrollmentErr) throw enrollmentErr;

    const noRecord = (allEnrollments || [])
      .map((e: any) => e.trainee)
      .filter((t: any) => t && !recordedTraineeIds.has(t.id));

    return { session_id: sessionIds[0] ?? null, records: records || [], noRecord };
  }

  /**
   * Get admin dashboard summary data for a program.
   * Returns summary card counts + daily trend (last 30 days) + status distribution.
   */
  async getAdminDashboard(
    programId: string,
    filters: { startDate?: string; endDate?: string; status?: string } = {},
    tenantId?: string
  ) {
    const today = todayString();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const year = thirtyDaysAgo.getFullYear();
    const month = String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0');
    const date = String(thirtyDaysAgo.getDate()).padStart(2, '0');
    const thirtyDaysAgoStr = `${year}-${month}-${date}`;

    // Today's summary

const todaySessions = await supabaseAdmin
      .from('program_sessions')
      .select('id')
      .eq('program_id', programId)
      .eq('session_date', today);

    const todaySessionIds = (todaySessions.data || []).map((s: any) => s.id);

    let todayAttQuery = supabaseAdmin
      .from('attendance')
      .select('status, morning_status, afternoon_status')
      .in('session_id', todaySessionIds.length > 0 ? todaySessionIds : ['00000000-0000-0000-0000-000000000000']);
    if (tenantId) todayAttQuery = todayAttQuery.eq('tenant_id', tenantId);
    const { data: todayAtt } = await todayAttQuery;

    const presentToday = (todayAtt || []).filter((a: any) => a.status === 'present').length;
    const lateToday    = (todayAtt || []).filter((a: any) => a.status === 'late').length;
    const absentToday  = (todayAtt || []).filter((a: any) => a.status === 'absent').length;
    const pendingCount = (todayAtt || []).filter(
      (a: any) => a.morning_status === 'pending' || a.afternoon_status === 'pending'
    ).length;
    const excusedToday = (todayAtt || []).filter((a: any) => a.status === 'excused').length;

    // Overall attendance rate

const overallStats = await this.getAttendanceStats(programId, tenantId);
    const attendanceRate = overallStats.total > 0
      ? Math.round(((overallStats.present + overallStats.late) / overallStats.total) * 100)
      : 0;

    // Daily trend — last 30 days
    const trendData = await fetchAllRows<any>(() => {
      let trendQuery = supabaseAdmin
        .from('attendance')
        .select(`
          status,
          session:program_sessions!inner(session_date, program_id)
        `)
        .eq('session.program_id', programId)
        .gte('session.session_date', thirtyDaysAgoStr)
        .lte('session.session_date', today);
      if (tenantId) trendQuery = trendQuery.eq('tenant_id', tenantId);
      return trendQuery;
    });

    const trendByDate = new Map<string, { present: number; late: number; absent: number }>();
    for (const rec of trendData || []) {
      const d = (rec.session as any).session_date;
      if (!trendByDate.has(d)) trendByDate.set(d, { present: 0, late: 0, absent: 0 });
      const entry = trendByDate.get(d)!;
      if (rec.status === 'present') entry.present++;
      else if (rec.status === 'late') entry.late++;
      else if (rec.status === 'absent') entry.absent++;
    }

const dailyTrend = Array.from(trendByDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    return {
      summaryCards: {
        presentToday,
        lateToday,
        absentToday,
        pendingCount,
        excusedToday,
        attendanceRate,
      },
      dailyTrend,
      distribution: {
        present: overallStats.present,
        late:    overallStats.late,
        absent:  overallStats.absent,
        excused: overallStats.excused,
        pending: overallStats.pending,
      },
    };
  }
}

export const attendanceService = new AttendanceService();

