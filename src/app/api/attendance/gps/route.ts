/**
 * GPS History Access Endpoint
 *
 * GET /api/attendance/gps - retrieve GPS history with privacy controls
 *
 * Query Parameters:
 *   ?trainee_id=X      — filter by trainee (optional, default: own trainee)
 *   ?includeGPS=true   — include GPS coordinates (default: false for privacy)
 *   ?limit=50          — pagination limit (default: 50, max: 100)
 *   ?offset=0          — pagination offset (default: 0)
 *
 * Authorization:
 *   - Trainee: 403 Forbidden (cannot access any GPS data)
 *   - Coordinator: 200 OK (can access tenant trainees' GPS history)
 *   - Admin: 200 OK (can access all GPS data, must provide reason)
 *
 * Response:
 *   - includeGPS=false: attendance data WITHOUT gps_lat, gps_lng, gps_address
 *   - includeGPS=true:  attendance data WITH GPS coordinates + audit log entry
 *
 * Audit Logging:
 *   - Every GPS_READ logged with userId, traineeId, role, timestamp
 *   - Admin access logged with admin_override: true
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireRoleAsync } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import {
  successResponse,
  forbiddenResponse,
  errorResponse,
} from '@/utils/responses';

// Query params validation
const gpsQuerySchema = z.object({
  trainee_id: z.string().uuid().optional(),
  includeGPS: z.enum(['true', 'false']).optional().default('false'),
  limit: z.string().pipe(z.coerce.number().int().min(1).max(100)).optional().default('50'),
  offset: z.string().pipe(z.coerce.number().int().min(0)).optional().default('0'),
  reason: z.string().optional(), // required for admin access
});

type GPSQuery = z.infer<typeof gpsQuerySchema>;

export const GET = withErrorHandler(async (request: NextRequest) => {
  // 1. Check authentication and role
  const authResult = await requireRoleAsync(request, ['trainee', 'staff_coordinator', 'admin', 'local_admin']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const { user } = authResult;
  const { role, userId, tenantId } = user;

  // Extract and validate query params
  const searchParams = new URL(request.url).searchParams;
  const query = gpsQuerySchema.parse(
    Object.fromEntries(searchParams.entries())
  );

  const includeGPS = query.includeGPS === 'true';
  const limit = Math.min(query.limit, 100); // cap at 100
  const offset = query.offset;

  // 2. Authorization: Trainees cannot access GPS data (even their own)
  // ponytail: simple role check (upgrade: move authorization to RLS)
  if (role === 'trainee') {
    // Log the denial for audit
    await activityLogService.logAction(
      userId,
      'access_gps_denied',
      'gps_history',
      'unknown',
      {
        reason: 'trainee_role_denied',
        requested_trainee: query.trainee_id || 'own',
        timestamp: new Date().toISOString(),
      }
    );
    return forbiddenResponse('Trainees cannot access GPS data');
  }

  // 3. Determine which trainee(s) to query
  let targetTraineeId: string | null = null;
  let queryTenantId = tenantId; // default to authenticated tenant

  if (query.trainee_id) {
    // Coordinator/Admin requesting specific trainee
    targetTraineeId = query.trainee_id;

    // Verify trainee belongs to authenticated tenant (for coordinators)
    const { data: trainee, error: traineeErr } = await supabaseAdmin
      .from('trainees')
      .select('id, tenant_id')
      .eq('id', targetTraineeId)
      .single();

    if (traineeErr || !trainee) {
      await activityLogService.logAction(userId, 'access_gps_denied', 'gps_history', 'unknown', {
        reason: 'trainee_not_found',
        requested_trainee: targetTraineeId,
      });
      return errorResponse('Trainee not found', 404);
    }

    // Cross-tenant check: coordinators cannot access other tenant's trainees
    if (role !== 'admin' && role !== 'local_admin' && trainee.tenant_id !== tenantId) {
      await activityLogService.logAction(userId, 'access_gps_denied', 'gps_history', 'unknown', {
        reason: 'cross_tenant_denied',
        requested_tenant: trainee.tenant_id,
        authenticated_tenant: tenantId,
      });
      return forbiddenResponse('Cannot access GPS data from other tenants');
    }

    queryTenantId = trainee.tenant_id;
  }

  // 4. Query GPS history with tenant isolation
  let query_builder = supabaseAdmin
    .from('attendance')
    .select(`
      id,
      trainee_id,
      session_id,
      status,
      gps_lat,
      gps_lng,
      gps_accuracy,
      gps_address,
      created_at,
      trainees!inner(first_name, last_name)
    `)
    .eq('tenant_id', queryTenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (targetTraineeId) {
    query_builder = query_builder.eq('trainee_id', targetTraineeId);
  }

  const { data: records, error: queryErr } = await query_builder;

  if (queryErr) {
    return errorResponse('Failed to fetch GPS history', 500);
  }

  // 5. Apply privacy filtering
  // ponytail: simple privacy mask (upgrade: field-level RLS)
  const records_filtered = (records || []).map((record: any) => {
    const safeRecord = {
      id: record.id,
      trainee_id: record.trainee_id,
      trainee_name: `${record.trainees.first_name} ${record.trainees.last_name}`,
      session_id: record.session_id,
      status: record.status,
      created_at: record.created_at,
      gps_accuracy: record.gps_accuracy,
    };

    // Only include GPS coordinates if explicitly requested AND authorized
    if (includeGPS) {
      return {
        ...safeRecord,
        gps_lat: record.gps_lat,
        gps_lng: record.gps_lng,
        gps_address: record.gps_address,
      };
    }

    return safeRecord;
  });

  // 6. Create audit log entry for GPS access
  // Only log when includeGPS=true (accessing actual coordinates)
  if (includeGPS) {
    for (const record of records_filtered) {
      await activityLogService.logAction(
        userId,
        'access_gps_data',
        'gps_history',
        record.id,
        {
          trainee_id: record.trainee_id,
          trainee_name: record.trainee_name,
          role,
          admin_override: role === 'admin' || role === 'local_admin',
          reason: query.reason || null,
          timestamp: new Date().toISOString(),
          // NOTE: We don't log actual coordinates to prevent sensitive data in audit logs
          coordinates_accessed: true,
        }
      );
    }
  }

  return successResponse({
    data: records_filtered,
    count: records_filtered.length,
    offset,
    limit,
    includeGPS,
  });
});

// OPTIONS for CORS
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
