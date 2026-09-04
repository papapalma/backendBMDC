import { NextRequest, NextResponse } from 'next/server';
import { requireRoleAsync } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { createCsvDownloadResponse, objectsToCsv } from '@/utils/export';
import { itemService } from '@/services/itemService';
import { lendingService } from '@/services/lendingService';
import { traineeService } from '@/services/traineeService';
import { programService } from '@/services/programService';
import { anomalyService } from '@/services/anomalyService';

// OPTIONS /api/reports/:type/csv - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

const normalizeType = (rawType: string): string => { const type = rawType.toLowerCase();
  if (type === 'items') return 'inventory';

  if (type === 'lending') return 'lendings';

  if (type === 'all') return 'dashboard';

  return type; };

// GET /api/reports/:type/csv - Export report to CSV

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

  if (type === 'inventory') { // Pass full context to service (Task 3.3: Services need isSuperAdmin flag)

const rows = (await itemService.getAllItems(context, {})).map((item) => ({ id: item.id,
  name: item.name,
  category: item.category,
  status: item.status,
  quantity: item.quantity,
  available_quantity: item.available_quantity, }));
  return createCsvDownloadResponse(objectsToCsv(rows), 'inventory-report.csv'); }

if (type === 'lendings') { // Pass full context to service (Task 3.3: Services need isSuperAdmin flag)

const rows = (await lendingService.getAllLendings(context, { start_date: startDate, end_date: endDate })).map((lending) => ({ id: lending.id,
  item_name: lending.item?.name || '',
  status: lending.status,
  quantity: lending.quantity,
  lent_date: lending.lent_date,
  expected_return_date: lending.expected_return_date,
  actual_return_date: lending.actual_return_date || '', }));
  return createCsvDownloadResponse(objectsToCsv(rows), 'lendings-report.csv'); }

if (type === 'trainees') { 
  const programs = await programService.getAllPrograms();
  const programNameById = new Map(programs.map((program) => [program.id, program.name]));
  
  // Get all trainees
  const trainees = await traineeService.getAllTrainees(context, {});
  
  // Get enrollments to get program_id and enrollment_date per trainee
  const { supabaseAdmin } = await import('@/lib/supabase-admin');
  const { data: enrollments } = await supabaseAdmin
    .from('enrollments')
    .select('trainee_id, program_id, enrollment_date, status')
    .eq('tenant_id', context.tenantId);
  
  // Build a map of trainee_id -> enrollment data (latest by enrollment_date)
  const enrollmentByTrainee = new Map();
  if (enrollments) {
    for (const enrollment of enrollments) {
      const key = enrollment.trainee_id;
      const existing = enrollmentByTrainee.get(key);
      // Keep the most recent enrollment
      if (!existing || new Date(enrollment.enrollment_date) > new Date(existing.enrollment_date)) {
        enrollmentByTrainee.set(key, enrollment);
      }
    }
  }
  
  const rows = trainees.map((trainee) => {
    const enrollment = enrollmentByTrainee.get(trainee.id);
    return {
      id: trainee.id,
      full_name: `${trainee.first_name} ${trainee.last_name}`,
      email: trainee.email,
      program: enrollment ? (programNameById.get(enrollment.program_id) || '') : '',
      status: trainee.status,
      enrollment_date: enrollment?.enrollment_date || '',
    };
  });
  return createCsvDownloadResponse(objectsToCsv(rows), 'trainees-report.csv'); 
}

if (type === 'programs') { const rows = (await programService.getAllPrograms()).map((program) => ({ id: program.id,
  name: program.name,
  status: program.status,
  start_date: program.start_date,
  end_date: program.end_date,
  duration_weeks: program.duration_weeks, }));
  return createCsvDownloadResponse(objectsToCsv(rows), 'programs-report.csv'); }

if (type === 'anomalies') { const rows = (await anomalyService.getAllAnomalies()).map((anomaly) => ({ id: anomaly.id,
  category: anomaly.category,
  anomaly_type: anomaly.anomaly_type,
  severity: anomaly.severity,
  status: anomaly.status,
  description: anomaly.description,
  detected_at: anomaly.detected_at,
  resolved_at: anomaly.resolved_at || '', }));
  return createCsvDownloadResponse(objectsToCsv(rows), 'anomalies-report.csv'); }

if (type === 'dashboard') { // Pass full context to service (Task 3.3: Services need isSuperAdmin flag)

const [items, lendings, trainees, programs] = await Promise.all([
  itemService.getAllItems(context, {}),
  lendingService.getAllLendings(context, { start_date: startDate, end_date: endDate }),
  traineeService.getAllTrainees(context, {}),
  programService.getAllPrograms(),
  ]);

  const rows = [
  { module: 'inventory', metric: 'total_items', value: items.length },
  { module: 'inventory', metric: 'low_stock_items', value: items.filter((item) => item.status === 'low_stock' || item.status === 'out_of_stock').length },
  { module: 'lendings', metric: 'total_lendings', value: lendings.length },
  { module: 'lendings', metric: 'active_lendings', value: lendings.filter((lending) => lending.status === 'active').length },
  { module: 'lendings', metric: 'overdue_lendings', value: lendings.filter((lending) => lending.status === 'overdue').length },
  { module: 'trainees', metric: 'total_trainees', value: trainees.length },
  { module: 'programs', metric: 'total_programs', value: programs.length },
  ];

  return createCsvDownloadResponse(objectsToCsv(rows), 'dashboard-report.csv'); }

  return createCsvDownloadResponse(objectsToCsv([{ error: `Unsupported report type: ${rawType}` }]), 'unsupported-report.csv'); }
);
