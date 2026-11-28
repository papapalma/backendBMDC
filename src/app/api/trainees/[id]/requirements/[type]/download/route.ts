import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { requireTenantContext } from '@/middleware/tenantContext';
import { handleOptionsRequest, addCorsHeaders, corsResponse } from '@/middleware/cors';
import { logger } from '@/utils/logger';
import { getSecureFilePath, getSecureFilePathById } from '@/services/trainingRequirementService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { promises as fs } from 'fs';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> }
) {
  try {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return corsResponse(ctxResult.error as NextResponse, request);
    const context = ctxResult.context!;

    const { id: traineeId, type: requirementType } = await params;
    const fileId = new URL(request.url).searchParams.get('file_id');

    logger.info('[DOWNLOAD] Request received', {
      traineeId,
      requirementType,
      tenantId: context.tenantId,
      userId: context.userId
    });

    if (!requirementType) {
      logger.warn('[DOWNLOAD] Invalid requirement type', { requirementType });
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

    const effectiveTenantId = trainee.tenant_id;

    const filePath = fileId
      ? await getSecureFilePathById(effectiveTenantId, traineeId, fileId)
      : await getSecureFilePath(effectiveTenantId, traineeId, requirementType as any);
    if (!filePath) {
      logger.warn('[DOWNLOAD] File not found', {
        traineeId,
        requirementType,
        tenantId: effectiveTenantId
      });
      return corsResponse(
        { error: fileId ? 'This submitted file is no longer available on the server' : 'File not found' },
        request,
        { status: fileId ? 410 : 404 }
      );
    }

    const fileBuffer = await fs.readFile(filePath);
    const fileName = path.basename(filePath) || 'document';
    const contentType = MIME_TYPES[path.extname(fileName).toLowerCase()] || 'application/octet-stream';

    logger.info('Requirement file downloaded', { traineeId, requirementType, userId: context.userId });

    return addCorsHeaders(
      new NextResponse(fileBuffer, {
        headers: {
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Type': contentType,
        },
      }),
      request.headers.get('origin')
    );
  } catch (error: any) {
    logger.error('Failed to download requirement file', { error: error?.message, stack: error?.stack });
    return corsResponse({ error: 'Failed to download file' }, request, { status: 500 });
  }
}