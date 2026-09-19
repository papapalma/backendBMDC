import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { logger } from '@/utils/logger';
import { deleteRequirementFile, REQUIREMENT_TYPES } from '@/services/trainingRequirementService';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> }
) {
  try {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;
    const context = ctxResult.context!;

    const { id: traineeId, type: requirementType } = await params;

    if (!requirementType || !REQUIREMENT_TYPES.includes(requirementType as any)) {
      return NextResponse.json({ error: 'Invalid requirement type' }, { status: 400 });
    }

    const { data: trainee, error: traineeError } = await supabaseAdmin
      .from('trainees')
      .select('id, tenant_id')
      .eq('id', traineeId)
      .single();

    if (traineeError || !trainee) {
      return NextResponse.json({ error: 'Trainee not found' }, { status: 404 });
    }

    if (trainee.tenant_id !== context.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    await deleteRequirementFile(context.tenantId, traineeId, requirementType as any);
    logger.info('Requirement file deleted', { traineeId, requirementType, userId: context.userId });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to delete requirement file', { error: error?.message });
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
  }
}