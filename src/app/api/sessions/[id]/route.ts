import { NextRequest, NextResponse } from 'next/server';
import { sessionService } from '@/services/sessionService';
import { requireRoleAsync } from '@/middleware/auth';
import { successResponse, notFoundResponse, noContentResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';
import { z } from 'zod';

const updateSessionSchema = z.object({ title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  location: z.string().max(255).optional(),
  session_type: z.enum(['lecture', 'lab', 'workshop', 'exam', 'seminar', 'field_trip']).optional(),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'postponed']).optional(), });

// OPTIONS /api/sessions/:id

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/sessions/:id

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator']);
    if ('error' in authResult) return authResult.error as NextResponse;

    const { id } = await params;
    const session = await sessionService.getSessionById(id);

    if (!session) { return notFoundResponse('Session not found'); }

    return successResponse(session); }
);

// PUT /api/sessions/:id

export const PUT = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const authResult = await requireRoleAsync(request, ['local_admin', 'staff_training_coordinator']);
    if ('error' in authResult) return authResult.error as NextResponse;

    const body = await request.json();
    const validatedData = updateSessionSchema.parse(body);

    const session = await sessionService.updateSession(id, validatedData);

    await activityLogService.logAction(
      authResult.user.userId,
      'update',
      'session',
      id,
      validatedData
    );

    return successResponse(session, 'Session updated successfully'); }
);

// DELETE /api/sessions/:id

export const DELETE = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const authResult = await requireRoleAsync(request, ['local_admin']);
    if ('error' in authResult) return authResult.error as NextResponse;

    await sessionService.deleteSession(id);

    await activityLogService.logAction(
      authResult.user.userId,
      'delete',
      'session',
      id
    );

    return noContentResponse(); }
);
