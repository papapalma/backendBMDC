/**
 * Trainee self-service attendance submission route.
 *
 * GET  /api/attendance/submit?window=true  — current window status
 * GET  /api/attendance/submit?month=YYYY-MM  — monthly calendar data
 * POST /api/attendance/submit (multipart/form-data) — submit attendance + selfie
 *
 * Role: trainee only
 *
 * POST fields:
 *   selfie  (File, required)   — JPEG/PNG selfie image
 *   session_label   (string, required) — "morning" | "afternoon"
 *   gps_lat  (string, optional) — decimal latitude
 *   gps_lng  (string, optional) — decimal longitude
 *   gps_accuracy  (string, optional) — accuracy in metres
 *   gps_address  (string, optional) — reverse-geocoded address
 *   device_info  (string, optional) — JSON-serialised DeviceInfo object
 *
 * Selfie storage path:
 *   /uploads/{tenant_id}/images/attendance/{traineeId}_{sessionId}_{am|pm}_{unixTs}.jpg
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireRoleAsync } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { activityLogService } from '@/services/activityLogService';
import { attendanceService } from '@/services/attendanceService';
import {
  UPLOAD_BASE_DIR,
  validateTenantId,
  getImageDir,
  initTenantDirectories,
} from '@/lib/fileStorage';
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  createdResponse,
} from '@/utils/responses';

// ---------------------------------------------------------------------------
// Validation schema for non-file fields
// ---------------------------------------------------------------------------

const submitFieldsSchema = z.object({
  session_label: z.enum(['morning', 'afternoon']),
  gps_lat:  z.string().optional().nullable(),
  gps_lng:  z.string().optional().nullable(),
  gps_accuracy:  z.string().optional().nullable(),
  gps_address:   z.string().optional().nullable(),
  device_info:   z.string().optional().nullable(),  // JSON string
});

// Allowed MIME types for selfie
const ALLOWED_SELFIE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

// Max selfie size: 10 MB (sharp will resize down anyway)
const MAX_SELFIE_BYTES = 10 * 1024 * 1024;

// Output dimensions for stored selfie
const SELFIE_MAX_DIM = 800;
const SELFIE_QUALITY = 85;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve trainee_id + program_id from the authenticated user_id */
async function resolveTrainee(userId: string) {
  // Try trainee_accounts first (normalized schema)
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
  } else if (!accErr) {
    // trainee_accounts record doesn't exist, try direct trainee.user_id lookup
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

  if (!traineeId || !tenantId) return null;

  // Get trainee's current enrollment to find program_id
  const { data: enrollment, error: enrollErr } = await supabaseAdmin
    .from('enrollments')
    .select('program_id')
    .eq('trainee_id', traineeId)
    .eq('status', 'enrolled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (enrollErr) return null;

  // Get trainee profile for name fields
  const { data: trainee, error: traineeErr } = await supabaseAdmin
    .from('trainees')
    .select('id, first_name, last_name')
    .eq('id', traineeId)
    .single();

  if (traineeErr || !trainee) return null;

  return {
    id: trainee.id,
    tenant_id: tenantId,
    first_name: trainee.first_name,
    last_name: trainee.last_name,
    program_id: enrollment?.program_id || null,
  };
}

/** Find today's program_session for the trainee's program */
async function findTodaySession(programId: string, tenantId: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${date}`;

  const { data, error } = await supabaseAdmin
  .from('program_sessions')
  .select('id, session_date, start_time, end_time')
  .eq('program_id', programId)
  .eq('session_date', today)
  .eq('tenant_id', tenantId)
  .limit(1)
  .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Store and process the selfie image.
 * Returns the relative path stored in the database.
 */
async function storeSelfie(
  imageBuffer: Buffer,
  tenantId: string,
  traineeId: string,
  sessionId: string,
  sessionLabel: 'morning' | 'afternoon'
): Promise<string> {
  validateTenantId(tenantId);

  // Ensure the attendance image directory exists

const dir = getImageDir(tenantId, 'attendance');
  await fs.mkdir(dir, { recursive: true });

  const labelSuffix = sessionLabel === 'morning' ? 'am' : 'pm';
  const timestamp   = Math.floor(Date.now() / 1000);
  const filename  = `${traineeId}_${sessionId}_${labelSuffix}_${timestamp}.jpg`;
  const absPath  = path.join(dir, filename);

  // Resize + convert to JPEG with sharp

await sharp(imageBuffer)
  .rotate()  // auto-orient from EXIF
  .resize(SELFIE_MAX_DIM, SELFIE_MAX_DIM, {
  fit:  'inside',
  withoutEnlargement: true,
  })
  .jpeg({ quality: SELFIE_QUALITY, mozjpeg: false })
  .toFile(absPath);

  return `/uploads/${tenantId}/images/attendance/${filename}`;
}

// ---------------------------------------------------------------------------
// OPTIONS
// ---------------------------------------------------------------------------

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// ---------------------------------------------------------------------------
// GET — window status or monthly calendar
// ---------------------------------------------------------------------------

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['trainee']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const trainee = await resolveTrainee(authResult.user.userId);
  if (!trainee) return notFoundResponse('Trainee profile not found');

  const { searchParams } = new URL(request.url);

  // ?window=true — current window status
  if (searchParams.get('window') === 'true') {
    if (!trainee.program_id) {
      return successResponse({
        isOpen: false,
        session_label: null,
        window_open: null,
        window_close: null,
        seconds_until_open: null,
        seconds_until_close: null,
      });
    }

    const status = await attendanceService.getCurrentWindowStatus(
      trainee.program_id,
      trainee.tenant_id
    );
    return successResponse(status);
  }

  // ?month=YYYY-MM — monthly calendar
  const month = searchParams.get('month');
  if (month) {
    const match = month.match(/^(\d{4})-(\d{2})$/);
    if (!match) return errorResponse('Invalid month format. Use YYYY-MM');

    const year = parseInt(match[1], 10);
    const mon = parseInt(match[2], 10);

    const calendar = await attendanceService.getMonthlyCalendar(
      trainee.id,
      year,
      mon,
      trainee.tenant_id
    );
    return successResponse(calendar);
  }

  return errorResponse('Provide ?window=true or ?month=YYYY-MM');
});

// ---------------------------------------------------------------------------
// POST — submit attendance with selfie
// ---------------------------------------------------------------------------

export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['trainee']);
  if ('error' in authResult) return authResult.error as NextResponse;

  // Parse multipart/form-data

let formData: FormData;
  try {
  formData = await request.formData();
  } catch {
  return errorResponse('Request must be multipart/form-data');
  }

  // Extract and validate non-file fields

const rawFields = {
  session_label: formData.get('session_label'),
  gps_lat:  formData.get('gps_lat'),
  gps_lng:  formData.get('gps_lng'),
  gps_accuracy:  formData.get('gps_accuracy'),
  gps_address:   formData.get('gps_address'),
  device_info:   formData.get('device_info'),
  };

  const fields = submitFieldsSchema.parse(
  Object.fromEntries(
  Object.entries(rawFields).map(([k, v]) => [k, v ? String(v) : null])
  )
  );

  // Extract selfie file

const selfieFile = formData.get('selfie');
  if (!selfieFile || typeof selfieFile === 'string') {
  return errorResponse('selfie file is required');
  }

const file = selfieFile as File;

  if (!ALLOWED_SELFIE_TYPES.has(file.type)) {
  return errorResponse('Selfie must be a JPEG, PNG, or WebP image');
  }

const imageBuffer = Buffer.from(await file.arrayBuffer());
  if (imageBuffer.byteLength > MAX_SELFIE_BYTES) {
  return errorResponse('Selfie image is too large (max 10 MB)');
  }

  // Resolve trainee

const trainee = await resolveTrainee(authResult.user.userId);
  if (!trainee) return notFoundResponse('Trainee profile not found');
  if (!trainee.program_id) {
  return errorResponse('You are not enrolled in any program', 400);
  }

const tenantId = trainee.tenant_id as string;

  // Find today's session for this program

const session = await findTodaySession(trainee.program_id, tenantId);
  if (!session) {
  return errorResponse('No session is scheduled for your program today', 400);
  }

  // Check active schedule window

const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${date}`;

  const schedule = await attendanceService.getActiveSchedule(
    trainee.program_id,
    today,
    tenantId
  );
  if (!schedule) {
  return errorResponse('No active attendance schedule found for today', 400);
  }

  // Check time window

const windowStatus = await attendanceService.getCurrentWindowStatus(
  trainee.program_id,
  tenantId
  );
  if (!windowStatus.isOpen) {
  return errorResponse('Attendance window is currently closed', 400);
  }

if (windowStatus.session_label !== fields.session_label) {
  return errorResponse(
  `The ${fields.session_label} window is not currently open. ` +
  `The active window is: ${windowStatus.session_label ?? 'none'}`,
  400
  );
  }

  // Check non-attendance dates (holidays/exclusions)

  const nowLocal = new Date();
  const yearLocal = nowLocal.getFullYear();
  const monthLocal = String(nowLocal.getMonth() + 1).padStart(2, '0');
  const dateLocal = String(nowLocal.getDate()).padStart(2, '0');
  const todayLocal = `${yearLocal}-${monthLocal}-${dateLocal}`;
  
  // Check if today is an excluded date (non_attendance_date exception)
  if (trainee.program_id) {
    const { data: exceptions, error: excErr } = await supabaseAdmin
      .from('attendance_exceptions')
      .select('id')
      .eq('program_id', trainee.program_id)
      .eq('exception_date', todayLocal)
      .eq('exception_type', 'non_attendance_date')
      .limit(1);
    
    if (exceptions && exceptions.length > 0) {
      return errorResponse('Today is a non-attendance day', 400);
    }
  }

  // Ensure tenant directories exist (lazy init)

await initTenantDirectories(tenantId);

  // Store selfie and get relative path

const selfiePath = await storeSelfie(
  imageBuffer,
  tenantId,
  trainee.id,
  session.id,
  fields.session_label
  );

  // Parse optional fields

const gpsLat  = fields.gps_lat  ? parseFloat(fields.gps_lat)  : undefined;
  const gpsLng  = fields.gps_lng  ? parseFloat(fields.gps_lng)  : undefined;
  const gpsAcc  = fields.gps_accuracy ? parseFloat(fields.gps_accuracy) : undefined;
  const gpsAddress = fields.gps_address  ?? undefined;

  // Extract IP from headers

const ip =
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
  request.headers.get('x-real-ip') ??
  'unknown';

  // Parse device_info JSON and append server-extracted IP

let deviceInfo: Record<string, unknown> = {};
  if (fields.device_info) {
  try {
  deviceInfo = JSON.parse(fields.device_info);
  } catch {
  deviceInfo = {};
  }
  }
  deviceInfo.ip = ip;

  // Submit attendance

const record = await attendanceService.submitTraineeAttendance({
  trainee_id:  trainee.id,
  session_id:  session.id,
  session_label: fields.session_label,
  selfie_path:   selfiePath,
  gps_lat:  gpsLat,
  gps_lng:  gpsLng,
  gps_accuracy:  gpsAcc,
  gps_address:   gpsAddress,
  device_info:   deviceInfo,
  tenant_id:  tenantId,
  });

  await activityLogService.logAction(
  authResult.user.userId,
  'submit_attendance',
  'attendance',
  record.id,
  {
  trainee_id:  trainee.id,
  session_id:  session.id,
  session_label: fields.session_label,
  status:  record.status,
  selfie_path:   selfiePath,
  }
  );

  return createdResponse(record, 'Attendance submitted successfully');
});
