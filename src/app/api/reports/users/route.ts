import { NextRequest, NextResponse } from 'next/server';
import { requireRoleAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';

// OPTIONS /api/reports/users - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/reports/users - Get user analytics report

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin', 'staff_inventory_manager', 'staff_training_coordinator']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const user = authResult.user;
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate') || searchParams.get('start_date') || undefined;
  const endDate = searchParams.get('endDate') || searchParams.get('end_date') || undefined;

  let usersQuery = supabaseAdmin
  .from('users')
  .select('id, email, username, role, created_at');

  // Tenant isolation: non-super-admins can only see their own tenant's users

if (user.role !== 'super_admin') {
  usersQuery = usersQuery.eq('tenant_id', user.tenantId);
  }

const { data: users, error: usersError } = await usersQuery.order('created_at', { ascending: false });

  if (usersError) throw usersError;

  let logsQuery = supabaseAdmin
  .from('activity_logs')
  .select('user_id, created_at');

  // Tenant isolation: non-super-admins can only see their own tenant's activity logs

if (user.role !== 'super_admin') {
  logsQuery = logsQuery.eq('tenant_id', user.tenantId);
  }

if (startDate) {
  logsQuery = logsQuery.gte('created_at', startDate);
  }

if (endDate) {
  logsQuery = logsQuery.lte('created_at', endDate);
  }

const { data: logs, error: logsError } = await logsQuery;
  if (logsError) throw logsError;

  const userRows = users || [];
  const logRows = logs || [];

  const byRole = userRows.reduce((acc, user) => {
  acc[user.role] = (acc[user.role] || 0) + 1;
  return acc;
  }, {} as Record<string, number>);

  const activityCountByUser: Record<string, number> = {};
  for (const log of logRows) {
  if (!log.user_id) continue;
  activityCountByUser[log.user_id] = (activityCountByUser[log.user_id] || 0) + 1;
  }

const activeUsers = userRows.filter((user) => (activityCountByUser[user.id] || 0) > 0).length;
  const inactiveUsers = userRows.length - activeUsers;

  const startDateFilter = startDate ? new Date(startDate).getTime() : null;
  const endDateFilter = endDate ? new Date(endDate).getTime() : null;

  const newUsersTrendMap: Record<string, number> = {};
  for (const user of userRows) {
  const createdAt = new Date(user.created_at).getTime();
  if (startDateFilter && createdAt < startDateFilter) continue;
  if (endDateFilter && createdAt > endDateFilter) continue;

  const dateKey = user.created_at.split('T')[0];
  newUsersTrendMap[dateKey] = (newUsersTrendMap[dateKey] || 0) + 1;
  }

const newUsersTrend = Object.entries(newUsersTrendMap)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([date, count]) => ({ date, count }));

  const userActivity = userRows
  .map((user) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  role: user.role,
  activityCount: activityCountByUser[user.id] || 0,
  created_at: user.created_at,
  }))
  .sort((a, b) => b.activityCount - a.activityCount);

  return successResponse({
  totalUsers: userRows.length,
  byRole,
  activeUsers,
  inactiveUsers,
  newUsersTrend,
  userActivity,
  });
});
