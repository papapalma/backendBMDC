import { NextRequest, NextResponse } from 'next/server';
import { requireRoleAsync } from '@/middleware/auth';
import { successResponse, notFoundResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';

// OPTIONS /api/trainees/me/dashboard - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * GET /api/trainees/me/dashboard
 * Get all dashboard data for the current trainee in a single optimized call
 * Returns: profile, attendance stats, recent attendance, upcoming sessions
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['trainee']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const userId = authResult.user.userId;
  
  try {
  // Get trainee_id from trainee_accounts table, with fallback to trainees.user_id

let traineeId: string | null = null;
let tenantId: string | null = null;

const { data: account, error: accErr } = await supabaseAdmin
  .from('trainee_accounts')
  .select('trainee_id, tenant_id')
  .eq('user_id', userId)
  .maybeSingle();

if (account) {
  traineeId = account.trainee_id;
  tenantId = account.tenant_id;
} else {
  // Fallback: trainee_accounts doesn't exist, query trainees by user_id
  const { data: traineeByUser, error: traineeUserErr } = await supabaseAdmin
    .from('trainees')
    .select('id, tenant_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (traineeByUser) {
    traineeId = traineeByUser.id;
    tenantId = traineeByUser.tenant_id;
  }
}

if (!traineeId || !tenantId) {
  return notFoundResponse('Trainee profile not found for this user');
}

  // Get trainee profile 
const { data: traineeData, error: traineeError } = await supabaseAdmin
  .from('trainees')
  .select('*')
  .eq('id', traineeId)
  .single();

  if (traineeError) {
  console.error('[Dashboard] Error fetching trainee:', traineeError);
  return notFoundResponse('Failed to fetch trainee profile');
  }

if (!traineeData) {
  return notFoundResponse('Trainee data not found');
  }

  // Execute all queries in parallel
  // First, get the trainee's current enrollment
  const { data: enrollments, error: enrollmentError } = await supabaseAdmin
    .from('enrollments')
    .select('id, program_id, status')
    .eq('trainee_id', traineeId)
    .eq('status', 'enrolled')
    .order('created_at', { ascending: false })
    .limit(1);

  const currentEnrollment = enrollments && enrollments.length > 0 ? enrollments[0] : null;
  const programId = currentEnrollment?.program_id;

const [programResult, attendanceResult, sessionsResult, excludedDatesResult] = await Promise.all([
  // Get program details if enrolled
  programId
  ? supabaseAdmin.from('programs').select('*').eq('id', programId).single()
  : Promise.resolve({ data: null, error: null }),

  // Get all attendance records with session dates for stats calculation
  supabaseAdmin
  .from('attendance')
  .select('id, status, check_in_time, check_out_time, program_sessions(id, session_date, start_time, end_time, programs(name))')
  .eq('trainee_id', traineeId)
  .order('check_in_time', { ascending: false }),

  // Get upcoming sessions if enrolled
  programId
  ? supabaseAdmin
  .from('program_sessions')
  .select('id, program_id, title, session_date, start_time, end_time, description, location, session_type')
  .eq('program_id', programId)
  .gte('session_date', new Date().toISOString().split('T')[0])
  .order('session_date', { ascending: true })
  .order('start_time', { ascending: true })
  .limit(10)
  : Promise.resolve({ data: [], error: null }),

  // Get excluded dates for this program from attendance_exceptions
  programId
  ? supabaseAdmin
  .from('attendance_exceptions')
  .select('id, exception_date')
  .eq('program_id', programId)
  .eq('exception_type', 'non_attendance_date')
  .gte('exception_date', new Date().toISOString().split('T')[0])
  .order('exception_date', { ascending: true })
  .limit(10)
  : Promise.resolve({ data: [], error: null }),
  ]);

  // Get excluded dates set
const excludedDates = excludedDatesResult.data || [];
  const excludedDateSet = new Set(excludedDates.map((d: any) => d.exception_date));

  // Filter attendance records to exclude non-attendance dates

const attendanceRecords = attendanceResult.data || [];
  const validAttendanceRecords = attendanceRecords.filter((record: any) => {
  const sessionDate = record.program_sessions?.session_date;
  return sessionDate && !excludedDateSet.has(sessionDate);
  });

  // Calculate attendance stats (excluding non-attendance dates)

const totalSessions = validAttendanceRecords.length;
  const presentCount = validAttendanceRecords.filter((a: any) => a.status === 'present').length;
  const lateCount = validAttendanceRecords.filter((a: any) => a.status === 'late').length;
  const absentCount = validAttendanceRecords.filter((a: any) => a.status === 'absent').length;
  const attendanceRate = totalSessions > 0 ? ((presentCount + lateCount) / totalSessions) * 100 : 0;

  const attendanceStats = {
  total_sessions: totalSessions,
  present_count: presentCount,
  late_count: lateCount,
  absent_count: absentCount,
  attendance_rate: Math.round(attendanceRate * 10) / 10,
  };

  // Get recent attendance (top 5 from valid records)

const recentAttendance = validAttendanceRecords.slice(0, 5);

  // Filter upcoming sessions to mark excluded dates

const upcomingSessions = (sessionsResult.data || []).map((session: any) => ({
  ...session,
  is_excluded_date: excludedDateSet.has(session.session_date),
  }));

  // Get next 5 excluded dates

const upcomingExcludedDates = excludedDates.slice(0, 5);

  // Build profile with program

const profile = {
  ...traineeData,
  program: programResult.data || undefined,
  };

  // Return all data in one response

return successResponse({
  profile,
  attendanceStats,
  recentAttendance,
  upcomingSessions,
  excludedDates: upcomingExcludedDates,
  });
  } catch (error: any) {
  console.error('[Dashboard] Unexpected error:', error);
  throw error; // Let withErrorHandler catch it
  }
});
