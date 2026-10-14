import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/items/stats - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/items/stats - Get inventory statistics for the current tenant

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);
  if ('error' in authResult) return authResult.error as NextResponse;

  const tenantId = authResult.user.tenantId;

  const { data: items, error } = await supabaseAdmin
    .from('items')
    .select('id, category, quantity, available_quantity, status, minimum_quantity')
    .eq('tenant_id', tenantId);

  if (error) throw error;

  const rows = items || [];
  const byCategory: Record<string, number> = {};

  rows.forEach((item) => {
    const category = item.category || 'Uncategorized';
    byCategory[category] = (byCategory[category] || 0) + 1;
  });

  const totalItems = rows.length;
  const totalQuantity = rows.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const availableQuantity = rows.reduce((sum, item) => sum + (item.available_quantity || 0), 0);
  const borrowedQuantity = Math.max(totalQuantity - availableQuantity, 0);
  const lowStockItems = rows.filter((item) => item.status === 'low_stock').length;
  const outOfStockItems = rows.filter((item) => item.status === 'out_of_stock').length;

  return successResponse({
    totalItems,
    totalQuantity,
    availableQuantity,
    borrowedQuantity,
    lowStockItems,
    outOfStockItems,
    byCategory,
  });
});
