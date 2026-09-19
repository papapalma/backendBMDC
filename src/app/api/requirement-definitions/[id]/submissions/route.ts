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

// Validation schema for query parameters
const queryParamsSchema = z.object({
  status: z
    .enum(['pending', 'submitted', 'verified', 'rejected', 'waived'])
    .optional(),
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
  enrollment_id: string;
  trainee_name: string;
  trainee_email: string;
  submission_status: 'pending' | 'submitted' | 'verified' | 'rejected' | 'waived';
  document_url: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  rejection_reason: string | null;
  created_at: string;
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
    .select('id, tenant_id')
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

  let queryParams: QueryParams;
  try {
    queryParams = queryParamsSchema.parse({
      status: searchParams.get('status') || undefined,
      sort_by: searchParams.get('sort_by') || undefined,
      order: searchParams.get('order') || undefined,
      page: searchParams.get('page') || undefined,
      limit: searchParams.get('limit') || undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      error.errors.forEach((err) => {
        const field = err.path.join('.');
        if (!fieldErrors[field]) fieldErrors[field] = [];
        fieldErrors[field].push(err.message);
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
    .eq('tenant_id', tenantId)
    .is('deleted_at', null);

  // Apply status filter if provided
  if (queryParams.status) {
    query = query.eq('submission_status', queryParams.status);
  }

  // 6. Execute query
  const { data: submissions, error: submissionError, count } = await query;

  if (submissionError) throw submissionError;

  if (!submissions || submissions.length === 0) {
    // Return empty paginated response
    return paginatedResponse([], queryParams.page, queryParams.limit, 0);
  }

  // 7. Transform data to response format
  const transformedData: SubmissionRecord[] = submissions.map((submission: any) => {
    const trainee = submission.trainee_status_records?.trainees;
    const firstName = trainee?.first_name || '';
    const lastName = trainee?.last_name || '';
    const email = trainee?.email || '';

    return {
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
    };
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

  // 10. Return paginated response
  return paginatedResponse(
    paginatedData,
    queryParams.page,
    queryParams.limit,
    total
  );
});
