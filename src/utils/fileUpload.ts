import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

// Allowed file types
const ALLOWED_IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'];
const ALLOWED_DOCUMENT_TYPES = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];

/**
 * Magic byte signatures for allowed file types (SEC-12).
 * Checked against the raw file buffer so a renamed file is rejected.
 */
const IMAGE_MAGIC_BYTES: Array<{ magic: number[]; offset?: number }> = [
  { magic: [0xff, 0xd8, 0xff] },                          // JPEG
  { magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }, // PNG
  { magic: [0x47, 0x49, 0x46, 0x38] },                    // GIF87a / GIF89a
  { magic: [0x52, 0x49, 0x46, 0x46], offset: 0 },         // WebP (RIFF)
];

const DOCUMENT_MAGIC_BYTES: Array<{ magic: number[]; offset?: number }> = [
  { magic: [0x25, 0x50, 0x44, 0x46] },                    // PDF (%PDF)
  { magic: [0x50, 0x4b, 0x03, 0x04] },                    // ZIP-based (docx, xlsx)
  { magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }, // OLE2 (doc, xls)
];

function matchesMagic(
  buf: Buffer,
  signatures: Array<{ magic: number[]; offset?: number }>
): boolean {
  return signatures.some(({ magic, offset = 0 }) =>
    magic.every((byte, i) => buf[offset + i] === byte)
  );
}

// File size limits (in bytes)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB

// Base upload directory
const UPLOAD_BASE_DIR = path.join(process.cwd(), 'public', 'uploads');
const DEFAULT_THUMBNAIL_RELATIVE_PATH = '/uploads/images/defaults/blank-thumbnail.webp';
const THUMBNAIL_SIZE = 320;
const THUMBNAIL_QUALITY = 82;

export type UploadCategory = 'items' | 'trainees' | 'programs' | 'cms' | 'qrcodes' | 'documents';

interface UploadResult {
  success: boolean;
  filePath?: string;
  url?: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  error?: string;
}

/**
 * Sanitize filename to remove special characters and spaces
 */
function sanitizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_');
}

/**
 * Generate unique filename with timestamp and random hash
 */
function generateFilename(originalName: string, prefix?: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const basename = path.basename(originalName, ext);
  const sanitized = sanitizeFilename(basename);
  const timestamp = Date.now();
  const hash = crypto.randomBytes(4).toString('hex');
  
  if (prefix) {
    return `${prefix}_${sanitized}_${timestamp}_${hash}${ext}`;
  }
  return `${sanitized}_${timestamp}_${hash}${ext}`;
}

/**
 * Validate file type
 */
function validateFileType(filename: string, category: UploadCategory): { valid: boolean; error?: string } {
  const ext = path.extname(filename).toLowerCase();
  
  if (category === 'documents') {
    if (!ALLOWED_DOCUMENT_TYPES.includes(ext)) {
      return {
        valid: false,
        error: `File type ${ext} not allowed. Allowed types: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`
      };
    }
  } else {
    // All other categories are for images
    if (!ALLOWED_IMAGE_TYPES.includes(ext)) {
      return {
        valid: false,
        error: `Image type ${ext} not allowed. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`
      };
    }
  }
  
  return { valid: true };
}

/**
 * Validate file size
 */
function validateFileSize(size: number, category: UploadCategory): { valid: boolean; error?: string } {
  const maxSize = category === 'documents' ? MAX_DOCUMENT_SIZE : MAX_IMAGE_SIZE;
  
  if (size > maxSize) {
    const maxSizeMB = maxSize / (1024 * 1024);
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${maxSizeMB}MB`
    };
  }
  
  return { valid: true };
}

/**
 * Get upload directory path for category
 */
function getUploadDir(category: UploadCategory): string {
  if (category === 'documents') {
    return path.join(UPLOAD_BASE_DIR, 'documents');
  }
  return path.join(UPLOAD_BASE_DIR, 'images', category);
}

function getThumbnailDir(category: UploadCategory): string {
  return path.join(UPLOAD_BASE_DIR, 'images', category, 'thumbnails');
}

function getDefaultThumbnailAbsolutePath(): string {
  return path.join(UPLOAD_BASE_DIR, 'images', 'defaults', 'blank-thumbnail.webp');
}

function isImageCategory(category: UploadCategory): boolean {
  return category !== 'documents';
}

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

function normalizeUploadPath(inputPath: string): string | null {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }

let candidatePath = inputPath.trim();
  if (!candidatePath) {
    return null;
  }

if (candidatePath.startsWith('http://') || candidatePath.startsWith('https://')) {
    try {
      candidatePath = new URL(candidatePath).pathname;
    } catch {
      return null;
    }
  }

  candidatePath = candidatePath.split('?')[0].split('#')[0];
  candidatePath = candidatePath.replace(/\\/g, '/');

  if (candidatePath.startsWith('uploads/')) {
    candidatePath = `/${candidatePath}`;
  }

const normalized = path.posix.normalize(candidatePath);

  if (!normalized.startsWith('/uploads/')) {
    return null;
  }

if (normalized.includes('..')) {
    return null;
  }

  return normalized;
}

function toAbsolutePublicPath(uploadPath: string): string | null {
  const normalized = normalizeUploadPath(uploadPath);
  if (!normalized) {
    return null;
  }

  return path.join(process.cwd(), 'public', normalized.replace(/^\/+/, ''));
}

function getThumbnailFilename(filename: string): string {
  const parsed = path.parse(filename);
  return `${parsed.name}.webp`;
}

function getThumbnailPathByFilename(category: UploadCategory, filename: string): string {
  return `/uploads/images/${category}/thumbnails/${getThumbnailFilename(filename)}`;
}

export function getDefaultThumbnailPath(): string {
  return DEFAULT_THUMBNAIL_RELATIVE_PATH;
}

export function getThumbnailPathForImagePath(imagePath: string | null | undefined): string {
  const normalizedImagePath = normalizeUploadPath(imagePath || '');

  if (!normalizedImagePath) {
    return DEFAULT_THUMBNAIL_RELATIVE_PATH;
  }

  // Match both legacy paths (/uploads/images/{category}/{filename})
  // and tenant-scoped paths (/uploads/{uuid}/images/{category}/{filename})

const legacyMatch = normalizedImagePath.match(/^\/uploads\/images\/([^/]+)\/(.+)$/);
  const tenantMatch = normalizedImagePath.match(/^\/uploads\/([0-9a-fA-F\-]+)\/images\/([^/]+)\/(.+)$/);

  let category: string | undefined;
  let remainder: string | undefined;
  let tenantId: string | undefined;

  if (legacyMatch) {
    [, category, remainder] = legacyMatch;
  } else if (tenantMatch) {
    [, tenantId, category, remainder] = tenantMatch;
  } else {
    return DEFAULT_THUMBNAIL_RELATIVE_PATH;
  }

if (category === 'defaults') {
    return DEFAULT_THUMBNAIL_RELATIVE_PATH;
  }

if (remainder?.startsWith('thumbnails/')) {
    return normalizedImagePath;
  }

const filename = path.posix.basename(remainder || '');
  const baseName = path.posix.parse(filename).name;

  if (!baseName) {
    return DEFAULT_THUMBNAIL_RELATIVE_PATH;
  }

  // Return thumbnail path in the same format as the original

if (tenantId) {
    return `/uploads/${tenantId}/images/${category}/thumbnails/${baseName}.webp`;
  } else {
    return `/uploads/images/${category}/thumbnails/${baseName}.webp`;
  }
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDefaultThumbnailExists(): Promise<void> {
  const defaultThumbnailAbsolutePath = getDefaultThumbnailAbsolutePath();

  if (await pathExists(defaultThumbnailAbsolutePath)) {
    return;
  }

  await ensureDir(path.dirname(defaultThumbnailAbsolutePath));

  await sharp({
    create: {
      width: THUMBNAIL_SIZE,
      height: THUMBNAIL_SIZE,
      channels: 3,
      background: { r: 240, g: 243, b: 247 },
    },
  })
    .webp({ quality: 90 })
    .toFile(defaultThumbnailAbsolutePath);
}

async function createThumbnailFromBuffer(sourceBuffer: Buffer, destinationPath: string): Promise<void> {
  await ensureDir(path.dirname(destinationPath));

  await sharp(sourceBuffer)
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
      fit: 'cover',
      position: 'centre',
    })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toFile(destinationPath);
}

async function createThumbnailFromFile(sourcePath: string, destinationPath: string): Promise<void> {
  await ensureDir(path.dirname(destinationPath));

  await sharp(sourcePath)
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
      fit: 'cover',
      position: 'centre',
    })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toFile(destinationPath);
}

export async function ensureThumbnailForImagePath(imagePath: string | null | undefined): Promise<string> {
  try {
    await ensureDefaultThumbnailExists();

    const thumbnailPath = getThumbnailPathForImagePath(imagePath);
    if (thumbnailPath === DEFAULT_THUMBNAIL_RELATIVE_PATH) {
      return thumbnailPath;
    }

const thumbnailAbsolutePath = toAbsolutePublicPath(thumbnailPath);
    const sourceAbsolutePath = toAbsolutePublicPath(imagePath || '');

    if (!thumbnailAbsolutePath || !sourceAbsolutePath) {
      return DEFAULT_THUMBNAIL_RELATIVE_PATH;
    }

if (await pathExists(thumbnailAbsolutePath)) {
      return thumbnailPath;
    }

if (!(await pathExists(sourceAbsolutePath))) {
      return DEFAULT_THUMBNAIL_RELATIVE_PATH;
    }

    await createThumbnailFromFile(sourceAbsolutePath, thumbnailAbsolutePath);
    return thumbnailPath;
  } catch (error) {
    console.error('Thumbnail ensure error:', error);
    return DEFAULT_THUMBNAIL_RELATIVE_PATH;
  }
}

/**
 * Upload file to server
 * 
 * @param file - File buffer or base64 string
 * @param category - Upload category (items, trainees, etc.)
 * @param originalName - Original filename
 * @param prefix - Optional prefix for filename (e.g., item_123)
 * @returns Upload result with file path and URL
 */
export async function uploadFile(
  file: Buffer | string,
  category: UploadCategory,
  originalName: string,
  prefix?: string
): Promise<UploadResult> {
  try {
    // Convert base64 to buffer if needed
    let fileBuffer: Buffer;
    if (typeof file === 'string') {
      // Remove data URL prefix if present
      const base64Data = file.replace(/^data:.*?;base64,/, '');
      fileBuffer = Buffer.from(base64Data, 'base64');
    } else {
      fileBuffer = file;
    }

    // Validate file type
    const typeValidation = validateFileType(originalName, category);
    if (!typeValidation.valid) {
      return { success: false, error: typeValidation.error };
    }

    // Validate actual file content against known magic bytes (SEC-12)

const expectedSignatures = category === 'documents' ? DOCUMENT_MAGIC_BYTES : IMAGE_MAGIC_BYTES;
    if (!matchesMagic(fileBuffer, expectedSignatures)) {
      return { success: false, error: 'File content does not match the declared file type.' };
    }

    // Validate file size

const sizeValidation = validateFileSize(fileBuffer.length, category);
    if (!sizeValidation.valid) {
      return { success: false, error: sizeValidation.error };
    }

    // Generate filename and paths

const filename = generateFilename(originalName, prefix);
    const uploadDir = getUploadDir(category);
    await ensureDir(uploadDir);

    let thumbnailPath: string | undefined;
    if (isImageCategory(category)) {
      await ensureDir(getThumbnailDir(category));
      await ensureDefaultThumbnailExists();
    }

const filePath = path.join(uploadDir, filename);
    
    // Write file to disk

await fs.writeFile(filePath, fileBuffer);

    // Generate relative path for database storage

const relativePath = category === 'documents'
      ? `/uploads/documents/${filename}`
      : `/uploads/images/${category}/${filename}`;

    // Generate full URL

const baseUrl = process.env.BACKEND_URL || 'http://localhost:3003';

const url = `${baseUrl}${relativePath}`;

    if (isImageCategory(category)) {
      const generatedThumbnailPath = getThumbnailPathByFilename(category, filename);
      const generatedThumbnailAbsolutePath = toAbsolutePublicPath(generatedThumbnailPath);

      if (generatedThumbnailAbsolutePath) {
        try {
          await createThumbnailFromBuffer(fileBuffer, generatedThumbnailAbsolutePath);
          thumbnailPath = generatedThumbnailPath;
        } catch (thumbnailError) {
          console.error('Thumbnail generation error:', thumbnailError);
          thumbnailPath = DEFAULT_THUMBNAIL_RELATIVE_PATH;
        }
      } else {
        thumbnailPath = DEFAULT_THUMBNAIL_RELATIVE_PATH;
      }
    }

    return {
      success: true,
      filePath: relativePath,
      url,
      thumbnailPath,
      thumbnailUrl: thumbnailPath ? `${baseUrl}${thumbnailPath}` : undefined,
    };
  } catch (error) {
    console.error('File upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown upload error'
    };
  }
}

/**
 * Delete file from server
 * 
 * @param filePath - Relative file path (from database)
 * @returns Success status
 */
export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    const normalizedPath = normalizeUploadPath(filePath);
    if (!normalizedPath) {
      return false;
    }

if (normalizedPath === DEFAULT_THUMBNAIL_RELATIVE_PATH) {
      // Keep a reusable fallback thumbnail on disk.

return true;
    }

const absolutePath = toAbsolutePublicPath(normalizedPath);
    if (!absolutePath) {
      return false;
    }

if (!(await pathExists(absolutePath))) {
      return true;
    }
    
    // Delete file

await fs.unlink(absolutePath);
    
    return true;
  } catch (error) {
    console.error('File deletion error:', error);
    return false;
  }
}

/**
 * Delete an uploaded image and its thumbnail counterpart.
 *
 * @param imagePath - Original image path stored in DB
 * @returns true if cleanup succeeded (or files were already absent)
 */
export async function deleteImageWithThumbnail(imagePath: string | null | undefined): Promise<boolean> {
  const normalizedImagePath = normalizeUploadPath(imagePath || '');
  if (!normalizedImagePath) {
    return false;
  }

const pathsToDelete = new Set<string>();
  if (normalizedImagePath !== DEFAULT_THUMBNAIL_RELATIVE_PATH) {
    pathsToDelete.add(normalizedImagePath);
  }

const thumbnailPath = getThumbnailPathForImagePath(normalizedImagePath);
  if (thumbnailPath !== DEFAULT_THUMBNAIL_RELATIVE_PATH) {
    pathsToDelete.add(thumbnailPath);
  }

let success = true;
  for (const pathToDelete of pathsToDelete) {
    const deleted = await deleteFile(pathToDelete);
    if (!deleted) {
      success = false;
    }
  }

  return success;
}

/**
 * Clean temporary files older than specified hours
 * 
 * @param hours - Age threshold in hours (default: 24)
 */
export async function cleanTempFiles(hours: number = 24): Promise<number> {
  try {
    const tempDir = path.join(UPLOAD_BASE_DIR, 'temp');

    if (!(await pathExists(tempDir))) {
      return 0;
    }

const files = await fs.readdir(tempDir);
    const now = Date.now();
    const threshold = hours * 60 * 60 * 1000;
    
    let deletedCount = 0;
    
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stats = await fs.stat(filePath);
      
      if (now - stats.mtimeMs > threshold) {
        await fs.unlink(filePath);
        deletedCount++;
      }
    }
    
    return deletedCount;
  } catch (error) {
    console.error('Temp file cleanup error:', error);
    return 0;
  }
}

/**
 * Get file info
 * 
 * @param filePath - Relative file path
 * @returns File information or null if not found
 */
export async function getFileInfo(filePath: string): Promise<{
  exists: boolean;
  size?: number;
  created?: Date;
  modified?: Date;
} | null> {
  try {
    const absolutePath = toAbsolutePublicPath(filePath);
    if (!absolutePath) {
      return { exists: false };
    }

const stats = await fs.stat(absolutePath);
    
    return {
      exists: true,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime
    };
  } catch {
    return { exists: false };
  }
}
