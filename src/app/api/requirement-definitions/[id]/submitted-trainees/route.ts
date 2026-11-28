import { NextRequest } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { notFoundResponse, paginatedResponse } from '@/utils/responses';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { chunkIds, fetchAllRows } from '@/lib/supabasePagination';

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

type TraineeRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error;

  const { tenantId } = ctxResult.context;
  const { id: requirementId } = await context.params;
  const { searchParams } = new URL(request.url);
  const page = Math.max(Number(searchParams.get('page') || 1), 1);
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || 20), 1), 100);
  const search = (searchParams.get('search') || '').trim().toLowerCase();

  const { data: requirement, error: requirementError } = await supabaseAdmin
    .from('requirement_definitions')
    .select('id,requirement_type')
    .eq('id', requirementId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (requirementError) throw requirementError;
  if (!requirement) return notFoundResponse('Requirement definition not found');

  let files: any[] = [];
  try {
    files = await fetchAllRows<any>(() =>
      supabaseAdmin
        .from('training_requirement_files')
        .select('id,trainee_id,file_path,file_name,file_size_bytes,uploaded_at,requirement_type,ocr_analysis')
        .eq('tenant_id', tenantId)
        .eq('requirement_type', requirement.requirement_type)
        .is('deleted_at', null)
        .order('uploaded_at', { ascending: false })
    );
  } catch (err: any) {
    if (!/ocr_analysis/i.test(err?.message || '')) throw err;
    files = await fetchAllRows<any>(() =>
      supabaseAdmin
        .from('training_requirement_files')
        .select('id,trainee_id,file_path,file_name,file_size_bytes,uploaded_at,requirement_type')
        .eq('tenant_id', tenantId)
        .eq('requirement_type', requirement.requirement_type)
        .is('deleted_at', null)
        .order('uploaded_at', { ascending: false })
    );
  }

  const traineeIds = [...new Set(files.map((file) => file.trainee_id).filter(Boolean))];
  const traineeBatches = await Promise.all(
    chunkIds(traineeIds, 150).map(async (idChunk) => {
      const { data, error } = await supabaseAdmin
        .from('trainees')
        .select('id,first_name,last_name,email')
        .eq('tenant_id', tenantId)
        .in('id', idChunk);
      if (error) throw error;
      return (data || []) as TraineeRow[];
    })
  );
  const trainees = traineeBatches.flat();

  const traineeById = new Map(
    (trainees || []).map((trainee: TraineeRow) => [trainee.id, trainee] as const)
  );
  const records = (files || [])
    .map((file) => {
      const trainee = traineeById.get(file.trainee_id) as TraineeRow | undefined;
      return {
        id: file.id,
        trainee_id: file.trainee_id,
        trainee_name: trainee
          ? `${trainee.first_name || ''} ${trainee.last_name || ''}`.trim()
          : 'Unknown trainee',
        trainee_email: trainee?.email || '',
        requirement_type: file.requirement_type,
        file_path: file.file_path,
        file_name: file.file_name,
        file_size_bytes: file.file_size_bytes,
        uploaded_at: file.uploaded_at,
        ocr_analysis: file.ocr_analysis ?? null,
      };
    })
    .filter((record) => {
      if (!search) return true;
      return `${record.trainee_name} ${record.trainee_email}`.toLowerCase().includes(search);
    });

  const start = (page - 1) * limit;
  return paginatedResponse(records.slice(start, start + limit), page, limit, records.length);
});
