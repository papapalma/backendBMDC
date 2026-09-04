/**
 * File Storage Migration Utility
 *
 * Implements Requirement 15.5:
 *   - Move all existing files from /uploads/ (flat structure) to
 *     /uploads/{default_tenant_id}/ (tenant-scoped structure)
 *   - Update database file_path references to include tenant_id prefix
 *   - Verify all file references are accessible after migration
 *
 * The default BMDC tenant ID is read from the BMDC_DEFAULT_TENANT_ID
 * environment variable (falls back to the seed value).
 *
 * Usage (run once during multi-tenant migration):
 *   import { migrateFilesToDefaultTenant } from '@/lib/fileMigration';
 *   await migrateFilesToDefaultTenant();
 */

import { promises as fs } from 'fs';
import path from 'path';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { UPLOAD_BASE_DIR, initTenantDirectories, validateTenantId } from '@/lib/fileStorage';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default BMDC tenant UUID — matches the seed file value.
 * Override via BMDC_DEFAULT_TENANT_ID env var.
 */
export const DEFAULT_TENANT_ID =
  process.env.BMDC_DEFAULT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationResult {
  /** Total files found in the legacy flat structure */
  totalFiles: number;
  /** Files successfully moved to the tenant directory */
  movedFiles: number;
  /** Files that were already in the tenant directory (skipped) */
  skippedFiles: number;
  /** Files that failed to move */
  failedFiles: number;
  /** DB rows updated with new tenant-scoped paths */
  dbRowsUpdated: number;
  /** Errors encountered during migration */
  errors: string[];
}

export interface VerificationResult {
  /** Total file_path references checked in the database */
  totalChecked: number;
  /** References that resolve to an existing file */
  accessible: number;
  /** References that point to a missing file */
  missing: number;
  /** List of missing file paths */
  missingPaths: string[];
}

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
      const nested = await listFilesRecursive(fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Determine the tenant-scoped destination path for a legacy file.
 *
 * Legacy layout:  /uploads/images/{category}/{filename}
 *                 /uploads/documents/{filename}
 *                 /uploads/qrcodes/{category}/{filename}
 *
 * New layout:     /uploads/{tenantId}/images/{category}/{filename}
 *                 /uploads/{tenantId}/documents/{category}/{filename}
 *                 /uploads/{tenantId}/qrcodes/{category}/{filename}
 *
 * Returns null if the path cannot be mapped (e.g. already migrated).
 */
function mapLegacyPathToTenantPath(
  absolutePath: string,
  tenantId: string
): { newAbsolutePath: string; newRelativePath: string } | null {
  // Normalise to forward slashes relative to UPLOAD_BASE_DIR

const relative = path
    .relative(UPLOAD_BASE_DIR, absolutePath)
    .replace(/\\/g, '/');

  // Skip files already inside a tenant directory (UUID at first segment)

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i;

if (UUID_REGEX.test(relative)) return null;

  // Skip the defaults directory

if (relative.startsWith('defaults/') || relative.startsWith('images/defaults/')) return null;

  // Skip .gitkeep and similar placeholder files

if (path.basename(absolutePath).startsWith('.')) return null;

  // Map legacy category paths to new tenant-scoped paths

let newRelative: string;

  if (relative.startsWith('images/')) {
    // /uploads/images/{category}/... → /uploads/{tenantId}/images/{category}/...
    newRelative = `${tenantId}/${relative}`;
  } else if (relative.startsWith('documents/')) {
    // /uploads/documents/{filename} → /uploads/{tenantId}/documents/programs/{filename}
    // (default sub-type: programs — can be refined per file naming convention)

const filename = relative.replace('documents/', '');
    if (filename.includes('/')) {
      // Already has a sub-directory — preserve it
      newRelative = `${tenantId}/documents/${filename}`;
    } else {
      newRelative = `${tenantId}/documents/programs/${filename}`;
    }
  } else if (relative.startsWith('qrcodes/')) {
    newRelative = `${tenantId}/${relative}`;
  } else {
    // Unknown top-level directory — skip

return null;
  }

  return {
    newAbsolutePath: path.join(UPLOAD_BASE_DIR, newRelative),
    newRelativePath: `/uploads/${newRelative}`,
  };
}

// ---------------------------------------------------------------------------
// Tables and columns that store file paths
// ---------------------------------------------------------------------------

interface FilePathColumn {
  table: string;
  columns: string[];
}

const FILE_PATH_COLUMNS: FilePathColumn[] = [
  { table: 'programs',  columns: ['image_path', 'thumbnail_path'] },
  { table: 'trainees',  columns: ['photo_path', 'thumbnail_path', 'qr_code_path'] },
  { table: 'items',     columns: ['image_path', 'thumbnail_path', 'qr_code_path'] },
  { table: 'certificates', columns: ['file_path', 'qr_code_path'] },
];

// ---------------------------------------------------------------------------
// Core migration function
// ---------------------------------------------------------------------------

/**
 * Migrate all existing flat-structure files to the default tenant directory.
 *
 * Steps:
 *   1. Ensure tenant directories exist
 *   2. Walk the legacy /uploads/ tree and move files
 *   3. Update all database file_path columns to use the new tenant-scoped paths
 *
 * This function is idempotent — files already in the tenant directory are
 * skipped, and DB rows already using tenant-scoped paths are not re-updated.
 *
 * @param tenantId - Target tenant UUID (defaults to DEFAULT_TENANT_ID)
 * @param dryRun   - If true, log what would happen without making changes
 */
export async function migrateFilesToDefaultTenant(
  tenantId: string = DEFAULT_TENANT_ID,
  dryRun = false
): Promise<MigrationResult> {
  validateTenantId(tenantId);

  const result: MigrationResult = {
    totalFiles: 0,
    movedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    dbRowsUpdated: 0,
    errors: [],
  };

  logger.info('[FILE_MIGRATION] Starting file migration', { tenantId, dryRun });

  // ── Step 1: Ensure tenant directories exist ──────────────────────────────

if (!dryRun) {
    await initTenantDirectories(tenantId);
  }

  // ── Step 2: Walk legacy upload tree and move files ───────────────────────

const allFiles = await listFilesRecursive(UPLOAD_BASE_DIR);
  result.totalFiles = allFiles.length;

  for (const absolutePath of allFiles) {
    const mapped = mapLegacyPathToTenantPath(absolutePath, tenantId);

    if (!mapped) {
      result.skippedFiles++;
      continue;
    }

const { newAbsolutePath, newRelativePath } = mapped;

    // Check if destination already exists
    try {
      await fs.access(newAbsolutePath);
      // File already migrated
      result.skippedFiles++;
      continue;
    } catch {
      // Destination does not exist — proceed with move
    }

if (dryRun) {
      logger.info('[FILE_MIGRATION] [DRY RUN] Would move', {
        from: absolutePath,
        to: newAbsolutePath,
      });
      result.movedFiles++;
      continue;
    }

    try {
      // Ensure destination directory exists

await fs.mkdir(path.dirname(newAbsolutePath), { recursive: true });
      // Copy then delete (rename fails across different filesystems)

await fs.copyFile(absolutePath, newAbsolutePath);
      await fs.unlink(absolutePath);
      result.movedFiles++;

      logger.debug('[FILE_MIGRATION] Moved file', {
        from: absolutePath,
        to: newRelativePath,
      });
    } catch (err) {
      result.failedFiles++;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to move ${absolutePath}: ${msg}`);
      logger.error('[FILE_MIGRATION] Failed to move file', { absolutePath, error: msg });
    }
  }

  // ── Step 3: Update database file_path references ─────────────────────────

if (!dryRun) {
    result.dbRowsUpdated = await updateDatabasePaths(tenantId);
  }

  logger.info('[FILE_MIGRATION] Migration complete', result);
  return result;
}

/**
 * Update all database file_path columns to use tenant-scoped paths.
 *
 * Finds rows where the path starts with /uploads/ but does NOT already
 * contain the tenant_id, and prepends the tenant directory.
 *
 * @returns Total number of column values updated across all tables.
 */
async function updateDatabasePaths(tenantId: string): Promise<number> {
  let totalUpdated = 0;

  for (const { table, columns } of FILE_PATH_COLUMNS) {
    for (const column of columns) {
      try {
        // Fetch rows where the column has a legacy path (no tenant UUID prefix)

const { data, error } = await supabaseAdmin
          .from(table)
          .select(`id, ${column}`)
          .not(column, 'is', null)
          .like(column, '/uploads/%')
          .not(column, 'like', `/uploads/${tenantId}/%`);

        if (error) {
          logger.warn('[FILE_MIGRATION] DB query error', { table, column, error });
          continue;
        }

if (!data || data.length === 0) continue;

        for (const row of data) {
          const oldPath = row[column] as string;
          if (!oldPath) continue;

          // Build new path: /uploads/{tenantId}/rest-of-path

const withoutPrefix = oldPath.replace(/^\/uploads\//, '');

const newPath = `/uploads/${tenantId}/${withoutPrefix}`;

          const { error: updateError } = await supabaseAdmin
            .from(table)
            .update({ [column]: newPath })
            .eq('id', row.id);

          if (updateError) {
            logger.warn('[FILE_MIGRATION] DB update error', {
              table,
              column,
              id: row.id,
              error: updateError,
            });
          } else {
            totalUpdated++;
            logger.debug('[FILE_MIGRATION] Updated DB path', {
              table,
              column,
              id: row.id,
              oldPath,
              newPath,
            });
          }
        }
      } catch (err) {
        logger.error('[FILE_MIGRATION] Unexpected error updating DB paths', {
          table,
          column,
          error: err,
        });
      }
    }
  }

  return totalUpdated;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify that all file_path references in the database point to existing files.
 *
 * @param tenantId - Tenant UUID to scope the check (optional — checks all if omitted)
 */
export async function verifyFileMigration(tenantId?: string): Promise<VerificationResult> {
  const result: VerificationResult = {
    totalChecked: 0,
    accessible: 0,
    missing: 0,
    missingPaths: [],
  };

  for (const { table, columns } of FILE_PATH_COLUMNS) {
    for (const column of columns) {
      try {
        let query = supabaseAdmin
          .from(table)
          .select(`id, ${column}`)
          .not(column, 'is', null);

        if (tenantId) {
          query = query.eq('tenant_id', tenantId);
        }

const { data, error } = await query;

        if (error || !data) continue;

        for (const row of data) {
          const relativePath = row[column] as string;
          if (!relativePath) continue;

          result.totalChecked++;

          // Convert relative path to absolute

const normalised = relativePath.replace(/^\/+/, '');
          const absolutePath = path.join(process.cwd(), 'public', normalised);

          try {
            await fs.access(absolutePath);
            result.accessible++;
          } catch {
            result.missing++;
            result.missingPaths.push(relativePath);
            logger.warn('[FILE_MIGRATION] Missing file reference', {
              table,
              column,
              id: row.id,
              relativePath,
            });
          }
        }
      } catch (err) {
        logger.error('[FILE_MIGRATION] Verification error', { table, column, error: err });
      }
    }
  }

  logger.info('[FILE_MIGRATION] Verification complete', {
    totalChecked: result.totalChecked,
    accessible: result.accessible,
    missing: result.missing,
  });

  return result;
}
