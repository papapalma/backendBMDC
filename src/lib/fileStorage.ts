/**
 * Tenant-Scoped File Storage Utility
 *
 * Implements the directory structure:
 *   /uploads/{tenant_id}/{file_type}/{filename}
 *
 * Subdirectory layout per tenant:
 *   documents/
 *     programs/
 *     trainees/
 *     certificates/
 *     reports/
 *   images/
 *     programs/
 *       thumbnails/
 *     trainees/
 *       thumbnails/
 *     items/
 *       thumbnails/
 *     cms/
 *       thumbnails/
 *   qrcodes/
 *     trainees/
 *     items/
 *     certificates/
 *
 * Requirements: 15.1, 15.6
 */

import { promises as fs } from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Absolute path to the public/uploads directory */
export const UPLOAD_BASE_DIR = path.join(process.cwd(), 'public', 'uploads');

/** Relative URL prefix used when building public URLs */
export const UPLOAD_URL_PREFIX = '/uploads';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Top-level file category stored under a tenant directory */
export type TenantFileCategory = 'documents' | 'images' | 'qrcodes';

/** Sub-type within the documents category */
export type DocumentSubType = 'programs' | 'trainees' | 'certificates' | 'reports';

/** Sub-type within the images category */
export type ImageSubType = 'programs' | 'trainees' | 'items' | 'cms' | 'attendance';

/** Sub-type within the qrcodes category */
export type QRCodeSubType = 'trainees' | 'items' | 'certificates';

/** Union of all valid sub-types */
export type FileSubType = DocumentSubType | ImageSubType | QRCodeSubType;

/**
 * Fully-qualified description of where a tenant file lives.
 */
export interface TenantFilePath {
  /** Absolute filesystem path to the file */
  absolutePath: string;
  /** Relative path stored in the database (starts with /uploads/) */
  relativePath: string;
  /** Public URL for the file */
  url: string;
}

/**
 * Fully-qualified description of where a tenant thumbnail lives.
 */
export interface TenantThumbnailPath extends TenantFilePath {
  /** Absolute filesystem path to the thumbnail */
  thumbnailAbsolutePath: string;
  /** Relative path for the thumbnail stored in the database */
  thumbnailRelativePath: string;
  /** Public URL for the thumbnail */
  thumbnailUrl: string;
}

// ---------------------------------------------------------------------------
// UUID validation
// ---------------------------------------------------------------------------

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate that a string is a well-formed UUID v4.
 * Throws if the value is invalid to prevent path-traversal via tenant_id.
 */
export function validateTenantId(tenantId: string): void {
  if (!tenantId || !UUID_REGEX.test(tenantId)) {
    throw new Error(`Invalid tenant_id: "${tenantId}". Must be a valid UUID.`);
  }
}

// ---------------------------------------------------------------------------
// Directory path helpers
// ---------------------------------------------------------------------------

/**
 * Return the absolute path to the root directory for a tenant.
 *
 * @example
 *   getTenantRootDir('abc-123') → '/…/public/uploads/abc-123'
 */
export function getTenantRootDir(tenantId: string): string {
  validateTenantId(tenantId);
  return path.join(UPLOAD_BASE_DIR, tenantId);
}

/**
 * Return the absolute path to a tenant's documents sub-directory.
 *
 * @example
 *   getDocumentDir('abc-123', 'programs') → '/…/public/uploads/abc-123/documents/programs'
 */
export function getDocumentDir(tenantId: string, subType: DocumentSubType): string {
  validateTenantId(tenantId);
  return path.join(UPLOAD_BASE_DIR, tenantId, 'documents', subType);
}

/**
 * Return the absolute path to a tenant's images sub-directory.
 *
 * @example
 *   getImageDir('abc-123', 'items') → '/…/public/uploads/abc-123/images/items'
 */
export function getImageDir(tenantId: string, subType: ImageSubType): string {
  validateTenantId(tenantId);
  return path.join(UPLOAD_BASE_DIR, tenantId, 'images', subType);
}

/**
 * Return the absolute path to a tenant's image thumbnails sub-directory.
 *
 * @example
 *   getImageThumbnailDir('abc-123', 'cms') → '/…/public/uploads/abc-123/images/cms/thumbnails'
 */
export function getImageThumbnailDir(tenantId: string, subType: ImageSubType): string {
  validateTenantId(tenantId);
  return path.join(UPLOAD_BASE_DIR, tenantId, 'images', subType, 'thumbnails');
}

/**
 * Return the absolute path to a tenant's qrcodes sub-directory.
 *
 * @example
 *   getQRCodeDir('abc-123', 'trainees') → '/…/public/uploads/abc-123/qrcodes/trainees'
 */
export function getQRCodeDir(tenantId: string, subType: QRCodeSubType): string {
  validateTenantId(tenantId);
  return path.join(UPLOAD_BASE_DIR, tenantId, 'qrcodes', subType);
}

// ---------------------------------------------------------------------------
// File path generation
// ---------------------------------------------------------------------------

/**
 * Generate the full set of paths for a document file belonging to a tenant.
 *
 * @param tenantId  - UUID of the tenant
 * @param subType   - Document sub-directory (programs | trainees | certificates | reports)
 * @param filename  - Sanitised filename (no path separators)
 * @returns TenantFilePath with absolute, relative, and URL paths
 */
export function generateDocumentPath(
  tenantId: string,
  subType: DocumentSubType,
  filename: string
): TenantFilePath {
  validateTenantId(tenantId);
  assertSafeFilename(filename);

  const absolutePath = path.join(getDocumentDir(tenantId, subType), filename);
  const relativePath = `${UPLOAD_URL_PREFIX}/${tenantId}/documents/${subType}/${filename}`;
  const url = buildPublicUrl(relativePath);

  return { absolutePath, relativePath, url };
}

/**
 * Generate the full set of paths for an image file belonging to a tenant,
 * including the corresponding thumbnail paths.
 *
 * @param tenantId  - UUID of the tenant
 * @param subType   - Image sub-directory (programs | trainees | items | cms)
 * @param filename  - Sanitised filename (no path separators)
 * @param thumbnailFilename - Sanitised thumbnail filename (defaults to <basename>.webp)
 * @returns TenantThumbnailPath with absolute, relative, URL, and thumbnail paths
 */
export function generateImagePath(
  tenantId: string,
  subType: ImageSubType,
  filename: string,
  thumbnailFilename?: string
): TenantThumbnailPath {
  validateTenantId(tenantId);
  assertSafeFilename(filename);

  const thumbName = thumbnailFilename ?? buildThumbnailFilename(filename);
  assertSafeFilename(thumbName);

  const absolutePath = path.join(getImageDir(tenantId, subType), filename);
  const relativePath = `${UPLOAD_URL_PREFIX}/${tenantId}/images/${subType}/${filename}`;
  const url = buildPublicUrl(relativePath);

  const thumbnailAbsolutePath = path.join(getImageThumbnailDir(tenantId, subType), thumbName);
  const thumbnailRelativePath = `${UPLOAD_URL_PREFIX}/${tenantId}/images/${subType}/thumbnails/${thumbName}`;
  const thumbnailUrl = buildPublicUrl(thumbnailRelativePath);

  return {
    absolutePath,
    relativePath,
    url,
    thumbnailAbsolutePath,
    thumbnailRelativePath,
    thumbnailUrl,
  };
}

/**
 * Generate the full set of paths for a QR code image belonging to a tenant.
 *
 * @param tenantId  - UUID of the tenant
 * @param subType   - QR code sub-directory (trainees | items | certificates)
 * @param filename  - Sanitised filename (no path separators)
 * @returns TenantFilePath with absolute, relative, and URL paths
 */
export function generateQRCodePath(
  tenantId: string,
  subType: QRCodeSubType,
  filename: string
): TenantFilePath {
  validateTenantId(tenantId);
  assertSafeFilename(filename);

  const absolutePath = path.join(getQRCodeDir(tenantId, subType), filename);
  const relativePath = `${UPLOAD_URL_PREFIX}/${tenantId}/qrcodes/${subType}/${filename}`;
  const url = buildPublicUrl(relativePath);

  return { absolutePath, relativePath, url };
}

// ---------------------------------------------------------------------------
// Directory initialisation
// ---------------------------------------------------------------------------

/**
 * Create all required sub-directories for a tenant if they do not already
 * exist.  Safe to call multiple times (idempotent).
 *
 * Directory tree created:
 *   uploads/{tenantId}/
 *     documents/{programs,trainees,certificates,reports}/
 *     images/{programs,trainees,items,cms}/thumbnails/
 *     qrcodes/{trainees,items,certificates}/
 *
 * @param tenantId - UUID of the tenant
 */
export async function initTenantDirectories(tenantId: string): Promise<void> {
  validateTenantId(tenantId);

  const dirs: string[] = [
    // documents
    getDocumentDir(tenantId, 'programs'),
    getDocumentDir(tenantId, 'trainees'),
    getDocumentDir(tenantId, 'certificates'),
    getDocumentDir(tenantId, 'reports'),

    // images (main + thumbnails)
    getImageDir(tenantId, 'programs'),
    getImageThumbnailDir(tenantId, 'programs'),
    getImageDir(tenantId, 'trainees'),
    getImageThumbnailDir(tenantId, 'trainees'),
    getImageDir(tenantId, 'items'),
    getImageThumbnailDir(tenantId, 'items'),
    getImageDir(tenantId, 'cms'),
    getImageThumbnailDir(tenantId, 'cms'),
    getImageDir(tenantId, 'attendance'),   // attendance selfies (no thumbnails needed)

    // qrcodes
    getQRCodeDir(tenantId, 'trainees'),
    getQRCodeDir(tenantId, 'items'),
    getQRCodeDir(tenantId, 'certificates'),
  ];

  await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));
}

/**
 * Check whether the tenant directory structure already exists.
 *
 * @param tenantId - UUID of the tenant
 * @returns true if the tenant root directory exists
 */
export async function tenantDirectoriesExist(tenantId: string): Promise<boolean> {
  validateTenantId(tenantId);
  try {
    await fs.access(getTenantRootDir(tenantId));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Path parsing / extraction
// ---------------------------------------------------------------------------

/**
 * Extract the tenant_id from a relative upload path.
 *
 * @param relativePath - e.g. "/uploads/{tenant_id}/images/items/foo.jpg"
 * @returns The tenant_id string, or null if the path is not tenant-scoped
 */
export function extractTenantIdFromPath(relativePath: string): string | null {
  if (!relativePath) return null;

  // Normalise separators and strip leading slash

const normalised = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');

  // Expected: uploads/{tenant_id}/...

const parts = normalised.split('/');
  if (parts[0] !== 'uploads' || parts.length < 3) return null;

  const candidate = parts[1];
  if (!UUID_REGEX.test(candidate)) return null;

  return candidate;
}

/**
 * Verify that a relative file path belongs to the given tenant.
 *
 * @param relativePath - Relative path stored in the database
 * @param tenantId     - Expected tenant UUID
 * @returns true if the path belongs to the tenant
 */
export function pathBelongsToTenant(relativePath: string, tenantId: string): boolean {
  validateTenantId(tenantId);
  const extracted = extractTenantIdFromPath(relativePath);
  return extracted !== null && extracted.toLowerCase() === tenantId.toLowerCase();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a public URL from a relative path using the BACKEND_URL env var.
 */
function buildPublicUrl(relativePath: string): string {
  const base = (process.env.BACKEND_URL ?? 'http://localhost:3003').replace(/\/$/, '');

return `${base}${relativePath}`;
}

/**
 * Derive a WebP thumbnail filename from an original image filename.
 * e.g. "photo_123.jpg" → "photo_123.webp"
 */
function buildThumbnailFilename(filename: string): string {
  const parsed = path.parse(filename);
  return `${parsed.name}.webp`;
}

/**
 * Guard against path-traversal via filenames.
 * Throws if the filename contains directory separators or is empty.
 */
function assertSafeFilename(filename: string): void {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error(`Unsafe filename: "${filename}"`);
  }
}
