import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

const updatePreferencesSchema = z.object({
  preferred_language: z.enum(['en', 'fil']),
});

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  return (
    err.code === '42703' ||
    err.code === 'PGRST204' ||
    Boolean(err.message && err.message.includes('preferred_language'))
  );
}

// OPTIONS /api/auth/me - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);

  if ('error' in authResult) {
    return authResult.error;
  }

  let { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, username, email, role, preferred_language, created_at, updated_at')
    .eq('id', authResult.user.userId)
    .single();

  if (error && isMissingColumnError(error)) {
    const fallback = await supabaseAdmin
      .from('users')
      .select('id, username, email, role, created_at, updated_at')
      .eq('id', authResult.user.userId)
      .single();
    user = fallback.data ? { ...fallback.data, preferred_language: 'en' } : null;
  }

  if (!user) {
    return successResponse({
      id: authResult.user.userId,
      email: authResult.user.email,
      role: authResult.user.role,
      preferred_language: 'en',
    });
  }

  const preferredLanguage = user.preferred_language === 'fil' ? 'fil' : 'en';

  return successResponse({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    preferred_language: preferredLanguage,
    created_at: user.created_at,
    updated_at: user.updated_at,
  });
});

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);

  if ('error' in authResult) {
    return authResult.error;
  }

  const body = await request.json();
  const validated = updatePreferencesSchema.parse(body);

  const { data: updated, error } = await supabaseAdmin
    .from('users')
    .update({ preferred_language: validated.preferred_language })
    .eq('id', authResult.user.userId)
    .select('id, preferred_language')
    .single();

  if (error) {
    if (isMissingColumnError(error)) {
      logger.warn('[auth/me] preferred_language column not yet migrated; acknowledging preference for client cache', {
        userId: authResult.user.userId,
      });
      return successResponse({
        id: authResult.user.userId,
        preferred_language: validated.preferred_language,
        persisted: false,
      });
    }
    throw error;
  }

  return successResponse({
    id: updated?.id ?? authResult.user.userId,
    preferred_language: updated?.preferred_language === 'fil' ? 'fil' : 'en',
    persisted: true,
  });
});
