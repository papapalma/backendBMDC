import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleOptionsRequest, corsResponse } from '@/middleware/cors';
import { requireAuth } from '@/middleware/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { errorResponse, successResponse } from '@/utils/responses';

export function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

const AnnouncementUpdateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255).optional(),
  body: z.string().min(1, 'Description is required').optional(),
  media_url: z.string().nullable().optional(),
  media_type: z.enum(['image', 'video', 'none']).optional(),
  is_published: z.boolean().optional(),
  expires_at: z.string().nullable().optional(),
});

/**
 * GET /api/announcements/[id]
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { data, error } = await supabaseAdmin
      .from('announcements')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return corsResponse(errorResponse('Announcement not found', 404), request);
    }

    return corsResponse(successResponse(data), request);
  } catch (error: any) {
    return corsResponse(errorResponse(error.message || 'Internal server error', 500), request);
  }
}

/**
 * PUT /api/announcements/[id]
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = requireAuth(request);
    if ('error' in authResult) {
      return corsResponse(errorResponse('Unauthorized', 401), request);
    }

    const { id } = await params;
    const body = await request.json();
    const validated = AnnouncementUpdateSchema.parse(body);

    const updateData: any = {
      ...validated,
      updated_at: new Date().toISOString(),
    };

    if (validated.expires_at !== undefined) {
      updateData.expires_at = validated.expires_at ? new Date(validated.expires_at).toISOString() : null;
    }

    const { data, error } = await supabaseAdmin
      .from('announcements')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return corsResponse(errorResponse('Failed to update announcement: ' + error.message, 500), request);
    }

    return corsResponse(successResponse(data, 'Announcement updated successfully'), request);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return corsResponse(errorResponse(error.issues.map(e => e.message).join(', '), 400), request);
    }
    return corsResponse(errorResponse(error.message || 'Internal server error', 500), request);
  }
}

/**
 * DELETE /api/announcements/[id]
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = requireAuth(request);
    if ('error' in authResult) {
      return corsResponse(errorResponse('Unauthorized', 401), request);
    }

    const { id } = await params;
    const { error } = await supabaseAdmin
      .from('announcements')
      .delete()
      .eq('id', id);

    if (error) {
      return corsResponse(errorResponse('Failed to delete announcement: ' + error.message, 500), request);
    }

    return corsResponse(successResponse(null, 'Announcement deleted successfully'), request);
  } catch (error: any) {
    return corsResponse(errorResponse(error.message || 'Internal server error', 500), request);
  }
}
