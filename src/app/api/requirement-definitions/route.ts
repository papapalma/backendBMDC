/**
 * GET /api/requirement-definitions
 * 
 * List all requirement definitions for the authenticated tenant
 * with submission statistics for each requirement.
 * 
 * Requirements: FR1.1, FR2.1
 * Query Parameters:
 *   - sort_by: 'name' (default), 'mandatory', 'completion_rate'
 *   - is_active: 'true', 'false', or empty for all
 *   - page: pagination page number (default 1)
 *   - limit: items per page (default 20, max 100)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { 
  successResponse, 
  paginatedResponse, 
  errorResponse,
  forbiddenResponse,
  validationErrorResponse,
  createdResponse,
} from '@/utils/responses';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { z } from 'zod';
import { calculateSubmissionStats, applySorting } from './submission-stats';

// Validation schema for query parameters
const queryParamsSchema = z.object({
  sort_by: z.enum(['name', 'mandatory', 'completion_rate']).default('name'),
  is_active: z.enum(['true', 'false', '']).default(''),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

type QueryParams = z.infer<typeof queryParamsSchema>;

// Validation schema for POST request body (create requirement definition)
const createRequirementSchema = z.object({
  display_name: z
    .string()
    .min(1, 'Display name is required')
    .max(255, 'Display name must be max 255 characters'),
  description: z
    .string()
    .min(1, 'Description is required')
    .max(5000, 'Description must be max 5000 characters'),
  is_mandatory: z
    .boolean()
    .describe('Whether this requirement is mandatory for all applicable trainees'),
  applicability_rules: z
    .record(z.any())
    .nullable()
    .optional()
    .describe('JSONB rules for conditional requirements (e.g., marital_status)'),
  display_order: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(0)
    .describe('Display order in UI (lower numbers = higher priority)'),
}).strict();

type CreateRequirementInput = z.infer<typeof createRequirementSchema>;

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  // 2. Parse and validate query parameters
  const { searchParams } = new URL(request.url);
  
  // Check if this is a public request (for registration/onboarding)
  const isPublic = searchParams.get('public') === 'true';
  
  let queryParams: QueryParams;
  try {
    queryParams = queryParamsSchema.parse({
      sort_by: searchParams.get('sort_by') || undefined,
      is_active: searchParams.get('is_active') || undefined,
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

  // 1. Extract tenant context (skip for public requests)
  let tenantId: string;
  if (!isPublic) {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error;
    tenantId = ctxResult.context.tenantId;
  } else {
    // For public requests, we still need a tenant_id parameter
    const tenantIdParam = searchParams.get('tenant_id');
    if (!tenantIdParam) {
      return NextResponse.json(
        {
          success: false,
          error: 'tenant_id parameter is required for public requests',
        },
        { status: 400 }
      );
    }
    tenantId = tenantIdParam;
  }

  // 3. Build query for requirement definitions
  let query = supabaseAdmin
    .from('requirement_definitions')
    .select(isPublic ? 'id,display_name,description,is_mandatory,display_order,applicability_rules' : '*', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .is('deleted_at', null);

  // Apply is_active filter if specified
  if (queryParams.is_active !== '') {
    const isActive = queryParams.is_active === 'true';
    query = query.eq('is_active', isActive);
  }

  // Apply ordering
  query = query.order('display_order', { ascending: true });

  // 4. Execute query
  const { data: definitions, error, count } = await query;

  if (error) throw error;

  if (!definitions) {
    return paginatedResponse([], queryParams.page, queryParams.limit, 0);
  }

  // 5. For public requests, skip submission statistics enrichment
  let finalDefinitions = definitions;
  if (!isPublic) {
    // Enrich each requirement with submission statistics
    const enrichedDefinitions = await Promise.all(
      definitions.map(async (def) => {
        const submission_stats = await calculateSubmissionStats(def.id, tenantId);
        return {
          ...def,
          submission_stats,
        };
      })
    );
    finalDefinitions = enrichedDefinitions;
  }

  // 6. Apply sorting
  const sortedDefinitions = applySorting(
    finalDefinitions,
    queryParams.sort_by
  );

  // 7. Apply pagination
  const total = sortedDefinitions.length;
  const startIndex = (queryParams.page - 1) * queryParams.limit;
  const endIndex = startIndex + queryParams.limit;
  const paginatedData = sortedDefinitions.slice(startIndex, endIndex);

  // 8. Return paginated response
  return paginatedResponse(
    paginatedData,
    queryParams.page,
    queryParams.limit,
    total
  );
});

/**
 * POST /api/requirement-definitions
 * 
 * Create a new requirement definition (admin only)
 * 
 * Requirements: FR1.1, FR2.3, NFR4 (Security - role-based access)
 * 
 * Request body:
 *   - display_name (required): Display name for the requirement
 *   - description (required): Description/instructions for trainees
 *   - is_mandatory (required): Whether requirement is mandatory
 *   - applicability_rules (optional): JSONB for conditional requirements
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

  // 3. Build query for requirement definitions
  let query = supabaseAdmin
    .from('requirement_definitions')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .is('deleted_at', null);

  // Apply is_active filter if specified
  if (queryParams.is_active !== '') {
    const isActive = queryParams.is_active === 'true';
    query = query.eq('is_active', isActive);
  }

  // Apply ordering
  query = query.order('display_order', { ascending: true });

  // 4. Execute query
  const { data: definitions, error, count } = await query;

  if (error) throw error;

  if (!definitions) {
    return paginatedResponse([], queryParams.page, queryParams.limit, 0);
  }

  // 5. Enrich each requirement with submission statistics
  const enrichedDefinitions = await Promise.all(
    definitions.map(async (def) => {
      const submission_stats = await calculateSubmissionStats(def.id, tenantId);
      return {
        ...def,
        submission_stats,
      };
    })
  );

  // 6. Apply sorting
  const sortedDefinitions = applySorting(
    enrichedDefinitions,
    queryParams.sort_by
  );

  // 7. Apply pagination
  const total = sortedDefinitions.length;
  const startIndex = (queryParams.page - 1) * queryParams.limit;
  const endIndex = startIndex + queryParams.limit;
  const paginatedData = sortedDefinitions.slice(startIndex, endIndex);

  // 8. Return paginated response
  return paginatedResponse(
    paginatedData,
    queryParams.page,
    queryParams.limit,
    total
  );
});

/**
 * POST /api/requirement-definitions
 * 
 * Create a new requirement definition (admin only)
 * 
 * Requirements: FR1.1, FR2.3, NFR4 (Security - role-based access)
 * 
 * Request body:
 *   - display_name (required): Display name for the requirement
 *   - description (required): Description/instructions for trainees
 *   - is_mandatory (required): Whether requirement is mandatory
 *   - applicability_rules (optional): JSONB for conditional requirements
 *   - display_order (optional): UI sort order
 * 
 * Authorization: Admin role required (local_admin or super_admin)
 * 
 * Returns:
 *   - 201: Created - newly created requirement definition
 *   - 403: Forbidden - user is not admin
 *   - 409: Conflict - duplicate requirement type for tenant
 *   - 422: Unprocessable Entity - validation errors
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  // 1. Extract and validate tenant context
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error;

  const { tenantId, role } = ctxResult.context;

  // 2. Check if user has admin role
  if (role !== 'local_admin' && role !== 'super_admin') {
    return forbiddenResponse('Only admins can create requirement definitions');
  }

  // 3. Parse and validate request body
  let createData: CreateRequirementInput;
  try {
    const body = await request.json();
    createData = createRequirementSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      error.errors.forEach((err) => {
        const field = err.path.join('.');
        if (!fieldErrors[field]) fieldErrors[field] = [];
        fieldErrors[field].push(err.message);
      });
      return validationErrorResponse(fieldErrors);
    }
    throw error;
  }

  // 4. Create the requirement definition
  const { data: newRequirement, error: createError } = await supabaseAdmin
    .from('requirement_definitions')
    .insert([
      {
        tenant_id: tenantId,
        display_name: createData.display_name,
        description: createData.description,
        is_mandatory: createData.is_mandatory,
        is_active: true, // Always start as active
        applicability_rules: createData.applicability_rules || null,
        display_order: createData.display_order || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  if (createError) {
    // Check if this is a duplicate requirement_type error
    if (createError.code === '23505') { // Unique constraint violation
      return errorResponse(
        'A requirement definition with this type already exists for your tenant',
        409
      );
    }
    throw createError;
  }

  // 5. Return 201 Created with newly created requirement
  return createdResponse(
    {
      id: newRequirement.id,
      display_name: newRequirement.display_name,
      description: newRequirement.description,
      is_mandatory: newRequirement.is_mandatory,
      is_active: newRequirement.is_active,
      applicability_rules: newRequirement.applicability_rules,
      display_order: newRequirement.display_order,
    },
    'Requirement definition created successfully'
  );
});

