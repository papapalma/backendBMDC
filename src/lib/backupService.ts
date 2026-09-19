/**
 * Automated Database Backup Service
 *
 * Implements Requirement 20.5:
 *   - Daily scheduled database backup
 *   - Backups stored in secure location with encryption (AES-256-GCM)
 *   - 30-day retention policy
 *   - Backup restoration documentation
 *
 * Architecture:
 *   Since Next.js does not have a built-in cron scheduler, backups are
 *   triggered via a dedicated API endpoint that should be called by an
 *   external scheduler (e.g. Supabase Edge Functions cron, GitHub Actions,
 *   system cron, or a cloud scheduler like AWS EventBridge).
 *
 *   Endpoint: POST /api/admin/backup/trigger
 *   Protected by: BACKUP_SECRET_KEY environment variable
 *
 * Backup strategy:
 *   - Uses Supabase's built-in Point-in-Time Recovery (PITR) for the primary
 *     database backup (configured in Supabase dashboard)
 *   - This service creates a supplementary JSON snapshot of all tenant data
 *     for application-level restore capability
 *   - Snapshots are encrypted with AES-256-GCM before writing to disk
 *
 * Environment variables:
 *   BACKUP_SECRET_KEY     — secret for authenticating backup trigger requests
 *   BACKUP_RETENTION_DAYS — number of days to keep backups (default: 30)
 *   FILE_ENCRYPTION_KEY   — used to encrypt backup files at rest
 *
 * Restoration process:
 *   1. Locate the backup file in public/backups/YYYY-MM-DD/
 *   2. Decrypt using: node scripts/restore-backup.js <backup-file>
 *   3. The script will parse the JSON and re-insert records via Supabase Admin API
 *   4. Verify data integrity after restoration
 *   See: docs/backup-restoration.md for detailed steps
 */

import { promises as fs } from 'fs';
import path from 'path';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { maybeEncrypt } from '@/lib/fileEncryption';
import { writeAuditLog } from '@/lib/auditLog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Backup storage directory (outside public/ to prevent direct web access) */
const BACKUP_BASE_DIR = path.join(process.cwd(), 'backups');

/** Default retention: 30 days (Req 20.5) */
const DEFAULT_RETENTION_DAYS = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupResult {
  backupId: string;
  filename: string;
  filePath: string;
  fileSizeBytes: number;
  encrypted: boolean;
  tenantCount: number;
  recordCounts: Record<string, number>;
  createdAt: string;
  expiresAt: string;
}

export interface BackupManifest {
  backupId: string;
  createdAt: string;
  expiresAt: string;
  encrypted: boolean;
  tenantCount: number;
  recordCounts: Record<string, number>;
  supabaseProjectRef: string;
  restorationInstructions: string;
}

// ---------------------------------------------------------------------------
// Backup directory helpers
// ---------------------------------------------------------------------------

function getBackupDir(date: Date): string {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(BACKUP_BASE_DIR, dateStr);
}

/**
 * Purge backup directories older than the retention period (Req 20.5).
 */
async function purgeExpiredBackups(): Promise<number> {
  const retentionDays = parseInt(
    process.env.BACKUP_RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS),
    10
  );
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let purgedCount = 0;

  try {
    const entries = await fs.readdir(BACKUP_BASE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(BACKUP_BASE_DIR, entry.name);
      const stat    = await fs.stat(dirPath);
      if (stat.mtimeMs < cutoff) {
        await fs.rm(dirPath, { recursive: true, force: true });
        purgedCount++;
        logger.info('[BACKUP] Purged expired backup directory', { dir: entry.name });
      }
    }
  } catch {
    // BACKUP_BASE_DIR may not exist yet
  }

  return purgedCount;
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

async function collectAllTenantData(): Promise<{
  tenants: unknown[];
  programs: unknown[];
  trainees: unknown[];
  enrollments: unknown[];
  attendance: unknown[];
  items: unknown[];
  certificates: unknown[];
  feature_flags: unknown[];
  audit_logs_sample: unknown[];
}> {
  const [
    tenants,
    programs,
    trainees,
    enrollments,
    attendance,
    items,
    certificates,
    featureFlags,
    auditLogsSample,
  ] = await Promise.all([
    supabaseAdmin.from('tenants').select('*').order('created_at'),
    supabaseAdmin.from('programs').select('*').order('created_at'),
    // Exclude PII from backup snapshot — use anonymized fields
    // NOTE: program_id and enrollment_date are NOT on trainees table (normalized schema)
    // They are stored in enrollments table and will be backed up separately
    supabaseAdmin.from('trainees').select('id, tenant_id, status, consent_given, consent_version, created_at, updated_at').order('created_at'),
    supabaseAdmin.from('enrollments').select('*').order('created_at'),
    supabaseAdmin.from('attendance').select('*').order('created_at'),
    supabaseAdmin.from('items').select('*').order('created_at'),
    supabaseAdmin.from('certificates').select('*').order('created_at'),
    supabaseAdmin.from('feature_flags').select('*').order('created_at'),
    // Only last 1000 audit log entries in backup (full logs are in Supabase PITR)
    supabaseAdmin.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(1000),
  ]);

  return {
    tenants:          tenants.data  ?? [],
    programs:         programs.data ?? [],
    trainees:         trainees.data ?? [],
    enrollments:      enrollments.data ?? [],
    attendance:       attendance.data  ?? [],
    items:            items.data       ?? [],
    certificates:     certificates.data ?? [],
    feature_flags:    featureFlags.data ?? [],
    audit_logs_sample: auditLogsSample.data ?? [],
  };
}

// ---------------------------------------------------------------------------
// Core backup function (Req 20.5)
// ---------------------------------------------------------------------------

/**
 * Create a full database snapshot backup.
 *
 * The backup is:
 *   1. Collected from all tables via Supabase Admin API
 *   2. Serialized to JSON
 *   3. Encrypted with AES-256-GCM (if FILE_ENCRYPTION_ENABLED=true)
 *   4. Written to backups/YYYY-MM-DD/backup-{id}.json[.enc]
 *   5. Logged to audit_logs
 *
 * Note: For production, enable Supabase PITR (Point-in-Time Recovery) in the
 * Supabase dashboard as the primary backup mechanism. This service provides
 * a supplementary application-level snapshot.
 */
export async function createBackup(): Promise<BackupResult> {
  const backupId  = `backup-${Date.now()}`;
  const now       = new Date();
  const backupDir = getBackupDir(now);

  logger.info('[BACKUP] Starting database backup', { backupId });

  // ── 1. Purge expired backups ──────────────────────────────────────────────
  const purged = await purgeExpiredBackups();
  if (purged > 0) {
    logger.info('[BACKUP] Purged expired backups', { count: purged });
  }

  // ── 2. Collect all data ───────────────────────────────────────────────────
  const data = await collectAllTenantData();

  const recordCounts: Record<string, number> = {
    tenants:          (data.tenants as unknown[]).length,
    programs:         (data.programs as unknown[]).length,
    trainees:         (data.trainees as unknown[]).length,
    enrollments:      (data.enrollments as unknown[]).length,
    attendance:       (data.attendance as unknown[]).length,
    items:            (data.items as unknown[]).length,
    certificates:     (data.certificates as unknown[]).length,
    feature_flags:    (data.feature_flags as unknown[]).length,
    audit_logs_sample:(data.audit_logs_sample as unknown[]).length,
  };

  const retentionDays = parseInt(
    process.env.BACKUP_RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS),
    10
  );
  const expiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const manifest: BackupManifest = {
    backupId,
    createdAt: now.toISOString(),
    expiresAt,
    encrypted: process.env.FILE_ENCRYPTION_ENABLED === 'true',
    tenantCount: (data.tenants as unknown[]).length,
    recordCounts,
    supabaseProjectRef: process.env.NEXT_PUBLIC_SUPABASE_URL?.split('.')[0]?.replace('https://', '') ?? 'unknown',
    restorationInstructions:
      'To restore: decrypt the file (if encrypted), then run: ' +
      'node scripts/restore-backup.js <backup-file>. ' +
      'See docs/backup-restoration.md for detailed steps.',
  };

  const payload = JSON.stringify({ manifest, data }, null, 2);
  let fileBuffer = Buffer.from(payload, 'utf8');
  const encrypted = process.env.FILE_ENCRYPTION_ENABLED === 'true';

  // ── 3. Encrypt if enabled (Req 20.5) ─────────────────────────────────────
  if (encrypted) {
    fileBuffer = maybeEncrypt(fileBuffer) as any;
  }

  // ── 4. Write to disk ──────────────────────────────────────────────────────
  await fs.mkdir(backupDir, { recursive: true });
  const filename     = `${backupId}${encrypted ? '.json.enc' : '.json'}`;
  const absolutePath = path.join(backupDir, filename);
  await fs.writeFile(absolutePath, fileBuffer);

  // ── 5. Log to audit_logs ──────────────────────────────────────────────────
  await writeAuditLog({
    tenantId:   null,
    userId:     null,
    action:     'system.backup_created',
    entityType: 'backup',
    entityId:   null,
    details: {
      backup_id:       backupId,
      filename,
      file_size_bytes: fileBuffer.length,
      encrypted,
      record_counts:   recordCounts,
      expires_at:      expiresAt,
    },
  });

  logger.info('[BACKUP] Backup complete', {
    backupId,
    filename,
    fileSizeBytes: fileBuffer.length,
    encrypted,
    recordCounts,
  });

  return {
    backupId,
    filename,
    filePath:      absolutePath,
    fileSizeBytes: fileBuffer.length,
    encrypted,
    tenantCount:   (data.tenants as unknown[]).length,
    recordCounts,
    createdAt:     now.toISOString(),
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// List existing backups
// ---------------------------------------------------------------------------

export interface BackupFileInfo {
  backupId: string;
  filename: string;
  date: string;
  fileSizeBytes: number;
  encrypted: boolean;
  createdAt: string;
  expiresAt: string;
}

/**
 * List all non-expired backup files.
 */
export async function listBackups(): Promise<BackupFileInfo[]> {
  const retentionDays = parseInt(
    process.env.BACKUP_RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS),
    10
  );
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const results: BackupFileInfo[] = [];

  try {
    const dateDirs = await fs.readdir(BACKUP_BASE_DIR, { withFileTypes: true });
    for (const dateDir of dateDirs) {
      if (!dateDir.isDirectory()) continue;
      const dirPath = path.join(BACKUP_BASE_DIR, dateDir.name);
      const files   = await fs.readdir(dirPath);

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat     = await fs.stat(filePath);
        if (stat.mtimeMs < cutoff) continue;

        results.push({
          backupId:      file.replace(/\.(json|json\.enc)$/, ''),
          filename:      file,
          date:          dateDir.name,
          fileSizeBytes: stat.size,
          encrypted:     file.endsWith('.enc'),
          createdAt:     new Date(stat.mtimeMs).toISOString(),
          expiresAt:     new Date(stat.mtimeMs + retentionDays * 24 * 60 * 60 * 1000).toISOString(),
        });
      }
    }
  } catch {
    // backups directory may not exist yet
  }

  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
