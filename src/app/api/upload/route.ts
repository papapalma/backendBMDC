import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteFile, deleteImageWithThumbnail, getDefaultThumbnailPath, uploadFile, UploadCategory } from '@/utils/fileUpload';
import { handleOptionsRequest } from '@/middleware/cors';
import { withErrorHandler } from '@/middleware/errorHandler';
import { requireAuthAsync } from '@/middleware/auth';
import { errorResponse } from '@/utils/responses';
import { checkRateLimit, getRateLimitKey } from '@/utils/rateLimit';
import { detectCompressionBomb } from '@/lib/security/decompression-bomb';
import { scanFileForMalware } from '@/lib/security/malware-scanner';
import { activityLogService } from '@/services/activityLogService';

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

  const { user } = authResult;
  const userId = user.userId;
  const tenantId = user.tenantId;

  // Apply rate limiting: 10 uploads per user per hour
  const rlKey = getRateLimitKey(request, 'upload');
  const rlResponse = checkRateLimit(rlKey, {
    limit: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
  });
  if (rlResponse) return rlResponse;

  const body = await request.json();

  // Validate input with Zod schema
  const validationResult = FileUploadSchema.safeParse(body);
  if (!validationResult.success) {
    const errors = validationResult.error.errors.map(e => e.message);
    
    // Task 20.3: Log validation failures
    await activityLogService.logAction(
      userId,
      'file_validation_failed',
      'file',
      'unknown',
      {
        reason: 'invalid_upload_request',
        errors,
        category: body.category,
        timestamp: new Date().toISOString(),
      },
      request,
      tenantId
    );
    
    return errorResponse(errors.join('; '), 400);
  }

  const { file, category, filename, prefix } = validationResult.data;

  // Decode base64 file data
  const base64Data = file.replace(/^data:.*?;base64,/, '');
  const fileBuffer = Buffer.from(base64Data, 'base64');

  // ponytail: simple decompression bomb detection (upgrade: ClamAV for production)
  const bombCheck = await detectCompressionBomb(fileBuffer, undefined, filename);
  if (bombCheck.isBomb) {
    // Task 20.3: Log compression bomb detection as security event
    await activityLogService.logAction(
      userId,
      'file_upload_rejected',
      'file',
      'unknown',
      {
        reason: 'compression_bomb_detected',
        filename,
        fileSize: fileBuffer.length,
        compressionRatio: bombCheck.ratio,
        category,
        timestamp: new Date().toISOString(),
      },
      request,
      tenantId
    );
    
    return errorResponse(`File rejected: potential compression bomb (${bombCheck.reason})`, 400);
  }

  // Task 23: Malware scanning for uploaded files
  // ponytail: signature-based detection (upgrade: ClamAV or VirusTotal API for production)
  const malwareScan = scanFileForMalware(fileBuffer, filename);
  if (malwareScan.isMalicious) {
    // Task 20.3: Log malware detection as critical security event
    await activityLogService.logAction(
      userId,
      'file_upload_rejected',
      'file',
      'unknown',
      {
        reason: 'malware_detected',
        filename,
        fileSize: fileBuffer.length,
        threatType: malwareScan.threatType,
        threatReason: malwareScan.reason,
        fileHash: malwareScan.fileHash,
        confidence: malwareScan.confidence,
        category,
        timestamp: new Date().toISOString(),
      },
      request,
      tenantId
    );
    
    return errorResponse(`File rejected: potential malware detected (${malwareScan.reason})`, 403);
  }

  // Task 20.3: Log successful malware scan
  await activityLogService.logAction(
    userId,
    'file_scanned',
    'file',
    'unknown',
    {
      filename,
      fileSize: fileBuffer.length,
      fileHash: malwareScan.fileHash,
      scanMethod: malwareScan.scanMethod,
      scanResult: 'clean',
      category,
      timestamp: new Date().toISOString(),
    },
    request,
    tenantId
  );

  const result = await uploadFile(file, category, filename, prefix);

  if (!result.success) {
    // Task 20.3: Log upload failure
    await activityLogService.logAction(
      userId,
      'file_upload_failed',
      'file',
      'unknown',
      {
        reason: result.error || 'unknown_error',
        filename,
        fileSize: fileBuffer.length,
        category,
        timestamp: new Date().toISOString(),
      },
      request,
      tenantId
    );
    
    return errorResponse(result.error || 'Upload failed', 400);
  }

  // Task 20.3: Log successful file upload (audit trail for sensitive file operations)
  await activityLogService.logAction(
    userId,
    'file_upload',
    'file',
    result.filePath || 'unknown',
    {
      filename,
      fileSize: fileBuffer.length,
      category,
      filePath: result.filePath,
      timestamp: new Date().toISOString(),
      status: 'success',
    },
    request,
    tenantId
  );

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

  const { user } = authResult;
  const userId = user.userId;
  const tenantId = user.tenantId;

  const body = await request.json();
  const { filePath } = body || {};

  // Validate filePath
  if (!filePath || typeof filePath !== 'string') {
    // Task 20.3: Log validation failure
    await activityLogService.logAction(
      userId,
      'file_operation_rejected',
      'file',
      'unknown',
      {
        reason: 'invalid_file_path',
        operation: 'delete',
        timestamp: new Date().toISOString(),
      },
      request,
      tenantId
    );
    
    return errorResponse('filePath is required and must be a string', 400);
  }

  if (filePath.length > 500) {
    // Task 20.3: Log suspicious operation
    await activityLogService.logAction(
      userId,
      'file_operation_rejected',
      'file',
      'unknown',
      {
        reason: 'file_path_too_long',
        operation: 'delete',
        pathLength: filePath.length,
        timestamp: new Date().toISOString(),
      },
      request,
      tenantId
    );
    
    return errorResponse('filePath is too long', 400);
  }

  // Prevent path traversal attempts
  if (filePath.includes('..') || !filePath.startsWith('/uploads/')) {
    // Task 20.3: Log path traversal attempt
    await activityLogService.logAction(
      userId,
      'file_operation_rejected',
      'file',
      'unknown',
      {
        reason: 'path_traversal_attempt',
        operation: 'delete',
        suspiciousPath: filePath,
        timestamp: new Date().toISOString(),
      },
      request,
      tenantId
    );
    
    return errorResponse('Invalid file path', 400);
  }

  const deleted = filePath.startsWith('/uploads/images/')
    ? await deleteImageWithThumbnail(filePath)
    : await deleteFile(filePath);

  if (!deleted) {
    // Task 20.3: Log deletion failure
    await activityLogService.logAction(
      userId,
      'file_delete_failed',
      'file',
      filePath,
      {
        reason: 'deletion_error',
        filePath,
        timestamp: new Date().toISOString(),
      },
      request,
      tenantId
    );
    
    return errorResponse('Failed to delete file', 400);
  }

  // Task 20.3: Log successful file deletion
  await activityLogService.logAction(
    userId,
    'file_deleted',
    'file',
    filePath,
    {
      filePath,
      operation: 'delete',
      timestamp: new Date().toISOString(),
      status: 'success',
    },
    request,
    tenantId
  );

  return NextResponse.json({
    success: true,
    message: 'File deleted successfully',
  });
});


