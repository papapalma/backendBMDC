/**
 * GET /api/reports/inventory-summary
 *
 * Tenant-scoped inventory summary report (Req 4.7, 8.7).
 * Returns items, categories, quantities, and utilization for the
 * requesting user's tenant. Supports date range filtering and PDF/CSV export.
 *
 * Requirements: 4.7, 8.7, 10.8, 10.9
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { getInventorySummary } from '@/services/reportingService';
import {
  buildSimplePdf,
  createPdfDownloadResponse,
  objectsToCsv,
  createCsvDownloadResponse,
} from '@/utils/export';

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  const allowedRoles = [
  'local_admin',
  'staff_inventory_manager',
  'staff_training_coordinator',
  ];
  if (!allowedRoles.includes(role) && !isSuperAdmin) {
  return forbiddenResponse('Insufficient permissions to view inventory reports');
}

const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('start_date') || searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('end_date') || searchParams.get('endDate') || undefined;
  const format = searchParams.get('format') || 'json';

  const targetTenantId = isSuperAdmin
  ? (searchParams.get('tenant_id') || tenantId)
  : tenantId;

  const report = await getInventorySummary(targetTenantId, userId, { startDate, endDate });

// PDF export (Req 10.8)
  if (format === 'pdf') {
  const categoryLines = Object.entries(report.byCategory).map(
  ([cat, stats]) =>
  `${cat}: ${stats.count} items | Total qty: ${stats.totalQty} | Available: ${stats.availableQty}`
  );
  const lines = [
  `Generated: ${report.generatedAt}`,
  `Tenant: ${report.tenantId}`,
  '',
  `Total Items: ${report.totalItems}`,
  `Total Quantity: ${report.totalQuantity}`,
  `Available: ${report.availableQuantity}  Borrowed: ${report.borrowedQuantity}`,
  `Low Stock: ${report.lowStockCount}  Out of Stock: ${report.outOfStockCount}`,
  '',
  '--- By Category ---',
  ...categoryLines,
  '',
  '--- Low Stock Items ---',
  ...report.lowStockItems.map(
  (i) => `${i.name} (${i.category}) — qty: ${i.quantity} / min: ${i.minimum_quantity}`
  ),
  ];
  const pdf = buildSimplePdf('Inventory Summary Report', lines);
  return createPdfDownloadResponse(pdf, `inventory-summary-${targetTenantId}-${Date.now()}.pdf`);
}

  // CSV export (Req 10.8)
  if (format === 'csv') {
  const rows = report.lowStockItems.map((i) => ({
  item_id: i.id,
  name: i.name,
  category: i.category,
  available_quantity: i.quantity,
  minimum_quantity: i.minimum_quantity,
  }));
  const csv = objectsToCsv(rows);
  return createCsvDownloadResponse(csv, `inventory-summary-${targetTenantId}-${Date.now()}.csv`);
}

  return successResponse(report);
});
