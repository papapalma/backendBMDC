import { NextRequest, NextResponse } from 'next/server';
import { instructorService } from '@/services/instructorService';
import { requireAuthAsync, requireRoleAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';
import { z } from 'zod';

// Validation schema
const createInstructorSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  middle_name: z.string().max(100).optional(),
  email: z.string().email('Invalid email address'),
  phone: z.string().max(20).optional(),
  specialization: z.string().max(255).optional(),
  bio: z.string().optional(),
  photo_path: z.string().optional(),
});

const updateInstructorSchema = createInstructorSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

// OPTIONS /api/instructors

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/instructors - Get all instructors

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);
  if ('error' in authResult) return authResult.error as NextResponse;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  const instructors = await instructorService.getAllInstructors({ status, search });

  return successResponse(instructors);
});

// POST /api/instructors - Create new instructor

export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const body = await request.json();
  const validatedData = createInstructorSchema.parse(body);

  const instructor = await instructorService.createInstructor(validatedData);

  await activityLogService.logAction(
    authResult.user.userId,
    'create',
    'instructor',
    instructor.id,
    validatedData
  );

  return successResponse(instructor, 'Instructor created successfully', 201);
});
