import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { logger } from '@/utils/logger';
import { getSecureFilePath, REQUIREMENT_TYPES } from '@/services/trainingRequirementService';
import { promises as fs } from 'fs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> }
) {
  try {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;
    const context = ctxResult.context!;

    const { id: traineeId, type: requirementType } = await params;

    logger.info('[DOWNLOAD] Request received', { 
      traineeId, 
      requirementType, 
      tenantId: context.tenantId,
      userId: context.userId 
    });

    if (!requirementType || !REQUIREMENT_TYPES.includes(requirementType as any)) {
      logger.warn('[DOWNLOAD] Invalid requirement type', { requirementType });
      return NextResponse.json({ error: 'Invalid requirement type' }, { status: 400 });
    }

    const filePath = await getSecureFilePath(context.tenantId, traineeId, requirementType as any);
    if (!filePath) {
      logger.warn('[DOWNLOAD] File not found', { 
        traineeId, 
        requirementType, 
        tenantId: context.tenantId 
      });
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileBuffer = await fs.readFile(filePath);
    const fileName = filePath.split('/').pop() || 'document';

    logger.info('Requirement file downloaded', { traineeId, requirementType, userId: context.userId });

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Type': 'application/octet-stream',
      },
    });
  } catch (error: any) {
    logger.error('Failed to download requirement file', { error: error?.message, stack: error?.stack });
    return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });
  }
}