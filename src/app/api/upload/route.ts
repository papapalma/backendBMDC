import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteFile, deleteImageWithThumbnail, getDefaultThumbnailPath, uploadFile, UploadCategory } from '@/utils/fileUpload';
import { handleOptionsRequest } from '@/middleware/cors';
import { withErrorHandler } from '@/middleware/errorHandler';
import { requireAuthAsync } from '@/middleware/auth';
import { errorResponse } from '@/utils/responses';

// Note: Body size limits are configured in next.config.js
// App Router handles JSON body parsing automatically

// Strict validation schema for file uploads
const FileUploadSchema = z.object({
  file: z.string()
    .min(1, 'File data is required')
    .refine(
      (val) => {
        // Validate base64 encoding
        try {
          Buffer.from(val.replace(/^data:.*?;base64,/, ''), 'base64');
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid base64 encoding' }
    ),
  category: z.enum(['items', 'trainees', 'programs', 'cms', 'qrcodes', 'documents'], {
    errorMap: () => ({ message: 'Category must be one of: items, trainees, programs, cms, qrcodes, documents' })
  }),
  filename: z.string()
    .min(1, 'Filename is required')
    .max(255, 'Filename must not exceed 255 characters')
    .refine(
      (val) => {
        // Only allow safe filenames: alphanumeric, dash, underscore, period
        // No double extensions or path separators
        const allowedPattern = /^[a-z0-9\-_.]+\.[a-z0-9]+$/i;
        const hasDoubleExt = val.split('.').length > 2;
        return allowedPattern.test(val) && !hasDoubleExt;
      },
      { message: 'Filename contains invalid characters or format (alphanumeric, dash, underscore, period only)' }
    ),
  prefix: z.string()
    .max(50, 'Prefix must not exceed 50 characters')
    .refine(
      (val) => /^[a-z0-9_-]+$/i.test(val),
      { message: 'Prefix can only contain alphanumeric characters, dash, and underscore' }
    )
    .optional(),
});

// OPTIONS /api/upload - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * POST /api/upload
 * Upload a file to the server
 *
 * Body:
 * - file: base64 encoded file
 * - category: 'items' | 'trainees' | 'programs' | 'cms' | 'qrcodes' | 'documents'
 * - filename: original filename
 * - prefix: optional prefix for the filename (e.g., 'item_123')
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);
  if ('error' in authResult) return authResult.error as NextResponse;

  const body = await request.json();

  // Validate input with Zod schema
  const validationResult = FileUploadSchema.safeParse(body);
  if (!validationResult.success) {
    const errors = validationResult.error.errors.map(e => e.message);
    return errorResponse(errors.join('; '), 400);
  }

  const { file, category, filename, prefix } = validationResult.data;

  const result = await uploadFile(file, category, filename, prefix);

  if (!result.success) {
    return errorResponse(result.error || 'Upload failed', 400);
  }

  return NextResponse.json({
    success: true,
    data: {
      filePath: result.filePath,  // relative path stored in DB, e.g. /uploads/images/items/photo.jpg
      url: result.url,  // full URL for display, e.g. http://localhost:3001/uploads/...
      thumbnailPath: result.thumbnailPath,
      thumbnailUrl: result.thumbnailUrl,
      defaultThumbnailPath: getDefaultThumbnailPath(),
    },
  });
});

/**
 * DELETE /api/upload
 * Delete a file from the server.
 * For image uploads, this also removes the generated thumbnail.
 *
 * Body:
 * - filePath: relative upload path (e.g., /uploads/images/items/file.jpg)
 */
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuthAsync(request);
  if ('error' in authResult) return authResult.error as NextResponse;

  const body = await request.json();
  const { filePath } = body || {};

  // Validate filePath
  if (!filePath || typeof filePath !== 'string') {
    return errorResponse('filePath is required and must be a string', 400);
  }

  if (filePath.length > 500) {
    return errorResponse('filePath is too long', 400);
  }

  // Prevent path traversal attempts
  if (filePath.includes('..') || !filePath.startsWith('/uploads/')) {
    return errorResponse('Invalid file path', 400);
  }

  const deleted = filePath.startsWith('/uploads/images/')
    ? await deleteImageWithThumbnail(filePath)
    : await deleteFile(filePath);

  if (!deleted) {
    return errorResponse('Failed to delete file', 400);
  }

  return NextResponse.json({
    success: true,
    message: 'File deleted successfully',
  });
});
