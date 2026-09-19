import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { logger } from '@/utils/logger';
import { uploadRequirementFile, getTraineeRequirementFiles, REQUIREMENT_TYPES } from '@/services/trainingRequirementService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { successResponse } from '@/utils/responses';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;
    const context = ctxResult.context!;

    const { id: traineeId } = await params;
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const requirementType = formData.get('requirement_type') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

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

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadedFile = await uploadRequirementFile({
      tenantId: context.tenantId,
      traineeId,
      requirementType: requirementType as any,
      file: buffer,
      fileName: file.name,
      mimeType: file.type || undefined,
      userId: context.userId,
    });

    logger.info('Requirement file uploaded', { traineeId, requirementType, userId: context.userId });
    return NextResponse.json({ success: true, data: uploadedFile });
  } catch (error: any) {
    logger.error('Failed to upload requirement file', { error: error?.message });
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;
    const context = ctxResult.context!;

    const { id: traineeId } = await params;
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

    const files = await getTraineeRequirementFiles(context.tenantId, traineeId);
    logger.info('Requirement files retrieved', { traineeId, fileCount: files.length, userId: context.userId });
    return NextResponse.json({ success: true, files });
  } catch (error: any) {
    logger.error('Failed to retrieve requirement files', { error: error?.message });
    return NextResponse.json({ error: 'Failed to retrieve files' }, { status: 500 });
  }
}