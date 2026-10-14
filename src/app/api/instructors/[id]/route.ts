import { NextRequest, NextResponse } from 'next/server';
import { instructorService } from '@/services/instructorService';
import { requireRoleAsync } from '@/middleware/auth';
import { successResponse, notFoundResponse, noContentResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';
import { z } from 'zod';

const updateInstructorSchema = z.object({ first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  middle_name: z.string().max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  specialization: z.string().max(255).optional(),
  bio: z.string().optional(),
  photo_path: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(), });

// OPTIONS /api/instructors/:id

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/instructors/:id

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const instructor = await instructorService.getInstructorById(id);

    if (!instructor) { return notFoundResponse('Instructor not found'); }

    return successResponse(instructor); }
);

// PUT /api/instructors/:id

export const PUT = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator']);
    if ('error' in authResult) return authResult.error as NextResponse;

    const body = await request.json();
    const validatedData = updateInstructorSchema.parse(body);

    const instructor = await instructorService.updateInstructor(id, validatedData);

    await activityLogService.logAction(
      authResult.user.userId,
      'update',
      'instructor',
      id,
      validatedData
    );

    return successResponse(instructor, 'Instructor updated successfully'); }
);

// DELETE /api/instructors/:id

export const DELETE = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const authResult = await requireRoleAsync(request, ['local_admin', 'super_admin']);
    if ('error' in authResult) return authResult.error as NextResponse;

    await instructorService.deleteInstructor(id);

    await activityLogService.logAction(
      authResult.user.userId,
      'delete',
      'instructor',
      id
    );

    return noContentResponse(); }
);
