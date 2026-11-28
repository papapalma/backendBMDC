import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';

const mapEntityTypeToModule = (entityType: string): string => {
  const moduleMap: Record<string, string> = {
  item: 'Inventory',
  trainee: 'Trainees',
  program: 'Programs',
  lending: 'Lendings',
  user: 'Users',
  auth: 'Authentication',
  anomaly: 'Anomalies',
  };

  return moduleMap[entityType.toLowerCase()] || entityType;
};

const mapModuleToEntityType = (moduleName: string): string => {
  const mapping: Record<string, string> = {
  inventory: 'item',
  trainees: 'trainee',
  trainee: 'trainee',
  programs: 'program',
  lendings: 'lending',
  lending: 'lending',
  users: 'user',
  auth: 'auth',
  anomalies: 'anomaly',
  };

  return mapping[moduleName.toLowerCase()] || moduleName;
};

// OPTIONS /api/reports/activity - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/reports/activity - Get activity analytics report

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);
  if ('error' in authResult) return authResult.error as NextResponse;

  const user = authResult.user;
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate') || searchParams.get('start_date') || undefined;
  const endDate = searchParams.get('endDate') || searchParams.get('end_date') || undefined;
  const endDateExclusive = endDate ? new Date(`${endDate}T00:00:00.000Z`) : undefined;
  if (endDateExclusive && !Number.isNaN(endDateExclusive.getTime())) {
    endDateExclusive.setUTCDate(endDateExclusive.getUTCDate() + 1);
  }
  const module = searchParams.get('module') || undefined;
  const userId = searchParams.get('userId') || searchParams.get('user_id') || undefined;
  const limitParam = Number(searchParams.get('limit') || '1000');
  const limit = Number.isNaN(limitParam) ? 1000 : Math.min(Math.max(limitParam, 1), 5000);

  let logsQuery = supabaseAdmin
  .from('activity_logs')
  .select(`
  id,
  user_id,
  action,
  entity_type,
  entity_id,
  details,
  created_at,
  tenant_id,
  users:user_id (
  username,
  email
  )
  `);

  let lendingsQuery = supabaseAdmin
    .from('lendings')
    .select('id, lent_date, actual_return_date, status, quantity, tenant_id');

  // Tenant isolation: non-super-admins can only see their own tenant's activity

if (user.role !== 'super_admin') {
  logsQuery = logsQuery.eq('tenant_id', user.tenantId);
  lendingsQuery = lendingsQuery.eq('tenant_id', user.tenantId);
  }

if (startDate) {
  logsQuery = logsQuery.gte('created_at', `${startDate}T00:00:00.000Z`);
  }

if (endDateExclusive && !Number.isNaN(endDateExclusive.getTime())) {
  logsQuery = logsQuery.lt('created_at', endDateExclusive.toISOString());
  } else if (endDate) {
  logsQuery = logsQuery.lte('created_at', endDate);
  }

if (module) {
  logsQuery = logsQuery.eq('entity_type', mapModuleToEntityType(module));
  }

if (userId) {
  logsQuery = logsQuery.eq('user_id', userId);
  }

const [{ data, error }, { data: lendingRows }] = await Promise.all([
  logsQuery.order('created_at', { ascending: false }).limit(limit),
  lendingsQuery,
]);
  if (error) throw error;

  const logs = data || [];
  const lendings = lendingRows || [];

  const byAction: Record<string, number> = {};
  const byModule: Record<string, number> = {};
  const trendMap: Record<string, { borrowed: number; returned: number; total: number }> = {};
  const lendingTrendMap: Record<string, { borrowed: number; returned: number; total: number }> = {};
  const userMap: Record<string, { count: number; userName: string }> = {};

  const endDateIsoDay = endDateExclusive && !Number.isNaN(endDateExclusive.getTime())
    ? endDateExclusive.toISOString().slice(0, 10)
    : undefined;

  for (const lending of lendings) {
    const lentDay = (lending.lent_date || '').split('T')[0];
    if (lentDay && (!startDate || lentDay >= startDate) && (!endDateIsoDay || lentDay < endDateIsoDay)) {
      if (!lendingTrendMap[lentDay]) {
        lendingTrendMap[lentDay] = { borrowed: 0, returned: 0, total: 0 };
      }
      lendingTrendMap[lentDay].borrowed += 1;
      lendingTrendMap[lentDay].total += 1;
    }

    const returnDay = (lending.actual_return_date || '').split('T')[0];
    if (returnDay && (!startDate || returnDay >= startDate) && (!endDateIsoDay || returnDay < endDateIsoDay)) {
      if (!lendingTrendMap[returnDay]) {
        lendingTrendMap[returnDay] = { borrowed: 0, returned: 0, total: 0 };
      }
      lendingTrendMap[returnDay].returned += 1;
      lendingTrendMap[returnDay].total += 1;
    }
  }

  for (const log of logs) {
  const action = log.action || 'unknown';
  const entityType = log.entity_type || 'unknown';
  const moduleName = mapEntityTypeToModule(entityType);

  byAction[action] = (byAction[action] || 0) + 1;
  byModule[moduleName] = (byModule[moduleName] || 0) + 1;

  const dateKey = (log.created_at || '').split('T')[0] || 'unknown';
  if (!trendMap[dateKey]) {
  trendMap[dateKey] = { borrowed: 0, returned: 0, total: 0 };
  }

  trendMap[dateKey].total += 1;
  const normalizedAction = action.toLowerCase();
  if (normalizedAction.includes('borrow') || normalizedAction.includes('lend')) {
  trendMap[dateKey].borrowed += 1;
  }

if (normalizedAction.includes('return')) {
  trendMap[dateKey].returned += 1;
  }

const userKey = log.user_id || 'unknown';
  if (!userMap[userKey]) {
  const userName = (log.users as { username?: string; email?: string } | null)?.username
  || (log.users as { username?: string; email?: string } | null)?.email
  || 'Unknown User';

  userMap[userKey] = {
  count: 0,
  userName,
  };
  }

  userMap[userKey].count += 1;
  }

  const activeTrendSource = Object.keys(lendingTrendMap).length > 0 ? lendingTrendMap : trendMap;
  const trend = Object.entries(activeTrendSource)
  .filter(([date]) => date !== 'unknown')
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([date, values]) => ({ date, ...values }));

  const topUsers = Object.entries(userMap)
  .map(([id, values]) => ({ id, ...values }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 10);

  const recent = logs.slice(0, 50).map((log) => {
  const action = log.action || 'unknown';
  const moduleName = mapEntityTypeToModule(log.entity_type || 'unknown');
  const userName = (log.users as { username?: string; email?: string } | null)?.username
  || (log.users as { username?: string; email?: string } | null)?.email
  || 'Unknown User';

  return {
  id: log.id,
  created_at: log.created_at,
  user_id: log.user_id,
  userName,
  action,
  module: moduleName,
  description: `${action} ${moduleName}`,
  details: log.details,
  };
  });

  return successResponse({
  totalActions: logs.length,
  byAction,
  byModule,
  trend,
  topUsers,
  recent,
  });
});
