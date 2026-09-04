import { NextRequest, NextResponse } from 'next/server';
import { anomalyService } from '@/services/anomalyService';
import { requireAuthAsync } from '@/middleware/auth';
import { paginatedResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/anomalies - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/anomalies - Get all anomalies (tenant-scoped)

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);
  if ('error' in authResult) return authResult.error as NextResponse;

  const tenantId = authResult.user.tenantId;
  const isSuperAdmin = authResult.user.role === 'super_admin';
  
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || undefined;

  // Accept comma-separated multi-value filters (e.g. severity=critical,warning)

const severityParam = searchParams.get('severity') || undefined;
  const severity = severityParam ? severityParam.split(',') : undefined;

  const statusParam = searchParams.get('status') || undefined;
  const status = statusParam ? statusParam.split(',') : undefined;

  const categoryParam = searchParams.get('category') || undefined;
  const category = categoryParam ? categoryParam.split(',') : undefined;

  const dateFrom = searchParams.get('dateFrom') || undefined;
  const dateTo = searchParams.get('dateTo') || undefined;
  const search = searchParams.get('search') || undefined;
  const entityType = searchParams.get('entityType') || undefined;
  const entityId = searchParams.get('entityId') || undefined;

  const pageParam = Number(searchParams.get('page') || '1');
  const page = Number.isNaN(pageParam) ? 1 : Math.max(pageParam, 1);

  const limitParam = Number(searchParams.get('limit') || '10');
  const limit = Number.isNaN(limitParam) ? 10 : Math.min(Math.max(limitParam, 1), 100);
  
  const result = await anomalyService.getAllAnomaliesPaginated({
    type,
    category,
    severity,
    status,
    dateFrom,
    dateTo,
    search,
    entityType,
    entityId,
    tenantId: !isSuperAdmin ? tenantId : undefined,
  }, {
    page,
    limit,
  });
  
  return paginatedResponse(result.data, result.page, result.limit, result.total);
});
