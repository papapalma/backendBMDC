/**
 * GET /api/requirements/analytics
 * 
 * Admin-only endpoint that returns completion rate, rejection count, and other
 * analytics aggregated by requirement.
 * 
 * Requirements: FR5.1, NFR4 (Security - role-based access)
 * 
 * Authorization: Admin role required (local_admin or super_admin)
 * 
 * Response Format:
 *   - by_requirement: Array of per-requirement analytics
 *   - summary: Top-level statistics across all requirements
 * 
 * Returns:
 *   - 200: Success with analytics data
 *   - 403: Forbidden - user is not admin
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { 
  successResponse, 
  forbiddenResponse,
} from '@/utils/responses';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Represents analytics for a single requirement
 */
export interface RequirementAnalytics {
  requirement_id: string;
  requirement_type: string;
  display_name: string;
  is_mandatory: boolean;
  completion_rate: number; // 0-100, percentage
  rejection_count: number; // Total rejected submissions
  rejection_rate: number; // 0-100, percentage
  avg_time_to_completion_days: number | null; // Average days from assignment to verification
  total_submissions: number; // Total applicable requirements assigned
  verified_count: number; // Successfully verified
  rejected_count: number; // Rejected submissions
  pending_count: number; // Pending submissions
  submitted_count: number; // Submitted awaiting verification
  waived_count: number; // Waived requirements
}

/**
 * Summary statistics across all requirements
 */
export interface RequirementAnalyticsSummary {
  avg_completion_rate: number; // Average completion rate across all requirements
  avg_rejection_rate: number; // Average rejection rate across all requirements
  total_requirements: number; // Total requirement definitions
  total_submissions: number; // Total submissions across all requirements
  total_verified: number; // Total verified submissions
  total_rejected: number; // Total rejected submissions
  total_pending: number; // Total pending submissions
  total_submitted: number; // Total submitted awaiting verification
  total_waived: number; // Total waived submissions
}

/**
 * Analytics response structure
 */
export interface AnalyticsResponse {
  by_requirement: RequirementAnalytics[];
  summary: RequirementAnalyticsSummary;
}

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  // 1. Extract and validate tenant context
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error;

  const { tenantId, role } = ctxResult.context;

  // 2. Check if user has admin role
  if (role !== 'local_admin' && role !== 'super_admin') {
    return forbiddenResponse('Only admins can access analytics endpoints');
  }

  // 3. Fetch all requirement definitions for the tenant
  const { data: requirements, error: reqError } = await supabaseAdmin
    .from('requirement_definitions')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('display_order', { ascending: true });

  if (reqError) throw reqError;

  if (!requirements || requirements.length === 0) {
    // Return empty analytics response
    const emptyResponse: AnalyticsResponse = {
      by_requirement: [],
      summary: {
        avg_completion_rate: 0,
        avg_rejection_rate: 0,
        total_requirements: 0,
        total_submissions: 0,
        total_verified: 0,
        total_rejected: 0,
        total_pending: 0,
        total_submitted: 0,
        total_waived: 0,
      },
    };

    return successResponse(emptyResponse);
  }

  // 4. For each requirement, fetch submission statistics
  const byRequirement: RequirementAnalytics[] = [];
  let aggregatedStats = {
    total_submissions: 0,
    total_verified: 0,
    total_rejected: 0,
    total_pending: 0,
    total_submitted: 0,
    total_waived: 0,
    total_completion_rate: 0,
    total_rejection_rate: 0,
  };

  for (const requirement of requirements) {
    // Query enrollment_requirements to get submission stats for this requirement
    const { data: submissions, error: submissionError } = await supabaseAdmin
      .from('enrollment_requirements')
      .select(
        `
        id,
        submission_status,
        submitted_at,
        verified_at,
        created_at
        `,
        { count: 'exact' }
      )
      .eq('requirement_id', requirement.id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .eq('is_applicable', true); // Only count applicable requirements

    if (submissionError) throw submissionError;

    // Calculate statistics for this requirement
    const stats = {
      verified_count: 0,
      rejected_count: 0,
      pending_count: 0,
      submitted_count: 0,
      waived_count: 0,
      total_submissions: submissions?.length || 0,
      completion_rate: 0,
      rejection_rate: 0,
      avg_time_to_completion_days: null as number | null,
    };

    let totalCompletionTime = 0;
    let completedCount = 0;

    if (submissions && submissions.length > 0) {
      submissions.forEach((submission: any) => {
        switch (submission.submission_status) {
          case 'verified':
            stats.verified_count++;
            completedCount++;
            // Calculate time to completion
            if (submission.created_at && submission.verified_at) {
              const createdDate = new Date(submission.created_at);
              const verifiedDate = new Date(submission.verified_at);
              const days = (verifiedDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
              totalCompletionTime += days;
            }
            break;
          case 'rejected':
            stats.rejected_count++;
            break;
          case 'pending':
            stats.pending_count++;
            break;
          case 'submitted':
            stats.submitted_count++;
            break;
          case 'waived':
            stats.waived_count++;
            completedCount++;
            break;
        }
      });

      // Calculate rates
      stats.completion_rate = stats.total_submissions > 0
        ? Math.round((((stats.verified_count + stats.waived_count) / stats.total_submissions) * 100) * 100) / 100
        : 0;

      stats.rejection_rate = stats.total_submissions > 0
        ? Math.round((stats.rejected_count / stats.total_submissions) * 100 * 100) / 100
        : 0;

      // Calculate average time to completion
      if (completedCount > 0) {
        stats.avg_time_to_completion_days = Math.round((totalCompletionTime / completedCount) * 100) / 100;
      }
    }

    // Build requirement analytics object
    const requirementAnalytics: RequirementAnalytics = {
      requirement_id: requirement.id,
      requirement_type: requirement.requirement_type,
      display_name: requirement.display_name,
      is_mandatory: requirement.is_mandatory,
      completion_rate: stats.completion_rate,
      rejection_count: stats.rejected_count,
      rejection_rate: stats.rejection_rate,
      avg_time_to_completion_days: stats.avg_time_to_completion_days,
      total_submissions: stats.total_submissions,
      verified_count: stats.verified_count,
      rejected_count: stats.rejected_count,
      pending_count: stats.pending_count,
      submitted_count: stats.submitted_count,
      waived_count: stats.waived_count,
    };

    byRequirement.push(requirementAnalytics);

    // Update aggregated statistics
    aggregatedStats.total_submissions += stats.total_submissions;
    aggregatedStats.total_verified += stats.verified_count;
    aggregatedStats.total_rejected += stats.rejected_count;
    aggregatedStats.total_pending += stats.pending_count;
    aggregatedStats.total_submitted += stats.submitted_count;
    aggregatedStats.total_waived += stats.waived_count;
    aggregatedStats.total_completion_rate += stats.completion_rate;
    aggregatedStats.total_rejection_rate += stats.rejection_rate;
  }

  // 5. Calculate summary statistics
  const requirementCount = requirements.length;
  const summary: RequirementAnalyticsSummary = {
    avg_completion_rate: requirementCount > 0
      ? Math.round((aggregatedStats.total_completion_rate / requirementCount) * 100) / 100
      : 0,
    avg_rejection_rate: requirementCount > 0
      ? Math.round((aggregatedStats.total_rejection_rate / requirementCount) * 100) / 100
      : 0,
    total_requirements: requirementCount,
    total_submissions: aggregatedStats.total_submissions,
    total_verified: aggregatedStats.total_verified,
    total_rejected: aggregatedStats.total_rejected,
    total_pending: aggregatedStats.total_pending,
    total_submitted: aggregatedStats.total_submitted,
    total_waived: aggregatedStats.total_waived,
  };

  // 6. Return analytics response
  const response: AnalyticsResponse = {
    by_requirement: byRequirement,
    summary,
  };

  return successResponse(response);
});
