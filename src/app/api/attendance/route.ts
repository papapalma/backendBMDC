/**
 * GET  /api/attendance  — list attendance records (tenant-scoped, Req 7.5, 17.2)
 * POST /api/attendance  — record attendance / QR scan (tenant-scoped, Req 7.5, 17.2, 17.3, 17.4)
 *
 * Requirements: 7.5, 17.2, 17.3, 17.4, 23.4
 *
 * QR code scanning validates tenant context: codes from other tenants are
 * rejected with an error message (Req 17.3).
 * QR code attendance requires the qr_code_attendance feature flag (Req 23.4).
 */
import { NextRequest, NextResponse } from 'next/server';
import { attendanceService } from '@/services/attendanceService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, errorResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';
import { requireFeature, FeatureKey } from '@/lib/featureFlags';
import { z } from 'zod';

// Validation schemas
const markAttendanceSchema = z.object({
  session_id: z.string().uuid('Invalid session ID'),
  trainee_id: z.string().uuid('Invalid trainee ID'),
  status: z.enum(['present', 'absent', 'late', 'excused']),
  notes: z.string().optional(),
});

const scanAttendanceSchema = z.object({
  session_id: z.string().uuid('Invalid session ID'),
  qr_code: z.string().min(1, 'QR code is required'),
});

const bulkMarkAbsentSchema = z.object({
  session_id: z.string().uuid('Invalid session ID'),
});

// OPTIONS /api/attendance
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/attendance - Get attendance records (tenant-scoped, Req 7.5, 17.2)
export const GET = withErrorHandler(async (request: NextRequest) => {
  // Tenant context required — attendance records are tenant-scoped (Req 7.5)

const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role, isSuperAdmin } = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator', 'staff_inventory_manager'];
  if (!allowedRoles.includes(role)) {
    return forbiddenResponse('Insufficient permissions to view attendance records');
  }

const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');
  const traineeId = searchParams.get('trainee_id');
  const programId = searchParams.get('program_id');
  const stats = searchParams.get('stats');
  const dashboard = searchParams.get('dashboard');
  const dateFilter = searchParams.get('date');

  // Admin dashboard summary (attendance module)

if (dashboard === 'true' && programId) {
    const startDate = searchParams.get('start_date') ?? undefined;
    const endDate = searchParams.get('end_date') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const dashboardData = await attendanceService.getAdminDashboard(
      programId,
      { startDate, endDate, status },
      isSuperAdmin ? undefined : tenantId
    );
    return successResponse(dashboardData);
  }

  // Day-view for admin (attendance module) -- all records for a program on a date

if (dateFilter && programId) {
    const dayData = await attendanceService.getDayAttendanceForAdmin(
      programId,
      dateFilter,
      isSuperAdmin ? undefined : tenantId
    );
    return successResponse(dayData);
  }

  // Get stats for a program (tenant-scoped)

if (stats === 'true' && programId) {
    const attendanceStats = await attendanceService.getAttendanceStats(
      programId,
      isSuperAdmin ? undefined : tenantId
    );
    return successResponse(attendanceStats);
  }

  // Get stats for a trainee (tenant-scoped)

if (stats === 'true' && traineeId) {
    const traineeStats = await attendanceService.getTraineeAttendanceStats(
      traineeId,
      programId || undefined,
      isSuperAdmin ? undefined : tenantId
    );
    return successResponse(traineeStats);
  }

  // Get attendance by session (tenant-scoped)

if (sessionId) {
    const attendance = await attendanceService.getAttendanceBySession(
      sessionId,
      isSuperAdmin ? undefined : tenantId
    );
    return successResponse(attendance);
  }

  // Get attendance by trainee (tenant-scoped)

if (traineeId) {
    const attendance = await attendanceService.getAttendanceByTrainee(
      traineeId,
      isSuperAdmin ? undefined : tenantId
    );
    return successResponse(attendance);
  }

  return errorResponse('Please provide session_id or trainee_id parameter');
});

// POST /api/attendance - Record attendance (tenant-scoped, Req 7.5, 17.2, 17.3, 17.4)
export const POST = withErrorHandler(async (request: NextRequest) => {
  // Tenant context required — attendance recording is tenant-scoped (Req 7.5)

const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role } = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator'];
  if (!allowedRoles.includes(role)) {
    return forbiddenResponse('Insufficient permissions to record attendance');
  }

const body = await request.json();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  // Scan QR code to mark attendance — validates tenant context (Req 17.2, 17.3, 17.4)

if (action === 'scan') {
    // Feature gate: qr_code_attendance must be enabled for this tenant (Req 23.4)

const featureCheck = await requireFeature(tenantId, FeatureKey.QR_CODE_ATTENDANCE);
    if (featureCheck) return featureCheck as any;

    const validatedData = scanAttendanceSchema.parse(body);
    try {
      const attendance = await attendanceService.markAttendanceByQR(
        validatedData.session_id,
        validatedData.qr_code,
        userId,
        tenantId
      );
      await activityLogService.logAction(
        userId,
        'scan_attendance',
        'attendance',
        attendance.id,
        { session_id: validatedData.session_id, qr_code: validatedData.qr_code, tenantId }
      );
      return successResponse(attendance, 'Attendance marked successfully');
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to mark attendance', 400);
    }
  }

  // Bulk mark absent for a session (tenant-scoped)

if (action === 'bulk_absent') {
    const validatedData = bulkMarkAbsentSchema.parse(body);
    const result = await attendanceService.bulkMarkAbsent(validatedData.session_id, tenantId);
    await activityLogService.logAction(
      userId,
      'bulk_mark_absent',
      'attendance',
      validatedData.session_id,
      { session_id: validatedData.session_id, count: result.markedAbsent, tenantId }
    );
    return successResponse(result, `Marked ${result.markedAbsent} trainees as absent`);
  }

  // Manual attendance marking (tenant-scoped, Req 7.5)

const validatedData = markAttendanceSchema.parse(body);
  const attendance = await attendanceService.markAttendance({
    ...validatedData,
    scanned_by: userId,
    tenant_id: tenantId,
  });
  await activityLogService.logAction(
    userId,
    'mark_attendance',
    'attendance',
    attendance.id,
    { ...validatedData, tenantId }
  );
  return successResponse(attendance, 'Attendance marked successfully');
});
