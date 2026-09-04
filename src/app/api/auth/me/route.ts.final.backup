import { NextRequest } from 'next/server';
import { requireAuthAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';

// OPTIONS /api/auth/me - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);
  
  if ('error' in authResult) {
    return authResult.error;
  }
  
  // Look up the full user record to return id + username
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, username, email, role, created_at, updated_at')
    .eq('id', authResult.user.userId)
    .single();

  if (!user) {
    return successResponse({
      id: authResult.user.userId,
      email: authResult.user.email,
      role: authResult.user.role,
    });
  }

  return successResponse({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
    updated_at: user.updated_at,
  });
});
