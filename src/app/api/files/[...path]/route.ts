/**
 * GET /api/files/{tenant_id}/{file_type}/{...filename}
 *
 * Tenant-Scoped File Access Endpoint
 *
 * Implements Requirements 15.3, 15.4, 15.7:
 *   - 15.3  Verify that the file's tenant_id matches the requesting user's tenant_id
 *   - 15.4  Return 403 Forbidden for cross-tenant file access attempts
 *   - 15.7  Log all file access attempts including user_id, tenant_id, file_path, timestamp
 *
 * This endpoint acts as a secure proxy for tenant-scoped files stored under
 * /uploads/{tenant_id}/... It validates the requesting user's tenant context
 * before serving the file, preventing cross-tenant access even if the URL is
 * known.
 *
 * Super Admins may access files from any tenant.
 *
 * URL pattern:
 *   GET /api/files/{tenant_id}/images/items/photo.jpg
 *   GET /api/files/{tenant_id}/documents/programs/syllabus.pdf
 *   GET /api/files/{tenant_id}/qrcodes/trainees/qr_abc.png
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { requireTenantContext } from '@/middleware/tenantContext';
import { requireAuthAsync } from '@/middleware/auth';
import { handleOptionsRequest } from '@/middleware/cors';
import { UPLOAD_BASE_DIR, validateTenantId } from '@/lib/fileStorage';
import { withErrorHandler } from '@/middleware/errorHandler';
import { forbiddenResponse, notFoundResponse } from '@/utils/responses';
import { logger } from '@/utils/logger';
import { maybeDecrypt } from '@/lib/fileEncryption';

// ---------------------------------------------------------------------------
// MIME type map
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = { '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg':  'image/svg+xml',
  '.pdf':  'application/pdf',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt':  'text/plain; charset=utf-8', };

export function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

function getMimeType(filename: string): string { const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream'; }

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ path: string[] }> }
  ) => { // ── 1. Resolve path segments first ──────────────────────────────────────

const { path: segments } = await context.params;

    if (!segments || segments.length < 2) { return notFoundResponse('Invalid file path'); }

    // First segment is the tenant_id embedded in the URL

const [fileTenantId, ...rest] = segments;

    // ── 2. Check if this is a public asset ────────────────────────────────────
    // Public assets that don't require authentication:
    //   - CMS images (logo, hero background) and their thumbnails
    //   - Program images (photos) and their thumbnails - publicly discoverable
    //   - Trainee images (photos/thumbnails) - part of public listings
    //   - Item images (photos/thumbnails) - part of public inventory
    // 
    // Private assets require tenant authentication:
    //   - Instructor images, certificates, documents, QR codes

const isPublicCMSAsset = rest[0] === 'images' && rest[1] === 'cms';
    const isPublicProgramAsset = rest[0] === 'images' && rest[1] === 'programs';
    const isPublicTraineeAsset = rest[0] === 'images' && rest[1] === 'trainees';
    const isPublicItemAsset = rest[0] === 'images' && rest[1] === 'items';
    const isPublicAsset = isPublicCMSAsset || isPublicProgramAsset || isPublicTraineeAsset || isPublicItemAsset;

    // ── 3. Auth (skip for public assets, require for tenant-scoped assets) ────────────────────────────────

let userTenantId: string | undefined;
    let userId: string | undefined;
    let isSuperAdmin = false;

    if (!isPublicAsset) { 
      const ctxResult = requireTenantContext(request);
      if (ctxResult.error) {
        const authResult = await requireAuthAsync(request);
        if ('error' in authResult) {
          return ctxResult.error as NextResponse;
        }
        userTenantId = authResult.user.tenantId;
        userId = authResult.user.userId;
        isSuperAdmin = authResult.user.role === 'super_admin';
      } else {
        ({ tenantId: userTenantId, userId, isSuperAdmin } = ctxResult.context);
      }
    }

    // ── 4. Validate the tenant_id in the URL ─────────────────────────────────
    try { validateTenantId(fileTenantId); } catch { return notFoundResponse('Invalid file path'); }

    // ── 5. Tenant isolation check (Req 15.3, 15.4) ───────────────────────────
    // Skip check for public assets (CMS/programs) - they are discoverable by design
    // For private assets (trainees, items), require matching tenant_id or super admin

const filePath = `/uploads/${fileTenantId}/${rest.join('/')}`;

    if (!isPublicAsset && !isSuperAdmin && userTenantId) {
      // User must be from the same tenant OR be a super admin
      if (fileTenantId.toLowerCase() !== userTenantId.toLowerCase()) {
        // Log the cross-tenant access attempt (Req 15.7)
        logger.warn('[FILE_ACCESS] Cross-tenant access attempt blocked', { 
          userId,
          userTenantId,
          fileTenantId,
          filePath,
          timestamp: new Date().toISOString(), 
        });
        return forbiddenResponse('You do not have permission to access this file'); 
      }
    }

    // ── 6. Resolve absolute path and guard against traversal ─────────────────

const relativeParts = [fileTenantId, ...rest];
    const absolutePath = path.join(UPLOAD_BASE_DIR, ...relativeParts);

    // Ensure the resolved path stays within UPLOAD_BASE_DIR

if (!absolutePath.startsWith(UPLOAD_BASE_DIR)) { logger.warn('[FILE_ACCESS] Path traversal attempt blocked', { userId: userId || 'public',
        userTenantId: userTenantId || 'none',
        filePath,
        timestamp: new Date().toISOString(), });
      return forbiddenResponse('Invalid file path'); }

    // ── 7. Read file with thumbnail auto-generation & missing-image fallback ───
    let fileBuffer: Buffer | null = null;
    let servedFilename = path.basename(absolutePath);
    let servedMimeType = getMimeType(servedFilename);
    let isFallback = false;

    try {
      fileBuffer = await fs.readFile(absolutePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Case A: Missing thumbnail (.webp in a thumbnails directory)
        const isThumbnailRequest = rest.includes('thumbnails') && servedFilename.endsWith('.webp');
        if (isThumbnailRequest) {
          const thumbnailDir = path.dirname(absolutePath);
          const masterDir = path.dirname(thumbnailDir);
          const baseName = path.parse(servedFilename).name;
          const candidateExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];

          let masterBuffer: Buffer | null = null;
          for (const ext of candidateExts) {
            const masterPath = path.join(/*turbopackIgnore: true*/ masterDir, `${baseName}${ext}`);
            try {
              masterBuffer = await fs.readFile(/*turbopackIgnore: true*/ masterPath);
              break;
            } catch {
              // Try next extension
            }
          }

          if (masterBuffer) {
            try {
              await fs.mkdir(thumbnailDir, { recursive: true });
              fileBuffer = await sharp(masterBuffer)
                .rotate()
                .resize(200, 200, { fit: 'cover', position: 'centre' })
                .webp({ quality: 80 })
                .toBuffer();
              // Save generated thumbnail to disk for future requests
              await fs.writeFile(absolutePath, fileBuffer);
              logger.info('[FILE_ACCESS] Generated missing thumbnail on-the-fly', {
                filePath,
                baseName,
              });
            } catch (sharpErr) {
              logger.warn('[FILE_ACCESS] Failed to generate thumbnail from master, serving master', { error: sharpErr });
              fileBuffer = masterBuffer;
            }
          }
        }

        // Case B: Master image or thumbnail still not found
        if (!fileBuffer) {
          const isImageRequest = rest[0] === 'images' || servedMimeType.startsWith('image/');
          if (isImageRequest && isPublicAsset) {
            const defaultThumbnailPath = path.join(UPLOAD_BASE_DIR, 'images', 'defaults', 'blank-thumbnail.webp');
            try {
              fileBuffer = await fs.readFile(defaultThumbnailPath);
              servedFilename = 'blank-thumbnail.webp';
              servedMimeType = 'image/webp';
              isFallback = true;
              logger.warn('[FILE_ACCESS] File not found on disk, serving default placeholder', {
                filePath,
                isPublicAsset,
              });
            } catch {
              // Default thumbnail missing too, proceed to notFoundResponse
            }
          }
        }

        if (!fileBuffer) {
          logger.info('[FILE_ACCESS] File not found', {
            userId: userId || 'public',
            userTenantId: userTenantId || 'none',
            filePath,
            isPublicAsset,
            timestamp: new Date().toISOString(),
          });
          return notFoundResponse('File not found');
        }
      } else {
        throw err;
      }
    }

    // ── 7b. Task 10.4: Decrypt selfie images if encrypted ────────────────────
    // Selfies stored in /uploads/{tenant_id}/images/attendance/ are encrypted
    // if FILE_ENCRYPTION_ENABLED is true. Decrypt them on retrieval.
    const isAttendanceSelfie = rest[0] === 'images' && rest[1] === 'attendance';
    if (isAttendanceSelfie && !isFallback) {
      fileBuffer = maybeDecrypt(fileBuffer);
    }

    // ── 8. Log successful access (Req 15.7) ───────────────────────────────────
    logger.info('[FILE_ACCESS] File served', {
      userId: userId || 'public',
      tenantId: userTenantId || fileTenantId,
      filePath,
      isPublicAsset,
      isFallback,
      sizeBytes: fileBuffer.length,
      timestamp: new Date().toISOString(),
    });

    // ── 9. Return file with appropriate headers (ETag, 304, caching) ─────────
    const etag = `W/"${fileBuffer.length}-${crypto.createHash('md5').update(fileBuffer).digest('hex').substring(0, 16)}"`;
    const clientEtag = request.headers.get('if-none-match');
    const cacheControl = isFallback
      ? 'no-cache'
      : isPublicAsset
      ? 'public, max-age=86400, stale-while-revalidate=604800'
      : 'private, max-age=3600';

    if (clientEtag && clientEtag === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': cacheControl,
        },
      });
    }

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': servedMimeType,
        'Content-Length': String(fileBuffer.length),
        'Content-Disposition': `inline; filename="${servedFilename}"`,
        'Cache-Control': cacheControl,
        'ETag': etag,
        ...(isFallback ? { 'X-Fallback-Image': 'true' } : {}),
      },
    });
  }
);
