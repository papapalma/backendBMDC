import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/reports/dashboard - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/reports/dashboard - Get dashboard statistics for the current tenant

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);
  if ('error' in authResult) return authResult.error as NextResponse;

  const tenantId = authResult.user.tenantId;
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate') || searchParams.get('start_date') || undefined;
  const endDate = searchParams.get('endDate') || searchParams.get('end_date') || undefined;
  const endDateExclusive = endDate
    ? new Date(`${endDate}T00:00:00.000Z`)
    : undefined;
  if (endDateExclusive) endDateExclusive.setUTCDate(endDateExclusive.getUTCDate() + 1);

  // Fetch all required data in parallel, scoped to the current tenant

const [
    traineesResult,
    itemsResult,
    lendingsResult,
    programsResult,
  ] = await Promise.all([
    (() => {
      let query = supabaseAdmin
        .from('trainees')
        .select('status, created_at, employment_status')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null);
      if (startDate) query = query.gte('created_at', `${startDate}T00:00:00.000Z`);
      if (endDateExclusive) query = query.lt('created_at', endDateExclusive.toISOString());
      return query;
    })(),
    supabaseAdmin.from('items').select('quantity, available_quantity, status').eq('tenant_id', tenantId),
    (() => {
      let query = supabaseAdmin
        .from('lendings')
        .select('status, expected_return_date, actual_return_date, lent_date')
        .eq('tenant_id', tenantId);
      if (startDate) query = query.gte('lent_date', startDate);
      if (endDateExclusive) query = query.lt('lent_date', endDateExclusive.toISOString().slice(0, 10));
      return query;
    })(),
    supabaseAdmin.from('programs').select('status').eq('tenant_id', tenantId),
  ]);

  if (traineesResult.error) throw traineesResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (lendingsResult.error) throw lendingsResult.error;
  if (programsResult.error) throw programsResult.error;

  // Trainee statistics

const trainees = traineesResult.data || [];
  const traineeStats = {
    total: trainees.length,
    active: trainees.filter(t => t.status === 'active').length,
    completed: trainees.filter(t => t.status === 'completed').length,
    inactive: trainees.filter(t => t.status === 'inactive').length,
  };
  const employmentStatusCounts = trainees.reduce((counts: Record<string, number>, trainee) => {
    const status = trainee.employment_status || 'Unknown';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});

  // Inventory statistics

const items = itemsResult.data || [];
  const inventoryStats = {
    total: items.length,
    available: items.reduce((sum, item) => sum + (item.available_quantity || 0), 0),
    borrowed: items.reduce((sum, item) => sum + ((item.quantity || 0) - (item.available_quantity || 0)), 0),
    lowStock: items.filter(item => item.status === 'low_stock' || item.status === 'out_of_stock').length,
  };

  // Lending statistics

const lendings = lendingsResult.data || [];
  const now = new Date();
  const lendingStats = {
    total: lendings.length,
    active: lendings.filter(l => l.status === 'active').length,
    overdue: lendings.filter(l => {
      if (l.status !== 'active') return false;
      return l.expected_return_date && new Date(l.expected_return_date) < now;
    }).length,
    returned: lendings.filter(l => l.status === 'returned').length,
  };

  // Program statistics

const programs = programsResult.data || [];
  const programStats = {
    total: programs.length,
    ongoing: programs.filter(p => p.status === 'active').length,
    upcoming: programs.filter(p => p.status === 'upcoming').length,
    completed: programs.filter(p => p.status === 'completed').length,
  };

  return successResponse({
    trainees: traineeStats,
    employmentStatusCounts,
    inventory: inventoryStats,
    lending: lendingStats,
    programs: programStats,
  });
});
