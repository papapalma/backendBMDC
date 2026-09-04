import { NextRequest } from 'next/server';
import { anomalyService } from '@/services/anomalyService';
import { requireRoleAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { activityLogService } from '@/services/activityLogService';

// OPTIONS /api/anomalies/scan - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * POST /api/anomalies/scan
 * Trigger manual anomaly detection scan
 * Runs all enabled detection checks from configuration.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  console.log('🔍 [SCAN] Starting manual scan request');
  
  const authResult = await requireRoleAsync(request, ['local_admin', 'staff_inventory_manager', 'staff_training_coordinator']);
  if ('error' in authResult) {
    console.error('🔍 [SCAN] Auth failed');
    return authResult.error;
  }

  const userId = authResult.user.userId;
  const userEmail = authResult.user.email;
  const tenantId = authResult.user.tenantId;
  const isSuperAdmin = authResult.user.role === 'super_admin';
  console.log('🔍 [SCAN] Authenticated user:', { userId, userEmail, role: authResult.user.role, tenantId });

  // Run all detection checks and persist run history
  try {
    console.log('🔍 [SCAN] Calling runDetectionScan...');
    const { run, result } = await anomalyService.runDetectionScan('manual', userEmail, !isSuperAdmin ? tenantId : undefined);
    console.log('🔍 [SCAN] Scan completed:', { runId: run.id, totalFound: result.total_found });

    // Calculate counts by severity
    const criticalCount = result.anomalies.filter(a => a.severity === 'critical').length;
    const warningCount = result.anomalies.filter(a => a.severity === 'warning').length;
    const infoCount = result.anomalies.filter(a => a.severity === 'info').length;

    // Log the scan activity
    console.log('🔍 [SCAN] Logging activity...');
    try {
      await activityLogService.logAction(
        userId,
        'trigger_anomaly_scan',
        'anomaly',
        run.id, // Use the detection run ID as the entity_id
        {
          email: userEmail,
          run_id: run.id,
          total_found: result.total_found,
          by_type: result.by_type,
          critical_count: criticalCount,
          warning_count: warningCount,
          info_count: infoCount,
        }
      );
      console.log('🔍 [SCAN] Activity logged successfully');
    } catch (logError) {
      console.error('🔍 [SCAN] Activity logging failed:', logError);
      // Don't fail the whole request if logging fails
    }

    console.log('🔍 [SCAN] Returning success response');
    return successResponse(run);
  } catch (scanError) {
    console.error('🔍 [SCAN] Detection scan failed:', scanError);
    throw scanError;
  }
});
