import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleOptionsRequest, corsResponse } from '@/middleware/cors';
import { requireAuth } from '@/middleware/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { errorResponse, successResponse } from '@/utils/responses';

export function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

const AnnouncementCreateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  body: z.string().min(1, 'Description is required'),
  media_url: z.string().nullable().optional(),
  media_type: z.enum(['image', 'video', 'none']).default('none'),
  is_published: z.boolean().default(true),
  expires_at: z.string().nullable().optional(),
});

/**
 * GET /api/announcements
 * Fetch announcements. Public requests receive active, published announcements.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const isPublic = searchParams.get('public') === 'true' || !request.headers.get('Authorization');
    const tenantId = searchParams.get('tenantId');

    let query = supabaseAdmin
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    if (isPublic) {
      const now = new Date().toISOString();
      query = query
        .eq('is_published', true)
        .or(`expires_at.is.null,expires_at.gt.${now}`);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to query announcements', { error });
      return corsResponse(successResponse([]), request);
    }

    return corsResponse(successResponse(data || []), request);
  } catch (error: any) {
    logger.error('Error fetching announcements', { error });
    return corsResponse(errorResponse(error.message || 'Failed to fetch announcements', 500), request);
  }
}

/**
 * POST /api/announcements
 * Create a new announcement (admin/staff only)
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = requireAuth(request);
    if ('error' in authResult) {
      return corsResponse(errorResponse('Unauthorized', 401), request);
    }

    const body = await request.json();
    const validated = AnnouncementCreateSchema.parse(body);

    const newRecord = {
      title: validated.title,
      body: validated.body,
      media_url: validated.media_url || null,
      media_type: validated.media_type || 'none',
      is_published: validated.is_published,
      expires_at: validated.expires_at ? new Date(validated.expires_at).toISOString() : null,
      tenant_id: authResult.user.tenantId || null,
      created_by: authResult.user.userId || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('announcements')
      .insert(newRecord)
      .select()
      .single();

    if (error) {
      logger.error('Failed to create announcement', { error });
      return corsResponse(errorResponse('Failed to create announcement: ' + error.message, 500), request);
    }

    return corsResponse(successResponse(data, 'Announcement created successfully', 201), request);
  } catch (error: any) {
    logger.error('Error creating announcement', { error });
    if (error instanceof z.ZodError) {
      return corsResponse(errorResponse(error.issues.map(e => e.message).join(', '), 400), request);
    }
    return corsResponse(errorResponse(error.message || 'Internal server error', 500), request);
  }
}
