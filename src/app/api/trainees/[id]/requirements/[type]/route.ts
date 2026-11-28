import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { handleOptionsRequest, corsResponse } from '@/middleware/cors';
import { logger } from '@/utils/logger';
import { deleteRequirementFile } from '@/services/trainingRequirementService';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> }
) {
  try {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return corsResponse(ctxResult.error as NextResponse, request);
    const context = ctxResult.context!;

    const { id: traineeId, type: requirementType } = await params;

    if (!requirementType) {
      return corsResponse({ error: 'Invalid requirement type' }, request, { status: 400 });
    }

    const { data: trainee, error: traineeError } = await supabaseAdmin
      .from('trainees')
      .select('id, tenant_id')
      .eq('id', traineeId)
      .single();

    if (traineeError || !trainee) {
      return corsResponse({ error: 'Trainee not found' }, request, { status: 404 });
    }

    if (trainee.tenant_id !== context.tenantId && !context.isSuperAdmin) {
      return corsResponse({ error: 'Unauthorized' }, request, { status: 403 });
    }

    await deleteRequirementFile(trainee.tenant_id, traineeId, requirementType as any);
    logger.info('Requirement file deleted', { traineeId, requirementType, userId: context.userId });
    return corsResponse({ success: true }, request);
  } catch (error: any) {
    logger.error('Failed to delete requirement file', { error: error?.message });
    return corsResponse({ error: 'Failed to delete file' }, request, { status: 500 });
  }
}