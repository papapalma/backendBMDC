import { NextRequest, NextResponse } from 'next/server';
import { requireRoleAsync } from '@/middleware/auth';
import { nonAttendanceDateService } from '@/services/nonAttendanceDateService';
import { withErrorHandler } from '@/middleware/errorHandler';
import { successResponse } from '@/utils/responses';
import logger from '@/utils/logger';

/**
 * GET /api/non-attendance-dates - Get all excluded dates
 * Query params: program_id, start_date, end_date
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const { searchParams } = new URL(request.url);
  const programId = searchParams.get('program_id') || undefined;
  const startDate = searchParams.get('start_date') || undefined;
  const endDate = searchParams.get('end_date') || undefined;

  const dates = await nonAttendanceDateService.getAllNonAttendanceDates({
  program_id: programId,
  start_date: startDate,
  end_date: endDate,
  });

  return successResponse(dates);
});

/**
 * POST /api/non-attendance-dates - Create new excluded date(s)
 * Body: { date, reason, description?, program_id?, is_recurring? }
 * OR for bulk: { dates: [...], bulk_action?: "generate_weekends" }
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const body = await request.json();

  // Handle bulk weekend generation

if (body.bulk_action === 'generate_weekends') {
  const { year, program_id } = body;
  if (!year || year < 2020 || year > 2100) {
  return NextResponse.json(
  { success: false, message: 'Valid year is required' },
  { status: 400 }
  );
  }

const count = await nonAttendanceDateService.generateWeekendsForYear(
  year,
  program_id,
  authResult.user.userId
  );

  logger.info(`Generated ${count} weekend dates for year ${year} by ${authResult.user.email}`);

  return successResponse(
  { count },
  `Generated ${count} weekend dates for ${year}`,
  201
  );
  }

  // Handle bulk create

if (body.dates && Array.isArray(body.dates)) {
  const datesData = body.dates.map((d: any) => ({
  ...d,
  created_by: authResult.user.userId,
  }));

  const inserted = await nonAttendanceDateService.bulkCreateNonAttendanceDates(datesData);

  logger.info(`Bulk created ${inserted.length} non-attendance dates by ${authResult.user.email}`);

  return successResponse(inserted, 'Dates added successfully', 201);
  }

  // Single date creation

const { date, reason, description, program_id, is_recurring } = body;

  if (!date || !reason) {
  return NextResponse.json(
  { success: false, message: 'date and reason are required' },
  { status: 400 }
  );
  }

const inserted = await nonAttendanceDateService.createNonAttendanceDate({
  date,
  reason,
  description,
  program_id,
  is_recurring: is_recurring || false,
  created_by: authResult.user.userId,
  });

  logger.info(`Created non-attendance date ${date} by ${authResult.user.email}`);

  return successResponse(inserted, 'Date added successfully', 201);
});
