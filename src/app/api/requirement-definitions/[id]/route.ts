/**
 * GET    /api/requirement-definitions/{id} - Get requirement definition by ID (tenant-scoped)
 * PATCH  /api/requirement-definitions/{id} - Update requirement definition (admin only)
 * DELETE /api/requirement-definitions/{id} - Soft-delete requirement definition (admin only)
 *
 * Requirements: FR1.1, FR2.2, FR2.3
 * Roles: authenticated (GET), admin (PATCH, DELETE)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import {
  successResponse,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  errorResponse,
  serverErrorResponse,
} from '@/utils/responses';
import { calculateSubmissionStats } from '../submission-stats';

// Validation schema for PATCH request body (all fields optional)
const updateRequirementSchema = z.object({
  display_name: z.string().max(255, 'Display name must be max 255 characters').optional(),
  description: z.string().max(5000, 'Description must be max 5000 characters').optional(),
  is_mandatory: z.boolean().optional(),
  is_active: z.boolean().optional(),
  applicability_rules: z.record(z.string(), z.any()).nullable().optional(),
}).strict(); // Reject unknown fields

type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;

  // 1. Extract and validate tenant context
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId } = ctxResult.context;

  // 2. Query requirement definition by id and tenant_id
  const { data: requirement, error: fetchError } = await supabaseAdmin
    .from('requirement_definitions')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single();

  if (fetchError || !requirement) {
    return notFoundResponse('Requirement definition not found');
  }

  // 3. Calculate submission statistics
  const submission_stats = await calculateSubmissionStats(id, tenantId);

  // 4. Return requirement with full details and statistics
  return successResponse({
    id: requirement.id,
    requirement_type: requirement.requirement_type,
    display_name: requirement.display_name,
    description: requirement.description,
    is_mandatory: requirement.is_mandatory,
    is_active: requirement.is_active,
    applicability_rules: requirement.applicability_rules,
    display_order: requirement.display_order,
    created_at: requirement.created_at,
    updated_at: requirement.updated_at,
    submission_stats,
  });
});

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;

  // 1. Extract and validate tenant context
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role } = ctxResult.context;

  // 2. Check if user has admin or training coordinator role
  if (role !== 'admin' && role !== 'local_admin' && role !== 'super_admin' && role !== 'staff_training_coordinator') {
    return forbiddenResponse('Only admins can update requirement definitions');
  }

  // 3. Parse and validate request body
  let updateData: UpdateRequirementInput;
  try {
    const body = await request.json();
    updateData = updateRequirementSchema.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.name === 'SyntaxError')) {
      return errorResponse('Invalid JSON', 400);
    }
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      const issues = error.issues || (error as any).errors || [];
      issues.forEach((err: any) => {
        const field = err.path.join('.');
        if (!fieldErrors[field]) fieldErrors[field] = [];
        fieldErrors[field].push(err.message);
      });
      return new NextResponse(
        JSON.stringify({ success: false, errors: fieldErrors }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw error;
  }

  // 4. Check if requirement exists and belongs to current tenant
  let requirement: any;
  try {
    const res = await supabaseAdmin
      .from('requirement_definitions')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .single();

    if (res.error || !res.data) {
      return notFoundResponse('Requirement definition not found');
    }
    requirement = res.data;
  } catch (error) {
    return notFoundResponse('Requirement definition not found');
  }

  // 5. Prepare update payload (only include provided fields)
  const updatePayload: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (updateData.display_name !== undefined) {
    updatePayload.display_name = updateData.display_name;
  }
  if (updateData.description !== undefined) {
    updatePayload.description = updateData.description;
  }
  if (updateData.is_mandatory !== undefined) {
    updatePayload.is_mandatory = updateData.is_mandatory;
  }
  if (updateData.is_active !== undefined) {
    updatePayload.is_active = updateData.is_active;
  }
  if (updateData.applicability_rules !== undefined) {
    updatePayload.applicability_rules = updateData.applicability_rules;
  }

  // 6. Update the requirement definition
  let updatedRequirement: any;
  try {
    const res = await supabaseAdmin
      .from('requirement_definitions')
      .update(updatePayload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (res.error || !res.data) {
      return serverErrorResponse('Database error updating requirement definition');
    }
    updatedRequirement = res.data;
  } catch (error) {
    return serverErrorResponse('Database error updating requirement definition');
  }

  // 7. Calculate submission stats for the updated requirement
  const submission_stats = await calculateSubmissionStats(id, tenantId);

  // 8. Return updated requirement with stats
  return successResponse({
    id: updatedRequirement.id,
    requirement_type: updatedRequirement.requirement_type,
    display_name: updatedRequirement.display_name,
    description: updatedRequirement.description,
    is_mandatory: updatedRequirement.is_mandatory,
    is_active: updatedRequirement.is_active,
    applicability_rules: updatedRequirement.applicability_rules ?? null,
    display_order: updatedRequirement.display_order ?? 0,
    created_at: updatedRequirement.created_at,
    updated_at: updatedRequirement.updated_at,
    submission_stats,
  });
});

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;

  // 1. Extract and validate tenant context
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role } = ctxResult.context;

  // 2. Check if user has admin or training coordinator role
  if (role !== 'admin' && role !== 'local_admin' && role !== 'super_admin' && role !== 'staff_training_coordinator') {
    return forbiddenResponse('Only admins can delete requirement definitions');
  }

  // 3. Verify requirement exists and belongs to current tenant (not already soft-deleted)
  try {
    const existingRes = await supabaseAdmin
      .from('requirement_definitions')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .single();

    if (existingRes.error || !existingRes.data) {
      return notFoundResponse('Requirement definition not found');
    }
  } catch {
    return notFoundResponse('Requirement definition not found');
  }

  // 4. Perform soft delete (set deleted_at and deactivate)
  const nowIso = new Date().toISOString();
  try {
    const res = await supabaseAdmin
      .from('requirement_definitions')
      .update({
        deleted_at: nowIso,
        is_active: false,
        updated_at: nowIso,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (res.error || !res.data) {
      return serverErrorResponse('Database error deleting requirement definition');
    }

    return successResponse(
      {
        id: res.data.id,
        deleted_at: res.data.deleted_at ?? nowIso,
      },
      'Requirement definition deleted successfully'
    );
  } catch {
    return serverErrorResponse('Database error deleting requirement definition');
  }
});
