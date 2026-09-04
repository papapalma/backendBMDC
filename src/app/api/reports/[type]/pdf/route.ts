import { NextRequest, NextResponse } from 'next/server';
import { requireRoleAsync } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { buildSimplePdf, createPdfDownloadResponse } from '@/utils/export';
import { itemService } from '@/services/itemService';
import { lendingService } from '@/services/lendingService';
import { traineeService } from '@/services/traineeService';
import { programService } from '@/services/programService';
import { anomalyService } from '@/services/anomalyService';

// OPTIONS /api/reports/:type/pdf - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

const normalizeType = (rawType: string): string => { const type = rawType.toLowerCase();
  if (type === 'items') return 'inventory';

  if (type === 'lending') return 'lendings';

  if (type === 'all') return 'dashboard';

  return type; };

// GET /api/reports/:type/pdf - Export report to PDF

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ type: string }> }) => { const authResult = await requireRoleAsync(request, ['local_admin', 'staff_inventory_manager', 'staff_training_coordinator']);
  if ('error' in authResult) return authResult.error as NextResponse;

  
  const user = authResult.user;
  const context = { userId: user.userId,
  tenantId: user.tenantId,
  role: user.role,
  isSuperAdmin: user.role === 'super_admin', };

  const { type: rawType } = await params;
  const type = normalizeType(rawType);
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate') || searchParams.get('start_date') || undefined;
  const endDate = searchParams.get('endDate') || searchParams.get('end_date') || undefined;

  let lines: string[] = [];
  let title = `${type.toUpperCase()} REPORT`;

  if (type === 'inventory') { // Pass full context to service (Task 3.3: Services need isSuperAdmin flag)

const items = await itemService.getAllItems(context, {});
  lines = [
  `Total items: ${items.length}`,
  `Low stock: ${items.filter((item) => item.status === 'low_stock' || item.status === 'out_of_stock').length}`,
  '',
  ...items.slice(0, 120).map((item) => `${item.name} | ${item.category} | qty ${item.quantity} | available ${item.available_quantity} | ${item.status}`),
  ]; } else if (type === 'lendings') { // Pass full context to service (Task 3.3: Services need isSuperAdmin flag)

const lendings = await lendingService.getAllLendings(context, { start_date: startDate, end_date: endDate });
  lines = [
  `Total lendings: ${lendings.length}`,
  `Active: ${lendings.filter((lending) => lending.status === 'active').length}`,
  `Overdue: ${lendings.filter((lending) => lending.status === 'overdue').length}`,
  '',
  ...lendings.slice(0, 120).map((lending) => `${lending.item?.name || 'Unknown item'} | qty ${lending.quantity} | ${lending.status} | due ${lending.expected_return_date}`),
  ]; } else if (type === 'trainees') { // Pass full context to service (Task 3.3: Services need isSuperAdmin flag)

const trainees = await traineeService.getAllTrainees(context, {});
  lines = [
  `Total trainees: ${trainees.length}`,
  `Active: ${trainees.filter((trainee) => trainee.status === 'active').length}`,
  '',
  ...trainees.slice(0, 120).map((trainee) => `${trainee.last_name}, ${trainee.first_name} | ${trainee.status} | ${trainee.email}`),
  ]; } else if (type === 'programs') { const programs = await programService.getAllPrograms();
  lines = [
  `Total programs: ${programs.length}`,
  `Active: ${programs.filter((program) => program.status === 'active').length}`,
  '',
  ...programs.slice(0, 120).map((program) => `${program.name} | ${program.status} | ${program.start_date} to ${program.end_date}`),
  ]; } else if (type === 'anomalies') { const anomalies = await anomalyService.getAllAnomalies();
  lines = [
  `Total anomalies: ${anomalies.length}`,
  `Open: ${anomalies.filter((anomaly) => anomaly.status === 'open').length}`,
  '',
  ...anomalies.slice(0, 120).map((anomaly) => `${anomaly.anomaly_type} | ${anomaly.severity} | ${anomaly.status} | ${anomaly.description}`),
  ]; } else if (type === 'dashboard') { // Pass full context to service (Task 3.3: Services need isSuperAdmin flag)

const [items, lendings, trainees, programs] = await Promise.all([
  itemService.getAllItems(context, {}),
  lendingService.getAllLendings(context, { start_date: startDate, end_date: endDate }),
  traineeService.getAllTrainees(context, {}),
  programService.getAllPrograms(),
  ]);
  title = 'DASHBOARD SUMMARY REPORT';
  lines = [
  `Inventory total items: ${items.length}`,
  `Inventory low stock items: ${items.filter((item) => item.status === 'low_stock' || item.status === 'out_of_stock').length}`,
  `Lendings total: ${lendings.length}`,
  `Lendings active: ${lendings.filter((lending) => lending.status === 'active').length}`,
  `Lendings overdue: ${lendings.filter((lending) => lending.status === 'overdue').length}`,
  `Trainees total: ${trainees.length}`,
  `Programs total: ${programs.length}`,
  ]; } else { lines = [`Unsupported report type: ${rawType}`]; }

const pdfBytes = buildSimplePdf(title, lines);
  return createPdfDownloadResponse(pdfBytes, `${type}-report.pdf`); }
);
