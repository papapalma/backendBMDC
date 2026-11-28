/**
 * GET /api/requirement-definitions/{id}/submissions
 * 
 * List trainee submissions for a specific requirement definition.
 * Returns paginated list with trainee info and submission status.
 * 
 * Requirements: FR2.2, FR3.2
 * 
 * Query Parameters:
 *   - status: 'pending', 'submitted', 'verified', 'rejected', 'waived' (optional filter)
 *   - sort_by: 'name' (default), 'date'
 *   - order: 'asc' (default), 'desc'
 *   - page: pagination page number (default 1)
 *   - limit: items per page (default 20, max 100)
 * 
 * Response:
 *   - Array of submission records with trainee info and status
 *   - Pagination metadata
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { paginatedResponse, notFoundResponse, forbiddenResponse, errorResponse } from '@/utils/responses';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { RequirementOcrAnalysis } from '@/types/advisory';

const VALID_STATUSES = ['pending', 'submitted', 'verified', 'rejected', 'waived'] as const;
type SubmissionStatus = (typeof VALID_STATUSES)[number];

const SORT_BY_ALIASES: Record<string, 'name' | 'date'> = {
  name: 'name',
  traineeName: 'name',
  trainee_name: 'name',
  date: 'date',
  submittedAt: 'date',
  submitted_at: 'date',
  verifiedAt: 'date',
  verified_at: 'date',
};

// Validation schema for query parameters
const queryParamsSchema = z.object({
  statuses: z.array(z.enum(VALID_STATUSES)).optional(),
  search: z.string().optional(),
  sort_by: z.enum(['name', 'date']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

type QueryParams = z.infer<typeof queryParamsSchema>;

/**
 * Response type for submission records
 */
interface SubmissionRecord {
  id: string;
  requirement_id: string;
  trainee_id: string;
  enrollment_id: string;
  trainee_name: string;
  trainee_email: string;
  submission_status: SubmissionStatus;
  document_url: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  rejection_reason: string | null;
  ocr_analysis?: RequirementOcrAnalysis | null;
  created_at: string;
  updated_at: string;
}

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  // 1. Extract and validate tenant context
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error;

  const { tenantId } = ctxResult.context;

  // 2. Extract id from URL path
  const { id } = await context.params;

  if (!id) {
    return errorResponse('Requirement ID is required', 400);
  }

  // 3. Verify requirement exists and belongs to current tenant
  const { data: requirement, error: reqError } = await supabaseAdmin
    .from('requirement_definitions')
    .select('id, tenant_id, requirement_type')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (reqError) throw reqError;

  if (!requirement) {
    return notFoundResponse('Requirement definition not found');
  }

  // 4. Parse and validate query parameters
  const { searchParams } = new URL(request.url);
  const rawStatus = searchParams.get('status');
  const parsedStatuses = rawStatus
    ? rawStatus.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const rawSortBy = searchParams.get('sort_by');
  const normalizedSortBy = rawSortBy ? (SORT_BY_ALIASES[rawSortBy] ?? rawSortBy) : undefined;
  const rawOrder = searchParams.get('order') || searchParams.get('sort_order') || undefined;
  const rawSearch = searchParams.get('search')?.trim() || undefined;

  let queryParams: QueryParams;
  try {
    queryParams = queryParamsSchema.parse({
      statuses: parsedStatuses,
      search: rawSearch,
      sort_by: normalizedSortBy,
      order: rawOrder,
      page: searchParams.get('page') || undefined,
      limit: searchParams.get('limit') || undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      const issues = error.issues || (error as any).errors || [];
      issues.forEach((err: any) => {
        const rawField = err.path[0] === 'statuses' ? 'status' : err.path.join('.');
        if (!fieldErrors[rawField]) fieldErrors[rawField] = [];
        fieldErrors[rawField].push(err.message);
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid query parameters',
          errors: fieldErrors,
        },
        { status: 400 }
      );
    }
    throw error;
  }

  // 5. Query enrollment_requirements with joins to get trainee info and enrollment details
  // This joins:
  //   - enrollment_requirements: the submission records
  //   - enrollments: to get enrollment details
  //   - trainee_status_records: to get trainee info (name, email)
  let query = supabaseAdmin
    .from('enrollment_requirements')
    .select(
      `
      id,
      enrollment_id,
      submission_status,
      document_url,
      submitted_at,
      verified_at,
      verified_by,
      rejection_reason,
      created_at,
      updated_at,
      enrollments!inner(
        id
      ),
      trainee_status_records!inner(
        trainee_id,
        trainees!inner(
          id,
          first_name,
          last_name,
          email
        )
      )
      `,
      { count: 'exact' }
    )
    .eq('requirement_id', id)
    .eq('tenant_id', tenantId);

  // Apply single status filter directly on query (multi-status is filtered below)
  if (queryParams.statuses && queryParams.statuses.length === 1) {
    query = query.eq('submission_status', queryParams.statuses[0]);
  }

  query = query.is('deleted_at', null);

  // 6. Execute query
  const { data: submissions, error: submissionError } = await query;

  if (submissionError) throw submissionError;

  if (!submissions || submissions.length === 0) {
    // Return empty paginated response
    return paginatedResponse([], queryParams.page, queryParams.limit, 0);
  }

  // 7. Transform data to response format
  const statusFilterSet =
    queryParams.statuses && queryParams.statuses.length > 0
      ? new Set<SubmissionStatus>(queryParams.statuses)
      : null;
  const searchLower = queryParams.search?.toLowerCase();

  const transformedData: SubmissionRecord[] = submissions
    .map((submission: any) => {
      const trainee = submission.trainee_status_records?.trainees;
      const firstName = trainee?.first_name || '';
      const lastName = trainee?.last_name || '';
      const email = trainee?.email || '';
      const traineeId = trainee?.id || submission.trainee_status_records?.trainee_id || '';

      return {
        id: submission.id || submission.enrollment_id,
        requirement_id: id,
        trainee_id: traineeId,
        enrollment_id: submission.enrollment_id,
        trainee_name: `${firstName} ${lastName}`.trim(),
        trainee_email: email,
        submission_status: submission.submission_status,
        document_url: submission.document_url,
        submitted_at: submission.submitted_at,
        verified_at: submission.verified_at,
        verified_by: submission.verified_by,
        rejection_reason: submission.rejection_reason,
        created_at: submission.created_at,
        updated_at: submission.updated_at || submission.created_at,
      };
    })
    .filter((record) => {
      if (statusFilterSet && !statusFilterSet.has(record.submission_status)) {
        return false;
      }
      if (searchLower) {
        const haystack = `${record.trainee_name} ${record.trainee_email}`.toLowerCase();
        if (!haystack.includes(searchLower)) {
          return false;
        }
      }
      return true;
    });

  // 8. Apply sorting
  const sortedData = [...transformedData];

  if (queryParams.sort_by === 'name') {
    sortedData.sort((a, b) => {
      const comparison = a.trainee_name.localeCompare(b.trainee_name);
      return queryParams.order === 'asc' ? comparison : -comparison;
    });
  } else if (queryParams.sort_by === 'date') {
    sortedData.sort((a, b) => {
      const dateA = new Date(a.submitted_at || a.created_at).getTime();
      const dateB = new Date(b.submitted_at || b.created_at).getTime();
      return queryParams.order === 'asc' ? dateA - dateB : dateB - dateA;
    });
  }

  // 9. Apply pagination
  const total = sortedData.length;
  const startIndex = (queryParams.page - 1) * queryParams.limit;
  const endIndex = startIndex + queryParams.limit;
  const paginatedData = sortedData.slice(startIndex, endIndex);

  // 9b. Enrich current page with advisory OCR metadata from training_requirement_files (non-fatal)
  if (paginatedData.length > 0 && requirement.requirement_type) {
    try {
      const traineeIds = Array.from(
        new Set(paginatedData.map((r) => r.trainee_id).filter(Boolean))
      );
      if (traineeIds.length > 0) {
        const { data: ocrRows, error: ocrErr } = await supabaseAdmin
          .from('training_requirement_files')
          .select('trainee_id, ocr_analysis')
          .eq('tenant_id', tenantId)
          .eq('requirement_type', requirement.requirement_type)
          .in('trainee_id', traineeIds)
          .is('deleted_at', null);

        if (!ocrErr && ocrRows) {
          const ocrByTrainee = new Map<string, RequirementOcrAnalysis | null>();
          for (const row of ocrRows as any[]) {
            if (row?.trainee_id && row?.ocr_analysis) {
              ocrByTrainee.set(row.trainee_id, row.ocr_analysis as RequirementOcrAnalysis);
            }
          }
          for (const item of paginatedData) {
            const analysis = ocrByTrainee.get(item.trainee_id);
            if (analysis) item.ocr_analysis = analysis;
          }
        }
      }
    } catch {
      // Non-fatal: omit ocr_analysis if migration 018 has not been applied yet
    }
  }

  // 10. Return paginated response
  return paginatedResponse(
    paginatedData,
    queryParams.page,
    queryParams.limit,
    total
  );
});
