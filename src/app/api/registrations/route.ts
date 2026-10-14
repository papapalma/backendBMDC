import { NextRequest, NextResponse } from 'next/server';
import { registrationService, ConflictError } from '@/services/registrationService';
import { requireRoleAsync } from '@/middleware/auth';
import { traineeRegistrationSchema } from '@/utils/validators';
import { successResponse, createdResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { requireTenantContext } from '@/middleware/tenantContext';
import { supabaseAdmin } from '@/lib/supabase-admin';

// OPTIONS /api/registrations
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/registrations - List registrations (admin/staff-trainees only)
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator', 'staff_inventory_manager', 'super_admin']);
  if ('error' in authResult) return authResult.error;

  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;
  const { searchParams } = new URL(request.url);

  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  const registrations = await registrationService.getAllRegistrations(context, { status, search });
  return successResponse(registrations);
});

// POST /api/registrations - Submit a new registration (PUBLIC - no auth required)
export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const isExistingTrainee = body.isExistingTrainee === true;
    const enrollmentSource = body.enrollment_source || 'direct'; // NEW: get enrollment source from request

    console.log('[Registration] Received body:', {
      username: body.username,
      email: body.email,
      password: body.password ? '***' : 'empty',
      program_id: body.program_id,
      tenant_id: body.tenant_id,
      enrollment_source: enrollmentSource, // NEW: log the source
      first_name: body.first_name,
      last_name: body.last_name,
      phone: body.phone,
      sex: body.sex,
      birth_date: body.birth_date,
      birth_place: body.birth_place,
      civil_status: body.civil_status,
      province: body.province,
      municipality: body.municipality,
      barangay: body.barangay,
      street: body.street,
      educational_attainment: body.educational_attainment,
      course: body.course,
      year_graduated: body.year_graduated,
      classification: body.classification,
      disability: body.disability,
      employment_status: body.employment_status,
    });

    // For existing trainees applying to a new program, they don't need to provide a password
    // since they already have an account. Use a placeholder for schema validation.
    if (isExistingTrainee && (!body.password || body.password === '')) {
      console.log('[Registration] Existing trainee - substituting placeholder password for validation');
      body.password = 'ExistingTraineePlaceholder123'; // Meets regex requirement
    }

    let validatedData;
    try {
      validatedData = traineeRegistrationSchema.parse(body);
      console.log('[Registration] Validation passed');
    } catch (validationError: any) {
      console.error('[Registration] Schema validation failed:', {
        errors: validationError.errors?.map((e: any) => ({
          path: e.path.join('.'),
          message: e.message,
          code: e.code,
          received: e.received,
          expected: e.expected,
        })),
      });
      throw validationError;
    }

    // Validate and get tenant_id
    let tenantId = body.tenant_id;
    
    // Requirement 4.2: tenant_id must be present in request body
    if (!tenantId) {
      console.error('[Registration] Tenant selection validation failed: tenant_id is missing');
      return Response.json(
        { error: 'Tenant selection is required.' },
        { status: 400 }
      );
    }

    // Requirement 4.3: Verify tenant exists and has status = 'active'
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('id, status')
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenant) {
      console.error('[Registration] Tenant validation failed:', {
        tenant_id: tenantId,
        error: tenantError?.message,
      });
      return Response.json(
        { error: 'Tenant selection is required.' },
        { status: 400 }
      );
    }

    if (tenant.status !== 'active') {
      console.error('[Registration] Tenant is not active:', {
        tenant_id: tenantId,
        status: tenant.status,
      });
      return Response.json(
        { error: 'Tenant selection is required.' },
        { status: 400 }
      );
    }

    const registration = await registrationService.submitRegistration(
      validatedData,
      tenantId,
      isExistingTrainee, // Pass the flag if it exists in the request
      enrollmentSource // NEW: pass enrollment source
    );

    // Omit password_hash from response

const { ...safeReg } = registration as any;
    delete safeReg.password_hash;
    return createdResponse(
      safeReg,
      'Registration submitted successfully. Please wait for admin approval before logging in.'
    );
  } catch (error: any) {
    // Handle ConflictError (409) - incomplete enrollment

if (error instanceof ConflictError) {
      console.warn('[Registration] Conflict: Trainee with incomplete enrollment blocked', {
        message: error.message,
        timestamp: new Date().toISOString(),
      });
      return Response.json(
        { error: error.message },
        { status: 409 }
      );
    }

    // Handle validation errors from Zod

if (error.name === 'ZodError') {
      const validationErrors = error.errors.map((e: any) => ({
        field: e.path.join('.') || 'root',
        message: e.message,
        code: e.code,
        received: e.received,
      }));
      console.error('[Registration] Validation error details:', validationErrors);
      return Response.json(
        { error: 'Validation failed', details: validationErrors },
        { status: 422 }
      );
    }

    // Re-throw other errors for withErrorHandler to catch
    throw error;
  }
});
