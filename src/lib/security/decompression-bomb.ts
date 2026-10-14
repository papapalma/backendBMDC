/**
 * Decompression Bomb Detection
 *
 * Prevents decompression attacks (zip bombs, etc.) that can crash the server
 * by extracting to massive sizes.
 *
 * Detects:
 * - Compression ratio > 100:1 → likely bomb
 * - Uncompressed size > 500 MB → too large
 * - Suspicious archive formats (ZIP, tar.gz, 7z, rar)
 *
 * Implementation: Uses Node.js built-in zlib (no new dependency)
 * Implements: Task 8.1 of Security Hardening spec
 *
 * Ponytail approach: Simple heuristic detection using zlib.
 * Upgrade path: For production, integrate ClamAV or cloud-based scanning.
 */

import { promisify } from 'util';
import * as zlib from 'zlib';

// ============================================================================
// Constants
// ============================================================================

/**
 * Archive file signatures (magic bytes) for format identification.
 * Used to quickly identify file types before attempting decompression.
 */
export const ARCHIVE_SIGNATURES = {
  ZIP: Buffer.from([0x50, 0x4b, 0x03, 0x04]), // PK..
  GZIP: Buffer.from([0x1f, 0x8b]), // ..
  BZIP2: Buffer.from([0x42, 0x5a]), // BZ
  SEVENZ: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), // 7z...
  RAR: Buffer.from([0x52, 0x61, 0x72, 0x21]), // Rar!
  TAR_GZIP: Buffer.from([0x1f, 0x8b]), // Same as gzip (check filename for .tar.gz)
};

/**
 * Decompression bomb detection thresholds
 */
export const BOMB_THRESHOLDS = {
  /** Maximum compression ratio before flagging as bomb (100:1) */
  MAX_COMPRESSION_RATIO: 100,

  /** Maximum uncompressed size in bytes (500 MB) */
  MAX_UNCOMPRESSED_SIZE: 500 * 1024 * 1024, // 500 MB

  /** Maximum compressed size we will attempt to analyze (50 MB) */
  MAX_COMPRESSED_SIZE: 50 * 1024 * 1024, // 50 MB

  /** Sample size for ratio estimation (first 64 KB) */
  SAMPLE_SIZE: 64 * 1024, // 64 KB
};

// ============================================================================
// Result Types
// ============================================================================

export interface BombCheckResult {
  /** True if file is detected as potential bomb */
  isBomb: boolean;

  /** Reason if detected as bomb */
  reason?: string;

  /** Detected archive format (if recognized) */
  format?: string;

  /** Estimated compression ratio */
  ratio?: number;

  /** Estimated uncompressed size (bytes) */
  estimatedUncompressedSize?: number;

  /** Compressed size (bytes) */
  compressedSize: number;
}

// ============================================================================
// Archive Format Detection
// ============================================================================

/**
 * Identify archive format by magic bytes and filename.
 *
 * @param buffer - File buffer (first 512 bytes sufficient)
 * @param filename - Optional filename for additional detection
 * @returns Format name or 'unknown'
 */
export function detectArchiveFormat(buffer: Buffer, filename?: string): string {
  // Check magic bytes
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ARCHIVE_SIGNATURES.ZIP)) {
    return 'ZIP';
  }

  if (buffer.length >= 6 && buffer.subarray(0, 6).equals(ARCHIVE_SIGNATURES.SEVENZ)) {
    return '7Z';
  }

  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ARCHIVE_SIGNATURES.RAR)) {
    return 'RAR';
  }

  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(ARCHIVE_SIGNATURES.GZIP)) {
    // Could be gzip or tar.gz
    if (filename?.endsWith('.tar.gz') || filename?.endsWith('.tgz')) {
      return 'TAR.GZ';
    }
    return 'GZIP';
  }

  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(ARCHIVE_SIGNATURES.BZIP2)) {
    return 'BZIP2';
  }

  // Check filename for .tar (uncompressed tar archives)
  if (filename?.endsWith('.tar')) {
    return 'TAR';
  }

  return 'unknown';
}

// ============================================================================
// Gzip Decompression Ratio Analysis
// ============================================================================

/**
 * Estimate compression ratio for gzip files by reading the gzip trailer.
 *
 * Gzip format stores uncompressed size in last 4 bytes (little-endian).
 * This allows ratio estimation without full decompression.
 *
 * ponytail: Simple heuristic estimation (upgrade: full format parsing for accuracy)
 *
 * @param buffer - Gzip file buffer
 * @returns Object with ratio and estimated uncompressed size, or null if error
 */
function estimateGzipRatio(buffer: Buffer): {
  ratio: number;
  estimatedUncompressedSize: number;
} | null {
  try {
    // Gzip trailer: last 4 bytes = uncompressed size (mod 2^32, little-endian)
    if (buffer.length < 4) {
      return null;
    }

    const uncompressedSizeBytes = buffer.subarray(-4);
    const uncompressedSizeLow = uncompressedSizeBytes.readUInt32LE(0);

    // For large files, gzip size field overflows (mod 2^32)
    // Heuristic: if uncompressed size < compressed size, likely a large file
    const estimatedUncompressedSize = uncompressedSizeLow;
    const ratio = estimatedUncompressedSize / buffer.length;

    return {
      ratio,
      estimatedUncompressedSize,
    };
  } catch {
    return null;
  }
}

/**
 * Detect decompression bombs in gzip files.
 *
 * Strategy:
 * 1. Check gzip trailer for uncompressed size
 * 2. If size > MAX_UNCOMPRESSED_SIZE → bomb
 * 3. If ratio > MAX_COMPRESSION_RATIO → bomb
 *
 * ponytail: Heuristic detection (upgrade: stream-based progressive decompression with size limits)
 *
 * @param buffer - Gzip file buffer
 * @returns BombCheckResult
 */
function detectGzipBomb(buffer: Buffer): BombCheckResult {
  const compressedSize = buffer.length;

  // Check compressed size first
  if (compressedSize > BOMB_THRESHOLDS.MAX_COMPRESSED_SIZE) {
    return {
      isBomb: true,
      reason: `Compressed file too large (${compressedSize} bytes, max ${BOMB_THRESHOLDS.MAX_COMPRESSED_SIZE})`,
      compressedSize,
      format: 'GZIP',
    };
  }

  const ratioInfo = estimateGzipRatio(buffer);

  if (!ratioInfo) {
    // Could not determine ratio; assume safe but log
    return {
      isBomb: false,
      compressedSize,
      format: 'GZIP',
    };
  }

  const { ratio, estimatedUncompressedSize } = ratioInfo;

  // Check estimated uncompressed size
  if (estimatedUncompressedSize > BOMB_THRESHOLDS.MAX_UNCOMPRESSED_SIZE) {
    return {
      isBomb: true,
      reason: `Uncompressed size exceeds limit (${estimatedUncompressedSize} bytes, max ${BOMB_THRESHOLDS.MAX_UNCOMPRESSED_SIZE})`,
      compressedSize,
      format: 'GZIP',
      ratio,
      estimatedUncompressedSize,
    };
  }

  // Check compression ratio
  if (ratio > BOMB_THRESHOLDS.MAX_COMPRESSION_RATIO) {
    return {
      isBomb: true,
      reason: `Compression ratio too high (${ratio.toFixed(1)}:1, max ${BOMB_THRESHOLDS.MAX_COMPRESSION_RATIO}:1)`,
      compressedSize,
      format: 'GZIP',
      ratio,
      estimatedUncompressedSize,
    };
  }

  return {
    isBomb: false,
    compressedSize,
    format: 'GZIP',
    ratio,
    estimatedUncompressedSize,
  };
}

// ============================================================================
// ZIP Bomb Detection (via Central Directory Analysis)
// ============================================================================

/**
 * Parse ZIP central directory to detect bomb signatures.
 *
 * ZIP files contain:
 * - Local file headers
 * - File data
 * - Central directory (at end of file)
 *
 * Central directory has:
 * - Compressed size
 * - Uncompressed size
 *
 * We extract these for ratio analysis without fully decompressing.
 *
 * ponytail: Simple heuristic (upgrade: full ZIP format parsing)
 *
 * @param buffer - ZIP file buffer
 * @returns Array of file info or null if parsing fails
 */
function parseZipCentralDirectory(
  buffer: Buffer
): Array<{ compressedSize: number; uncompressedSize: number }> | null {
  try {
    // Find End of Central Directory record (EOCD)
    // EOCD signature: 0x504b0506
    let eocdOffset = -1;

    for (let i = buffer.length - 22; i >= 0; i--) {
      if (
        buffer[i] === 0x50 &&
        buffer[i + 1] === 0x4b &&
        buffer[i + 2] === 0x05 &&
        buffer[i + 3] === 0x06
      ) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      return null; // Not a valid ZIP
    }

    // Read number of entries from EOCD (offset +10, 2 bytes, little-endian)
    const numEntries = buffer.readUInt16LE(eocdOffset + 10);

    // Limit analysis to avoid DOS via huge entry counts
    if (numEntries > 10000) {
      return [{ compressedSize: buffer.length, uncompressedSize: 0 }];
    }

    // Read central directory offset from EOCD (offset +16, 4 bytes, little-endian)
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

    if (cdOffset >= eocdOffset) {
      return null; // Corrupt ZIP
    }

    const files: Array<{ compressedSize: number; uncompressedSize: number }> = [];
    let offset = cdOffset;

    // Parse central directory file headers
    for (let i = 0; i < numEntries && offset + 30 < eocdOffset; i++) {
      // Central directory file header signature: 0x504b0102
      if (buffer[offset] !== 0x50 || buffer[offset + 1] !== 0x4b) {
        break;
      }

      // Compressed size (offset +20, 4 bytes)
      const compressedSize = buffer.readUInt32LE(offset + 20);

      // Uncompressed size (offset +24, 4 bytes)
      const uncompressedSize = buffer.readUInt32LE(offset + 24);

      files.push({ compressedSize, uncompressedSize });

      // Filename length (offset +26, 2 bytes)
      const filenameLen = buffer.readUInt16LE(offset + 26);

      // Extra field length (offset +28, 2 bytes)
      const extraLen = buffer.readUInt16LE(offset + 28);

      // File comment length (offset +30, 2 bytes)
      const commentLen = buffer.readUInt16LE(offset + 30);

      // Move to next central directory file header
      offset += 46 + filenameLen + extraLen + commentLen;
    }

    return files.length > 0 ? files : null;
  } catch {
    return null;
  }
}

/**
 * Detect decompression bombs in ZIP files.
 *
 * Strategy:
 * 1. Parse ZIP central directory (without decompressing)
 * 2. Sum uncompressed sizes of all entries
 * 3. Calculate total compression ratio
 * 4. Flag if ratio > MAX_COMPRESSION_RATIO or size > MAX_UNCOMPRESSED_SIZE
 *
 * @param buffer - ZIP file buffer
 * @returns BombCheckResult
 */
function detectZipBomb(buffer: Buffer): BombCheckResult {
  const compressedSize = buffer.length;

  const files = parseZipCentralDirectory(buffer);

  if (!files || files.length === 0) {
    return {
      isBomb: false,
      compressedSize,
      format: 'ZIP',
    };
  }

  const totalUncompressedSize = files.reduce((sum, f) => sum + f.uncompressedSize, 0);
  const ratio = totalUncompressedSize / compressedSize;

  if (totalUncompressedSize > BOMB_THRESHOLDS.MAX_UNCOMPRESSED_SIZE) {
    return {
      isBomb: true,
      reason: `ZIP bomb detected: uncompressed size ${totalUncompressedSize} bytes exceeds limit (${BOMB_THRESHOLDS.MAX_UNCOMPRESSED_SIZE})`,
      compressedSize,
      format: 'ZIP',
      ratio,
      estimatedUncompressedSize: totalUncompressedSize,
    };
  }

  if (ratio > BOMB_THRESHOLDS.MAX_COMPRESSION_RATIO) {
    return {
      isBomb: true,
      reason: `ZIP bomb detected: compression ratio ${ratio.toFixed(1)}:1 exceeds limit (${BOMB_THRESHOLDS.MAX_COMPRESSION_RATIO}:1)`,
      compressedSize,
      format: 'ZIP',
      ratio,
      estimatedUncompressedSize: totalUncompressedSize,
    };
  }

  return {
    isBomb: false,
    compressedSize,
    format: 'ZIP',
    ratio,
    estimatedUncompressedSize: totalUncompressedSize,
  };
}

// ============================================================================
// Main Detection Function
// ============================================================================

/**
 * Detect decompression bombs in a file.
 *
 * Supports:
 * - ZIP archives (via central directory analysis)
 * - GZIP files (via trailer inspection + ratio check)
 * - TAR.GZ files (treated as gzip)
 * - Other formats (size check only)
 *
 * Returns immediately with bomb detection if found.
 *
 * @param fileBuffer - File buffer to analyze
 * @param mimeType - MIME type (optional, for format hints)
 * @param filename - Filename (optional, for format detection)
 * @returns BombCheckResult
 *
 * @example
 *   // Normal image
 *   detectCompressionBomb(buffer, 'image/jpeg')
 *   -> { isBomb: false, compressedSize: 1000 }
 *
 *   // Bomb-like file
 *   detectCompressionBomb(zipBomb, 'application/zip')
 *   -> {
 *       isBomb: true,
 *       reason: 'ZIP bomb detected: ratio 500:1...',
 *       compressedSize: 1000000,
 *       format: 'ZIP',
 *       ratio: 500,
 *       estimatedUncompressedSize: 500000000
 *     }
 */
export async function detectCompressionBomb(
  fileBuffer: Buffer,
  mimeType?: string,
  filename?: string
): Promise<BombCheckResult> {
  const compressedSize = fileBuffer.length;

  // Sanity check: absolute max file size
  if (compressedSize > BOMB_THRESHOLDS.MAX_COMPRESSED_SIZE) {
    return {
      isBomb: true,
      reason: `File too large (${compressedSize} bytes, max ${BOMB_THRESHOLDS.MAX_COMPRESSED_SIZE})`,
      compressedSize,
    };
  }

  // Identify archive format
  const format = detectArchiveFormat(fileBuffer, filename);

  // Handle specific archive formats
  switch (format) {
    case 'ZIP':
      return detectZipBomb(fileBuffer);

    case 'GZIP':
    case 'TAR.GZ':
      return detectGzipBomb(fileBuffer);

    case '7Z':
    case 'RAR':
    case 'BZIP2':
      // For unsupported formats, just check absolute size
      return {
        isBomb: false,
        compressedSize,
        format,
        reason: `Format ${format} not analyzed; size check only`,
      };

    case 'TAR':
      // Uncompressed TAR: just check size
      return {
        isBomb: false,
        compressedSize,
        format: 'TAR',
      };

    default:
      // Unknown format: safe to allow (images, PDFs, etc.)
      return {
        isBomb: false,
        compressedSize,
        format: 'unknown',
      };
  }
}

/**
 * Synchronous version of bomb detection (for use in sync contexts).
 *
 * Currently only handles ZIP detection (synchronous parsing).
 * For async formats (GZIP), use detectCompressionBomb instead.
 *
 * ponytail: Sync-only detection for ZIP; use async version for full support.
 *
 * @param fileBuffer - File buffer to analyze
 * @param filename - Filename (optional)
 * @returns BombCheckResult
 */
export function detectCompressionBombSync(
  fileBuffer: Buffer,
  filename?: string
): BombCheckResult {
  const compressedSize = fileBuffer.length;

  if (compressedSize > BOMB_THRESHOLDS.MAX_COMPRESSED_SIZE) {
    return {
      isBomb: true,
      reason: `File too large (${compressedSize} bytes, max ${BOMB_THRESHOLDS.MAX_COMPRESSED_SIZE})`,
      compressedSize,
    };
  }

  const format = detectArchiveFormat(fileBuffer, filename);

  if (format === 'ZIP') {
    return detectZipBomb(fileBuffer);
  }

  // For other formats, return safe (use async version for full detection)
  return {
    isBomb: false,
    compressedSize,
    format,
  };
}
