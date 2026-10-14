import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAsync } from '@/middleware/auth';
import { successResponse, notFoundResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { programService } from '@/services/programService';

// OPTIONS /api/programs/:id/trainees - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

/**
 * GET /api/programs/:id/trainees
 * Get all trainees enrolled in a program.
 * Requires authentication — staff and admin can view any program's trainees.
 */
export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const authResult = await requireAuthAsync(request);
  if ('error' in authResult) return authResult.error as NextResponse;

  const { id } = await params;

  // Verify the program exists

const program = await programService.getProgramById(id);
  if (!program) return notFoundResponse('Program not found');

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;

  let query = supabaseAdmin
  .from('trainees')
  .select('id, first_name, last_name, middle_name, email, phone, status, enrollment_date, created_at, updated_at')
  .eq('program_id', id)
  .order('last_name', { ascending: true });

  if (status) { query = query.eq('status', status); }

if (search) { query = query.or(
  `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`
  ); }

const { data: trainees, error } = await query;
  if (error) throw error;

  return successResponse(trainees || []); }
);
