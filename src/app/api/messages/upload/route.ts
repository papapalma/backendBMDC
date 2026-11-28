import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { handleOptionsRequest, corsResponse } from '@/middleware/cors';
import { requireAuthAsync } from '@/middleware/auth';
import { MessengerService, MessengerError, resolveTenantId } from '@/services/messengerService';
import { logger } from '@/utils/logger';
import { errorResponse, successResponse } from '@/utils/responses';
import { UPLOAD_BASE_DIR, UPLOAD_URL_PREFIX } from '@/lib/fileStorage';

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt']);
const ALLOWED_EXTENSIONS = new Set([...ALLOWED_IMAGE_EXTENSIONS, ...ALLOWED_DOCUMENT_EXTENSIONS]);

export function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * POST /api/messages/upload
 * Upload image or document attachment for messenger
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthAsync(request);
    if ('error' in auth) {
      return corsResponse(auth.error, request);
    }

    const { userId, tenantId } = auth.user;
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const conversationId = formData.get('conversationId');

    if (!file) {
      return corsResponse(errorResponse('No file provided', 400), request);
    }

    // Size limit: 15MB
    const maxSizeBytes = 15 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return corsResponse(errorResponse('File exceeds 15MB size limit', 400), request);
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      return corsResponse(
        errorResponse(
          'Unsupported file type. Allowed formats: JPG, PNG, GIF, WEBP, PDF, DOC, DOCX, XLS, XLSX, TXT',
          400
        ),
        request
      );
    }

    // Resolve a valid UUID tenant directory (handles super_admin 'platform' tenantId)
    let storageTenantId: string;
    if (typeof conversationId === 'string' && conversationId.trim()) {
      storageTenantId = await MessengerService.getAuthorizedConversationTenantId(
        conversationId.trim(),
        userId
      );
    } else {
      storageTenantId = resolveTenantId(tenantId);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const isImage = ALLOWED_IMAGE_EXTENSIONS.has(ext) && file.type.startsWith('image/');
    const safeType: 'image' | 'file' = isImage ? 'image' : 'file';

    const tenantUploadDir = path.join(UPLOAD_BASE_DIR, storageTenantId, 'messenger');
    await fs.mkdir(tenantUploadDir, { recursive: true });

    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const filePath = path.join(tenantUploadDir, uniqueName);
    await fs.writeFile(filePath, buffer);

    const publicUrl = `${UPLOAD_URL_PREFIX}/${storageTenantId}/messenger/${uniqueName}`;

    return corsResponse(
      successResponse({
        url: publicUrl,
        type: safeType,
        name: file.name,
        size: file.size,
      }),
      request
    );
  } catch (error: any) {
    logger.error('Error uploading message attachment', { error });
    const status = error instanceof MessengerError ? error.statusCode : 500;
    return corsResponse(errorResponse(error.message || 'Failed to upload attachment', status), request);
  }
}
