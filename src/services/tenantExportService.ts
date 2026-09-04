/**
 * Tenant Data Export Service
 *
 * Implements Requirements 20.1–20.4:
 *   - 20.1  Full data export: programs, trainees, enrollments, attendance,
 *           inventory, certificates — in JSON format with file references
 *   - 20.2  Generate export archive (ZIP) containing JSON data
 *   - 20.3  Store export file in tenant-specific directory with 7-day expiry
 *   - 20.4  Provide download link; log export request to audit_logs
 *
 * ZIP format: pure-JS implementation using Node's built-in zlib (DEFLATE).
 * No external ZIP library required.
 *
 * Archive layout:
 *   export-{tenantId}-{timestamp}/
 *     manifest.json          — export metadata
 *     programs.json
 *     trainees.json
 *     enrollments.json
 *     attendance.json
 *     items.json
 *     certificates.json
 */

import { promises as fs } from 'fs';
import path from 'path';
import { deflateRawSync } from 'zlib';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { UPLOAD_BASE_DIR } from '@/lib/fileStorage';
import { writeAuditLog, AuditAction } from '@/lib/auditLog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportResult {
  exportId: string;
  tenantId: string;
  filePath: string;
  downloadUrl: string;
  expiresAt: string;
  fileSizeBytes: number;
  recordCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Minimal ZIP builder (no external dependency)
// ---------------------------------------------------------------------------

interface ZipEntry {
  filename: string;
  data: Buffer;
}

/**
 * Build a valid ZIP archive from an array of in-memory entries.
 *
 * Uses DEFLATE compression via Node's built-in zlib.
 * Produces a standard ZIP file compatible with all ZIP tools.
 */
function buildZip(entries: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralDirs: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes   = Buffer.from(entry.filename, 'utf8');
    const compressed  = deflateRawSync(entry.data, { level: 6 });
    const crc         = crc32(entry.data);
    const now         = new Date();
    const dosDate     = dosDateTime(now);

    // Local file header (30 bytes + filename)

const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);  // signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(8, 8);            // compression: DEFLATE
    local.writeUInt16LE(dosDate.time, 10);
    local.writeUInt16LE(dosDate.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length
    nameBytes.copy(local, 30);

    localHeaders.push(local);
    localHeaders.push(compressed);

    // Central directory entry (46 bytes + filename)

const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0, 8);           // flags
    central.writeUInt16LE(8, 10);          // compression
    central.writeUInt16LE(dosDate.time, 12);
    central.writeUInt16LE(dosDate.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);          // extra
    central.writeUInt16LE(0, 32);          // comment
    central.writeUInt16LE(0, 34);          // disk start
    central.writeUInt16LE(0, 36);          // internal attr
    central.writeUInt32LE(0, 38);          // external attr
    central.writeUInt32LE(offset, 42);     // local header offset
    nameBytes.copy(central, 46);

    centralDirs.push(central);
    offset += local.length + compressed.length;
  }

const centralStart = offset;
  const centralBuf   = Buffer.concat(centralDirs);

  // End of central directory record (22 bytes)

const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, centralBuf, eocd]);
}

/** CRC-32 implementation (IEEE polynomial) */
function crc32(buf: Buffer): number {
  const table = makeCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let _crcTable: Uint32Array | null = null;
function makeCrcTable(): Uint32Array {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    _crcTable[n] = c;
  }
  return _crcTable;
}

function dosDateTime(d: Date): { date: number; time: number } {
  const date =
    ((d.getFullYear() - 1980) << 9) |
    ((d.getMonth() + 1) << 5) |
    d.getDate();
  const time =
    (d.getHours() << 11) |
    (d.getMinutes() << 5) |
    Math.floor(d.getSeconds() / 2);
  return { date, time };
}

// ---------------------------------------------------------------------------
// Data collection helpers
// ---------------------------------------------------------------------------

async function fetchPrograms(tenantId: string) {
  const { data, error } = await supabaseAdmin
    .from('programs')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

async function fetchTrainees(tenantId: string) {
  const { data, error } = await supabaseAdmin
    .from('trainees')
    .select('id, first_name, last_name, middle_name, email, phone, sex, birth_date, birth_place, civil_status, province, municipality, barangay, street, educational_attainment, course, year_graduated, classification, disability, employment_status, program_id, qr_code, photo_path, status, enrollment_date, consent_given, consent_version, created_at, updated_at, tenant_id')
    .eq('tenant_id', tenantId)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

async function fetchEnrollments(tenantId: string) {
  const { data, error } = await supabaseAdmin
    .from('enrollments')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

async function fetchAttendance(tenantId: string) {
  const { data, error } = await supabaseAdmin
    .from('attendance')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

async function fetchItems(tenantId: string) {
  const { data, error } = await supabaseAdmin
    .from('items')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

async function fetchCertificates(tenantId: string) {
  const { data, error } = await supabaseAdmin
    .from('certificates')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Export directory management
// ---------------------------------------------------------------------------

/** Exports are stored under uploads/{tenantId}/exports/ */
function getExportDir(tenantId: string): string {
  return path.join(UPLOAD_BASE_DIR, tenantId, 'exports');
}

/**
 * Delete export files older than 7 days (Req 20.3).
 * Called before generating a new export to keep the directory clean.
 */
async function purgeExpiredExports(tenantId: string): Promise<void> {
  const exportDir = getExportDir(tenantId);
  try {
    const files = await fs.readdir(exportDir);
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const filePath = path.join(exportDir, file);
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        logger.info('[EXPORT] Purged expired export file', { file });
      }
    }
  } catch {
    // Directory may not exist yet — that's fine
  }
}

// ---------------------------------------------------------------------------
// Core export function (Req 20.1–20.4)
// ---------------------------------------------------------------------------

/**
 * Generate a full tenant data export as a ZIP archive.
 *
 * Steps:
 *   1. Fetch all tenant data in parallel
 *   2. Build ZIP archive with JSON files
 *   3. Store in tenant-specific exports directory with 7-day expiry
 *   4. Log to audit_logs
 *   5. Return download URL and metadata
 */
export async function generateTenantExport(params: {
  tenantId: string;
  requestedBy: string;
}): Promise<ExportResult> {
  const { tenantId, requestedBy } = params;
  const exportId  = `export-${tenantId.replace(/-/g, '').substring(0, 8)}-${Date.now()}`;
  const backendUrl = (process.env.BACKEND_URL ?? 'http://localhost:3001').replace(/\/$/, '');

  logger.info('[EXPORT] Starting tenant data export', { tenantId, exportId });

  // ── 1. Fetch all data in parallel (Req 20.1) ─────────────────────────────

const [programs, trainees, enrollments, attendance, items, certificates] =
    await Promise.all([
      fetchPrograms(tenantId),
      fetchTrainees(tenantId),
      fetchEnrollments(tenantId),
      fetchAttendance(tenantId),
      fetchItems(tenantId),
      fetchCertificates(tenantId),
    ]);

  const recordCounts = {
    programs:     programs.length,
    trainees:     trainees.length,
    enrollments:  enrollments.length,
    attendance:   attendance.length,
    items:        items.length,
    certificates: certificates.length,
  };

  // ── 2. Build manifest ─────────────────────────────────────────────────────

const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const manifest = {
    exportId,
    tenantId,
    generatedAt: new Date().toISOString(),
    expiresAt,
    generatedBy: requestedBy,
    recordCounts,
    files: [
      'manifest.json',
      'programs.json',
      'trainees.json',
      'enrollments.json',
      'attendance.json',
      'items.json',
      'certificates.json',
    ],
    note: 'File paths in records are relative to the backend uploads directory. Download URLs are included where available.',
  };

  // ── 3. Build ZIP entries (Req 20.2) ───────────────────────────────────────

const dir = `${exportId}/`;
  const entries: ZipEntry[] = [
    { filename: `${dir}manifest.json`,    data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { filename: `${dir}programs.json`,    data: Buffer.from(JSON.stringify(programs, null, 2)) },
    { filename: `${dir}trainees.json`,    data: Buffer.from(JSON.stringify(trainees, null, 2)) },
    { filename: `${dir}enrollments.json`, data: Buffer.from(JSON.stringify(enrollments, null, 2)) },
    { filename: `${dir}attendance.json`,  data: Buffer.from(JSON.stringify(attendance, null, 2)) },
    { filename: `${dir}items.json`,       data: Buffer.from(JSON.stringify(items, null, 2)) },
    { filename: `${dir}certificates.json`,data: Buffer.from(JSON.stringify(certificates, null, 2)) },
  ];

  const zipBuffer = buildZip(entries);

  // ── 4. Store ZIP in tenant exports directory (Req 20.3) ───────────────────

const exportDir  = getExportDir(tenantId);
  await fs.mkdir(exportDir, { recursive: true });
  await purgeExpiredExports(tenantId);

  const filename    = `${exportId}.zip`;
  const absolutePath = path.join(exportDir, filename);
  await fs.writeFile(absolutePath, zipBuffer);

  const relativePath = `/uploads/${tenantId}/exports/${filename}`;
  const downloadUrl  = `${backendUrl}${relativePath}`;

  // ── 5. Log to audit_logs (Req 20.4) ──────────────────────────────────────

await writeAuditLog({
    tenantId,
    userId:     requestedBy,
    action:     AuditAction.DATA_EXPORT,
    entityType: 'tenant_export',
    entityId:   null,
    details: {
      export_id:    exportId,
      record_counts: recordCounts,
      file_size_bytes: zipBuffer.length,
      expires_at:   expiresAt,
    },
  });

  logger.info('[EXPORT] Export complete', {
    tenantId,
    exportId,
    fileSizeBytes: zipBuffer.length,
    recordCounts,
  });

  return {
    exportId,
    tenantId,
    filePath:      relativePath,
    downloadUrl,
    expiresAt,
    fileSizeBytes: zipBuffer.length,
    recordCounts,
  };
}

// ---------------------------------------------------------------------------
// List existing exports for a tenant
// ---------------------------------------------------------------------------

export interface ExportFileInfo {
  filename: string;
  downloadUrl: string;
  createdAt: string;
  expiresAt: string;
  fileSizeBytes: number;
}

/**
 * List all non-expired export files for a tenant.
 */
export async function listTenantExports(tenantId: string): Promise<ExportFileInfo[]> {
  const exportDir  = getExportDir(tenantId);
  const backendUrl = (process.env.BACKEND_URL ?? 'http://localhost:3001').replace(/\/$/, '');

const cutoff     = Date.now() - 7 * 24 * 60 * 60 * 1000;

  try {
    const files = await fs.readdir(exportDir);
    const results: ExportFileInfo[] = [];

    for (const file of files) {
      if (!file.endsWith('.zip')) continue;
      const filePath = path.join(exportDir, file);
      const stat     = await fs.stat(filePath);
      if (stat.mtimeMs < cutoff) continue; // expired

      results.push({
        filename:      file,
        downloadUrl:   `${backendUrl}/uploads/${tenantId}/exports/${file}`,
        createdAt:     new Date(stat.mtimeMs).toISOString(),
        expiresAt:     new Date(stat.mtimeMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
        fileSizeBytes: stat.size,
      });
    }

    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}
