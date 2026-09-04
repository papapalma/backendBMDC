import { NextRequest, NextResponse } from 'next/server';
import { anomalyService } from '@/services/anomalyService';
import { activityLogService } from '@/services/activityLogService';
import { requireRoleAsync } from '@/middleware/auth';
import { anomalyExportSchema } from '@/utils/validators';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/anomalies/ -- Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// POST /api/anomalies/ -- Export anomalies to CSV string

export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin', 'staff_inventory_manager', 'staff_training_coordinator']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const body = await request.json();
  const validated = anomalyExportSchema.parse(body);

  const csv = await anomalyService.exportAnomaliesToCsv({
  ids: validated.ids,
  ...validated.filters,
  });

  await activityLogService.logAction(
  authResult.user.userId,
  'export',
  'anomaly',
  'bulk-export',
  {
  ids_count: validated.ids?.length || 0,
  filter_keys: validated.filters ? Object.keys(validated.filters) : [],
  }
  );

  return successResponse(
  {
  csv,
  filename: `anomalies-${new Date().toISOString().split('T')[0]}.csv`,
  },
  'Anomalies exported successfully'
  );
});
