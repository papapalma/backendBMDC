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
 *   idempotency_key (string, optional) — UUID for duplicate detection
 *
 * Selfie storage path:
 *   /uploads/{tenant_id}/images/attendance/{traineeId}_{sessionId}_{am|pm}_{unixTs}.jpg
 * 
 * Task 19: Duplicate Detection
 * - If idempotency_key matches recent submission (within 5s), returns 409 Conflict
 * - Otherwise, new submission is created normally
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
import { checkRateLimit } from '@/utils/rateLimit';
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
import { detectCompressionBomb } from '@/lib/security/decompression-bomb';
import { validateGPS, validateDeviceInfo, validateJsonbSize, validateGeofence, getGeofenceForProgram } from '@/lib/security/index';
import { maybeEncrypt, isEncryptionEnabled } from '@/lib/fileEncryption';
import { checkDuplicateSubmission, recordSubmission } from '@/lib/duplicateSubmissionDetection';

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
  idempotency_key: z.string().uuid().optional().nullable(),  // Task 19: idempotency key
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
 * Encrypts the image before storage if FILE_ENCRYPTION_ENABLED is true.
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

  let processedBuffer = await sharp(imageBuffer)
    .rotate()  // auto-orient from EXIF
    .resize(SELFIE_MAX_DIM, SELFIE_MAX_DIM, {
      fit:  'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: SELFIE_QUALITY, mozjpeg: false })
    .toBuffer() as Buffer;

  // Task 10.3: Encrypt selfie before storage if encryption is enabled
  if (isEncryptionEnabled()) {
    processedBuffer = maybeEncrypt(processedBuffer);
  }

  await fs.writeFile(absPath, processedBuffer);

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

  // Resolve trainee to get tenantId and traineeId for rate limiting
  const trainee = await resolveTrainee(authResult.user.userId);
  if (!trainee) return notFoundResponse('Trainee profile not found');

  // Apply rate limiting
  const rlKey = `submit:${trainee.tenant_id}:${trainee.id}`;
  const rlResponse = checkRateLimit(rlKey, {
    limit: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
  });
  if (rlResponse) return rlResponse; // 429 Too Many Requests

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
  idempotency_key: formData.get('idempotency_key'),  // Task 19: idempotency key
  };

  const fields = submitFieldsSchema.parse(
  Object.fromEntries(
  Object.entries(rawFields).map(([k, v]) => [k, v ? String(v) : null])
  )
  );

  // Resolve tenant for later use
  const tenantId = trainee.tenant_id as string;

  // Find today's session early (needed for duplicate check and order validation)
  if (!trainee.program_id) {
    return errorResponse('You are not enrolled in any program', 400);
  }

  const session = await findTodaySession(trainee.program_id, tenantId);
  if (!session) {
    return errorResponse('No session is scheduled for your program today', 400);
  }

  // Task 19: Check for duplicate submission within 5-second window
  if (fields.idempotency_key) {
    const dupCheck = await checkDuplicateSubmission(
      fields.idempotency_key,
      trainee.id,
      session.id
    );
    
    if (dupCheck.isDuplicate) {
      await activityLogService.logAction(
        authResult.user.userId,
        'submit_duplicate',
        'attendance',
        dupCheck.cachedRecordId ?? 'unknown',
        {
          trainee_id: trainee.id,
          reason: dupCheck.reason,
          idempotency_key: fields.idempotency_key,
        }
      );
      return errorResponse(dupCheck.reason || 'Duplicate submission', 409);
    }
  }

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

  // ponytail: simple decompression bomb detection (upgrade: ClamAV for production)
  const bombCheck = await detectCompressionBomb(imageBuffer, file.type, file.name);
  if (bombCheck.isBomb) {
    return errorResponse(`File rejected: potential compression bomb (${bombCheck.reason})`, 400);
  }

  // Resolve trainee again for isolation check (already have trainee from above)
  // ponytail: simple boundary check (upgrade: move to RLS)
  // Trainee isolation verified via userId-based query in resolveTrainee() —
  // only trainees belonging to authenticated user can submit.
  if (!trainee.id) return errorResponse('Cannot submit for another trainee', 403);

  if (!trainee.program_id) {
  return errorResponse('You are not enrolled in any program', 400);
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

  // Task 18: Validate session order (morning must come before afternoon on same day)
  // ponytail: simple O(n) query per day, marks ceiling as multi-session workflow
  if (fields.session_label === 'afternoon') {
    // Check if morning session was submitted today for this trainee
    const { data: morningRecord } = await supabaseAdmin
      .from('attendance')
      .select('id')
      .eq('trainee_id', trainee.id)
      .eq('session_id', session.id)
      .limit(1)
      .maybeSingle();

    // If no morning attendance exists for today's session, reject afternoon submission
    if (!morningRecord) {
      return errorResponse(
        'Must submit morning session before afternoon session',
        400
      );
    }
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

  // Validate GPS coordinates if provided
  if (gpsLat !== undefined || gpsLng !== undefined) {
    const gpsValidation = validateGPS(gpsLat, gpsLng, gpsAcc);
    if (!gpsValidation.valid) {
      return errorResponse(gpsValidation.reason || 'Invalid GPS data', 400);
    }

    // Task 22: Validate geofence (check if GPS is within authorized location)
    // ponytail: simple geofence check (upgrade: support multiple geofences per program)
    if (trainee.program_id) {
      const geofence = await getGeofenceForProgram(trainee.program_id, tenantId);
      
      if (geofence) {
        // Geofence exists for this program - validate GPS against it
        const geofenceValidation = validateGeofence(gpsLat!, gpsLng!, gpsAcc, geofence);
        if (!geofenceValidation.valid) {
          // Log geofence violation
          await activityLogService.logAction(
            authResult.user.userId,
            'geofence_violation',
            'attendance',
            `violation_${session.id}`,
            {
              trainee_id: trainee.id,
              session_id: session.id,
              reason: geofenceValidation.reason,
              gps_lat: gpsLat,
              gps_lng: gpsLng,
              gps_accuracy: gpsAcc,
            }
          );
          return errorResponse(geofenceValidation.reason || 'Location outside authorized area', 403);
        }
      }
      // If no geofence exists, GPS validation alone is sufficient
    }
  }

  // Task 15.3: Validate gps_address JSONB size limit if provided
  // ponytail: one validation call, reuse existing validateJsonbSize
  if (gpsAddress !== undefined && gpsAddress !== null) {
    try {
      const gpsAddressObj = typeof gpsAddress === 'string' ? JSON.parse(gpsAddress) : gpsAddress;
      const gpsAddressCheck = validateJsonbSize('gps_address', gpsAddressObj);
      if (!gpsAddressCheck.valid) {
        return errorResponse(gpsAddressCheck.reason || 'gps_address exceeds size limit', 400);
      }
    } catch (err) {
      // If gps_address is not valid JSON, treat as plain string
      const gpsAddressCheck = validateJsonbSize('gps_address', gpsAddress);
      if (!gpsAddressCheck.valid) {
        return errorResponse(gpsAddressCheck.reason || 'gps_address exceeds size limit', 400);
      }
    }
  }

  // Extract IP from headers

const ip =
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
  request.headers.get('x-real-ip') ??
  'unknown';

  // Parse and validate device_info JSON (Task 17.3: Apply validation on submission)
  // Task 17: Before processing, validate device_info with schema
  let deviceInfo: Record<string, unknown> = {};
  if (fields.device_info) {
    try {
      const parsed = JSON.parse(fields.device_info);
      const deviceValidation = validateDeviceInfo(parsed);
      if (!deviceValidation.valid) {
        return errorResponse(`Invalid device_info: ${deviceValidation.reason}`, 400);
      }
      deviceInfo = deviceValidation.data as Record<string, unknown>;
    } catch (err) {
      return errorResponse('device_info must be valid JSON', 400);
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

  // Task 19: Record idempotency key for duplicate detection
  if (fields.idempotency_key) {
    await recordSubmission(
      fields.idempotency_key,
      trainee.id,
      session.id,
      record.id
    );
  }

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

  // Task 11.1: Log GPS data submission as READ action (trainee submitting their own GPS)
  // ponytail: one line log entry per GPS read, existing logger
  if (gpsLat !== undefined && gpsLng !== undefined) {
    await activityLogService.logAction(
      authResult.user.userId,
      'access_gps_data',
      'attendance',
      record.id,
      {
        trainee_id: trainee.id,
        action_type: 'gps_submission',
        gps_accuracy: gpsAcc,
        gps_address: gpsAddress,
        timestamp: new Date().toISOString(),
        // NOTE: We do NOT log actual coordinates to prevent sensitive data in audit logs
        coordinates_submitted: true,
      }
    );
  }

  return createdResponse(record, 'Attendance submitted successfully');
});
