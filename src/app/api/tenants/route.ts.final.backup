import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/tenants - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * GET /api/tenants
 * Public endpoint — returns list of all active tenants
 * Used by landing page to show tenant selector
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { data: tenants, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name, status')
    .eq('status', 'active')
    .order('name', { ascending: true });

  if (error) throw error;

  // Return just id and name for public display
  const publicTenants = (tenants || []).map(t => ({
    id: t.id,
    name: t.name,
  }));

  return successResponse(publicTenants);
});
