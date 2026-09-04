/**
 * File Cleanup Utility
 *
 * Implements Requirement 15.9:
 *   - Identify orphaned files not referenced in the database
 *   - Provide a scheduled job for cleaning up orphaned files
 *   - Log all file deletion operations to audit_logs
 *
 * An "orphaned" file is one that exists on disk under /uploads/{tenant_id}/
 * but whose relative path does not appear in any file_path column in the
 * database.
 *
 * Usage:
 *   // One-off scan (dry run)
 *   const report = await findOrphanedFiles({ dryRun: true });
 *
 *   // Scheduled cleanup (e.g. from a cron API route)
 *   const report = await cleanupOrphanedFiles({ tenantId: 'abc-123' });
 */

import { promises as fs } from 'fs';
import path from 'path';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { UPLOAD_BASE_DIR } from '@/lib/fileStorage';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CleanupOptions {
  /** Restrict cleanup to a specific tenant (scans all tenants if omitted) */
  tenantId?: string;
  /**
   * If true, log what would be deleted without actually deleting anything.
   * Defaults to false.
   */
  dryRun?: boolean;
  /**
   * Minimum age in hours before an unreferenced file is considered orphaned.
   * Prevents deleting files that were just uploaded but not yet saved to DB.
   * Defaults to 24 hours.
   */
  minAgeHours?: number;
}

export interface CleanupReport {
  /** Total files scanned on disk */
  totalScanned: number;
  /** Files that are referenced in the database */
  referencedFiles: number;
  /** Files identified as orphaned */
  orphanedFiles: number;
  /** Orphaned files that were deleted (0 in dry-run mode) */
  deletedFiles: number;
  /** Files that failed to delete */
  failedDeletions: number;
  /** List of orphaned file paths (relative) */
  orphanedPaths: string[];
  /** Errors encountered */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Tables and columns that store file paths
// ---------------------------------------------------------------------------

const FILE_PATH_COLUMNS: Array<{ table: string; columns: string[] }> = [
  { table: 'programs',      columns: ['image_path', 'thumbnail_path'] },
  { table: 'trainees',      columns: ['photo_path', 'thumbnail_path', 'qr_code_path'] },
  { table: 'items',         columns: ['image_path', 'thumbnail_path', 'qr_code_path'] },
  { table: 'certificates',  columns: ['file_path', 'qr_code_path'] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively list all files under a directory.
 * Returns absolute paths.
 */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import('fs').Dirent[];

  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursive(fullPath)));
    } else if (entry.isFile() && !entry.name.startsWith('.')) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Convert an absolute path under UPLOAD_BASE_DIR to a relative path
 * suitable for comparison with database values.
 *
 * e.g. /…/public/uploads/abc-123/images/items/photo.jpg
 *   →  /uploads/abc-123/images/items/photo.jpg
 */
function toRelativePath(absolutePath: string): string {
  const relative = path.relative(path.join(process.cwd(), 'public'), absolutePath);
  return '/' + relative.replace(/\\/g, '/');
}

/**
 * Fetch all file path values currently stored in the database.
 * Returns a Set of normalised relative paths for O(1) lookup.
 */
async function fetchAllDatabasePaths(tenantId?: string): Promise<Set<string>> {
  const allPaths = new Set<string>();

  for (const { table, columns } of FILE_PATH_COLUMNS) {
    for (const column of columns) {
      try {
        let query = supabaseAdmin
          .from(table)
          .select(column)
          .not(column, 'is', null);

        if (tenantId) {
          query = query.eq('tenant_id', tenantId);
        }

const { data, error } = await query;

        if (error || !data) continue;

        for (const row of data) {
          const value = row[column] as string | null;
          if (value) {
            // Normalise: ensure leading slash, forward slashes

const normalised = ('/' + value.replace(/\\/g, '/').replace(/^\/+/, ''));
            allPaths.add(normalised);
          }
        }
      } catch (err) {
        logger.error('[FILE_CLEANUP] Error fetching DB paths', { table, column, error: err });
      }
    }
  }

  return allPaths;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Scan the upload directory and identify files not referenced in the database.
 *
 * @param options - Cleanup options (tenantId, dryRun, minAgeHours)
 * @returns A report of orphaned files found (and deleted if not dry-run)
 */
export async function findOrphanedFiles(options: CleanupOptions = {}): Promise<CleanupReport> {
  const { tenantId, dryRun = true, minAgeHours = 24 } = options;

  const report: CleanupReport = {
    totalScanned: 0,
    referencedFiles: 0,
    orphanedFiles: 0,
    deletedFiles: 0,
    failedDeletions: 0,
    orphanedPaths: [],
    errors: [],
  };

  logger.info('[FILE_CLEANUP] Starting orphan scan', { tenantId, dryRun, minAgeHours });

  // ── 1. Determine scan root ────────────────────────────────────────────────

const scanRoot = tenantId
    ? path.join(UPLOAD_BASE_DIR, tenantId)
    : UPLOAD_BASE_DIR;

  // ── 2. List all files on disk ─────────────────────────────────────────────

const diskFiles = await listFilesRecursive(scanRoot);
  report.totalScanned = diskFiles.length;

  // ── 3. Fetch all DB-referenced paths ─────────────────────────────────────

const dbPaths = await fetchAllDatabasePaths(tenantId);

  // ── 4. Find orphans ───────────────────────────────────────────────────────

const now = Date.now();
  const minAgeMs = minAgeHours * 60 * 60 * 1000;

  for (const absolutePath of diskFiles) {
    const relativePath = toRelativePath(absolutePath);

    // Skip the defaults directory

if (relativePath.includes('/uploads/images/defaults/') || relativePath.includes('/defaults/')) {
      report.referencedFiles++;
      continue;
    }

if (dbPaths.has(relativePath)) {
      report.referencedFiles++;
      continue;
    }

    // Check file age — skip recently created files
    try {
      const stat = await fs.stat(absolutePath);
      const ageMs = now - stat.mtimeMs;
      if (ageMs < minAgeMs) {
        // Too new — might still be in-flight
        report.referencedFiles++;
        continue;
      }
    } catch {
      // Can't stat — skip
      continue;
    }

    report.orphanedFiles++;
    report.orphanedPaths.push(relativePath);

    if (!dryRun) {
      try {
        await fs.unlink(absolutePath);
        report.deletedFiles++;

        // Log deletion to audit_logs (Req 15.9)

await logFileDeletion(relativePath, tenantId);

        logger.info('[FILE_CLEANUP] Deleted orphaned file', { relativePath });
      } catch (err) {
        report.failedDeletions++;
        const msg = err instanceof Error ? err.message : String(err);
        report.errors.push(`Failed to delete ${relativePath}: ${msg}`);
        logger.error('[FILE_CLEANUP] Failed to delete orphaned file', {
          relativePath,
          error: msg,
        });
      }
    } else {
      logger.info('[FILE_CLEANUP] [DRY RUN] Would delete orphaned file', { relativePath });
    }
  }

  logger.info('[FILE_CLEANUP] Orphan scan complete', {
    totalScanned:    report.totalScanned,
    referencedFiles: report.referencedFiles,
    orphanedFiles:   report.orphanedFiles,
    deletedFiles:    report.deletedFiles,
    dryRun,
  });

  return report;
}

/**
 * Convenience wrapper that runs the cleanup with dryRun=false.
 * Intended for use in scheduled jobs.
 *
 * @param options - Cleanup options (tenantId, minAgeHours)
 */
export async function cleanupOrphanedFiles(
  options: Omit<CleanupOptions, 'dryRun'> = {}
): Promise<CleanupReport> {
  return findOrphanedFiles({ ...options, dryRun: false });
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

/**
 * Write a file deletion event to the audit_logs table.
 * Non-fatal — errors are logged but do not propagate.
 */
async function logFileDeletion(filePath: string, tenantId?: string): Promise<void> {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      tenant_id:   tenantId ?? null,
      user_id:     null,
      action:      'file_deleted',
      entity_type: 'file',
      entity_id:   null,
      details:     { file_path: filePath, reason: 'orphaned_cleanup' },
      ip_address:  null,
      user_agent:  'system/file-cleanup',
    });
  } catch (err) {
    logger.warn('[FILE_CLEANUP] Failed to write audit log for file deletion', {
      filePath,
      error: err,
    });
  }
}
