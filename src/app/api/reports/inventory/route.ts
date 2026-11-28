/**
 * GET /api/reports/inventory — inventory report (tenant-scoped, Req 8.7)
 *
 * Updated to enforce tenant context so each LGU only sees its own items.
 */

import { NextRequest, NextResponse } from 'next/server';
import { itemService } from '@/services/itemService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/reports/inventory - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/reports/inventory - Get inventory report (tenant-scoped)
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role, isSuperAdmin } = ctxResult.context;

  const allowedRoles = [
    'local_admin',
    'staff_inventory_manager',
    'staff_training_coordinator',
  ];
  if (!allowedRoles.includes(role) && !isSuperAdmin) {
    return forbiddenResponse('Insufficient permissions to view inventory reports');
  }

  const { searchParams } = new URL(request.url);

  const targetTenantId = isSuperAdmin
    ? (searchParams.get('tenant_id') || tenantId)
    : tenantId;

  // Create a modified context for the query if super admin selected a specific tenant
  const queryContext = isSuperAdmin && searchParams.get('tenant_id')
    ? { ...ctxResult.context, tenantId: targetTenantId, isSuperAdmin: false }
    : ctxResult.context;

  // Pass full context to service (Task 3.3: Services need isSuperAdmin flag)
  const items = await itemService.getAllItems(queryContext, {});

  const report = {
    tenantId: targetTenantId,
    totalItems: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    availableQuantity: items.reduce((sum, item) => sum + item.available_quantity, 0),
    borrowedQuantity: items.reduce(
      (sum, item) => sum + (item.quantity - item.available_quantity),
      0
    ),
    byStatus: items.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byCategory: items.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    lowStockItems: items.filter(
      (item) => item.status === 'low_stock' || item.status === 'out_of_stock'
    ),
  };

  return successResponse(report);
});
