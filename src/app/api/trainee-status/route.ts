import { NextRequest, NextResponse } from 'next/server';
import { traineeStatusService } from '@/services/traineeStatusService';
import { createTraineeStatusSchema, traineeStatusFilterSchema } from '@/utils/validators';
import { requireTenantContext } from '@/middleware/tenantContext';
import { requireAuth } from '@/middleware/auth';
import { logger } from '@/utils/logger';

/**
 * GET /api/trainee-status
 * Query trainee status records with filters and pagination
 * 
 * Query params:
 *   - employment_status: Comma-separated employment statuses (e.g., "employed,self_employed")
 *   - skills_match: Comma-separated skills match values (e.g., "exact_match,partial_match")
 *   - graduation_status: Comma-separated graduation statuses (e.g., "graduated,pending")
 *   - sort_by: Column to sort by (name, graduation_date, employment_status, skills_match, recorded_at)
 *   - sort_dir: Sort direction (asc, desc)
 *   - page: Page number (default: 1)
 *   - limit: Records per page (default: 20, max: 100)
 *   - search: Search in trainee name, job title, or employer name
 */
export async function GET(request: NextRequest) {
  try {
    // Get tenant context
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) {
      return ctxResult.error as NextResponse;
    }

    const context = ctxResult.context;

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    
    // Parse comma-separated filter values
    const parseCommaSeparatedParam = (param: string | null): string[] => {
      if (!param) return [];
      return param
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    };

    const employmentStatusValues = parseCommaSeparatedParam(
      searchParams.get('employment_status')
    );
    const skillsMatchValues = parseCommaSeparatedParam(searchParams.get('skills_match'));
    const graduationStatusValues = parseCommaSeparatedParam(
      searchParams.get('graduation_status')
    );

    // Parse pagination parameters
    const page = searchParams.get('page') ? Math.max(1, parseInt(searchParams.get('page')!)) : 1;
    const limit = searchParams.get('limit')
      ? Math.min(100, Math.max(1, parseInt(searchParams.get('limit')!)))
      : 20;

    // Parse sort parameters
    const sortBy = (searchParams.get('sort_by') || 'recorded_at') as
      | 'name'
      | 'graduation_date'
      | 'employment_status'
      | 'skills_match'
      | 'recorded_at';
    const sortDir = (searchParams.get('sort_dir') || 'desc') as 'asc' | 'desc';

    const search = searchParams.get('search') || undefined;

    // Build filters object
    const filters = {
      graduation_status: graduationStatusValues.length > 0 ? graduationStatusValues : undefined,
      employment_status: employmentStatusValues.length > 0 ? employmentStatusValues : undefined,
      skills_match: skillsMatchValues.length > 0 ? skillsMatchValues : undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
      page,
      limit,
      search,
    };

    // Query trainee status records with advanced filtering
    const { data, count } = await traineeStatusService.queryTraineeStatusAdvanced(
      context,
      filters
    );

    const hasMore = (page - 1) * limit + data.length < count;

    return NextResponse.json({
      statusCode: 200,
      data: {
        records: data,
        pagination: {
          page,
          limit,
          total: count,
          hasMore,
        },
      },
    });
  } catch (error: any) {
    logger.error('Failed to query trainee status records', { error });

    // Handle validation errors
    if (error.name === 'ZodError') {
      return NextResponse.json(
        { statusCode: 400, error: 'Invalid query parameters', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { statusCode: 500, error: error.message || 'Failed to query trainee status records' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/trainee-status
 * Create a new trainee status record
 */
export async function POST(request: NextRequest) {
  try {
    // Get tenant context
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) {
      return ctxResult.error as NextResponse;
    }

    const context = ctxResult.context;

    // Check permission
    if (!['local_admin', 'staff_training_coordinator'].includes(context.role)) {
      return NextResponse.json({ error: 'Forbidden: insufficient permissions' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();

    // Validate input
    const validatedData = createTraineeStatusSchema.parse(body);

    // Create trainee status record
    const record = await traineeStatusService.createTraineeStatus({
      ...validatedData,
      tenantId: context.tenantId,
      recordedBy: context.userId,
    });

    // Link status record to enrollment
    if (record.enrollment_id) {
      try {
        await traineeStatusService.linkStatusRecordToEnrollment(
          record.enrollment_id,
          record.id,
          context.tenantId
        );
        logger.info('Trainee status record linked to enrollment', {
          recordId: record.id,
          enrollmentId: record.enrollment_id,
        });
      } catch (linkError: any) {
        logger.warn('Failed to link status record to enrollment', {
          recordId: record.id,
          enrollmentId: record.enrollment_id,
          error: linkError.message,
        });
        // Continue - record was created successfully, link failure is non-critical
      }
    }

    logger.info('Trainee status record created', {
      recordId: record.id,
      traineeId: record.trainee_id,
      enrollmentId: record.enrollment_id,
      tenantId: context.tenantId,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Trainee status record created successfully',
        data: record,
      },
      { status: 201 }
    );
  } catch (error: any) {
    logger.error('Failed to create trainee status record', { error });
    return NextResponse.json(
      { error: error.message || 'Failed to create trainee status record' },
      { status: 400 }
    );
  }
}
