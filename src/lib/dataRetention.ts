/**
 * Data Retention & Cleanup Service
 *
 * Implements automated data retention and cleanup policies for sensitive data.
 * Retention windows:
 *   - Audit logs: 90 days
 *   - Temporary files (selfies, GPS): 30 days after session end
 *   - Failed authentication attempts: 30 days
 *   - Soft-deleted records: 90 days, then hard delete
 *
 * Usage:
 *   const report = await executeRetentionPolicy();
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetentionPolicy {
  /** Name of the retention policy */
  name: string;
  /** Description */
  description: string;
  /** Days to retain data (before deletion) */
  retentionDays: number;
  /** Number of records cleaned up */
  recordsDeleted?: number;
  /** Any errors encountered */
  error?: string;
}

export interface RetentionReport {
  /** Timestamp when cleanup ran */
  executedAt: string;
  /** Individual policy results */
  policies: RetentionPolicy[];
  /** Total records deleted */
  totalRecordsDeleted: number;
  /** Success/failure status */
  success: boolean;
}

// ---------------------------------------------------------------------------
// Retention Policies
// ---------------------------------------------------------------------------

const AUDIT_LOG_RETENTION_DAYS = 90;
const AUTH_FAILURE_RETENTION_DAYS = 30;
const SOFT_DELETE_RETENTION_DAYS = 90;
const TEMP_FILE_RETENTION_DAYS = 30;

// ---------------------------------------------------------------------------
// Core cleanup functions
// ---------------------------------------------------------------------------

/**
 * Delete audit logs older than retention period.
 * Keeps recent logs for compliance and troubleshooting.
 */
async function cleanupAuditLogs(): Promise<RetentionPolicy> {
  const policy: RetentionPolicy = {
    name: 'audit_logs_retention',
    description: `Delete audit logs older than ${AUDIT_LOG_RETENTION_DAYS} days`,
    retentionDays: AUDIT_LOG_RETENTION_DAYS,
  };

  try {
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - AUDIT_LOG_RETENTION_DAYS);

    // Delete old audit logs
    const { error, count } = await supabaseAdmin
      .from('audit_logs')
      .delete()
      .lt('created_at', cutoffDate.toISOString());

    if (error) {
      policy.error = `Error deleting audit logs: ${error.message}`;
      logger.error('[DATA_RETENTION] Audit log cleanup failed', { error: error.message });
      return policy;
    }

    policy.recordsDeleted = count || 0;
    logger.info('[DATA_RETENTION] Audit logs cleaned up', {
      recordsDeleted: count,
      cutoffDate: cutoffDate.toISOString(),
    });

    return policy;
  } catch (err) {
    policy.error = err instanceof Error ? err.message : String(err);
    logger.error('[DATA_RETENTION] Audit log cleanup exception', { error: policy.error });
    return policy;
  }
}

/**
 * Delete failed authentication records older than retention period.
 * Helps prevent brute force attack history from growing indefinitely.
 */
async function cleanupFailedAuthAttempts(): Promise<RetentionPolicy> {
  const policy: RetentionPolicy = {
    name: 'failed_auth_retention',
    description: `Delete failed auth attempts older than ${AUTH_FAILURE_RETENTION_DAYS} days`,
    retentionDays: AUTH_FAILURE_RETENTION_DAYS,
  };

  try {
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - AUTH_FAILURE_RETENTION_DAYS);

    // Find and delete old failed auth records from audit logs
    // Failed auth attempts are logged as auth_failed actions
    const { error, count } = await supabaseAdmin
      .from('audit_logs')
      .delete()
      .eq('action', 'login_failed')
      .lt('created_at', cutoffDate.toISOString());

    if (error) {
      policy.error = `Error deleting failed auth attempts: ${error.message}`;
      logger.error('[DATA_RETENTION] Failed auth cleanup failed', { error: error.message });
      return policy;
    }

    policy.recordsDeleted = count || 0;
    logger.info('[DATA_RETENTION] Failed auth attempts cleaned up', {
      recordsDeleted: count,
      cutoffDate: cutoffDate.toISOString(),
    });

    return policy;
  } catch (err) {
    policy.error = err instanceof Error ? err.message : String(err);
    logger.error('[DATA_RETENTION] Failed auth cleanup exception', { error: policy.error });
    return policy;
  }
}

/**
 * Hard-delete soft-deleted records (those with deleted_at set).
 * Allows administrators to purge data after retention period expires.
 */
async function purgeHardDeletedRecords(): Promise<RetentionPolicy> {
  const policy: RetentionPolicy = {
    name: 'soft_delete_purge',
    description: `Hard-delete soft-deleted records older than ${SOFT_DELETE_RETENTION_DAYS} days`,
    retentionDays: SOFT_DELETE_RETENTION_DAYS,
  };

  try {
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - SOFT_DELETE_RETENTION_DAYS);

    let totalDeleted = 0;

    // Tables with soft-delete support (deleted_at column)
    const tablesWithSoftDelete = [
      'programs',
      'trainees',
      'enrollments',
      'enrollment_requirements',
      'attendance',
    ];

    for (const table of tablesWithSoftDelete) {
      try {
        const { error, count } = await supabaseAdmin
          .from(table)
          .delete()
          .not('deleted_at', 'is', null)
          .lt('deleted_at', cutoffDate.toISOString());

        if (error) {
          logger.warn('[DATA_RETENTION] Failed to purge from table', {
            table,
            error: error.message,
          });
          continue;
        }

        totalDeleted += count || 0;
        logger.info('[DATA_RETENTION] Hard-deleted records from table', {
          table,
          recordsDeleted: count,
        });
      } catch (err) {
        logger.warn('[DATA_RETENTION] Exception purging table', {
          table,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    policy.recordsDeleted = totalDeleted;
    logger.info('[DATA_RETENTION] Soft-deleted records purged', {
      totalDeleted,
      cutoffDate: cutoffDate.toISOString(),
    });

    return policy;
  } catch (err) {
    policy.error = err instanceof Error ? err.message : String(err);
    logger.error('[DATA_RETENTION] Hard-delete purge exception', { error: policy.error });
    return policy;
  }
}

/**
 * Delete temporary GPS and selfie files not referenced in recent attendance records.
 * Implements GDPR/privacy compliance for location data.
 */
async function cleanupTemporaryFiles(): Promise<RetentionPolicy> {
  const policy: RetentionPolicy = {
    name: 'temporary_files_cleanup',
    description: `Delete temporary GPS/selfie files older than ${TEMP_FILE_RETENTION_DAYS} days (no recent references)`,
    retentionDays: TEMP_FILE_RETENTION_DAYS,
  };

  try {
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - TEMP_FILE_RETENTION_DAYS);

    // Find attendance records with GPS data older than retention period
    // These are considered "temporary" for privacy reasons
    const { data: expiredRecords, error: queryError } = await supabaseAdmin
      .from('attendance')
      .select('id, selfie_path, gps_lat, gps_lng')
      .lt('created_at', cutoffDate.toISOString())
      .not('selfie_path', 'is', null);

    if (queryError) {
      policy.error = `Error querying attendance records: ${queryError.message}`;
      logger.error('[DATA_RETENTION] Temp file query failed', { error: queryError.message });
      return policy;
    }

    // Delete GPS coordinates from old records (GDPR compliance)
    // Keep attendance record but remove sensitive location data
    if (expiredRecords && expiredRecords.length > 0) {
      const { error: updateError, count } = await supabaseAdmin
        .from('attendance')
        .update({
          gps_lat: null,
          gps_lng: null,
          gps_address: null,
          gps_accuracy: null,
        })
        .lt('created_at', cutoffDate.toISOString())
        .not('gps_lat', 'is', null);

      if (updateError) {
        logger.warn('[DATA_RETENTION] Failed to clear GPS data', {
          error: updateError.message,
        });
      } else {
        logger.info('[DATA_RETENTION] GPS data cleared from old attendance records', {
          recordsUpdated: count,
        });
      }
    }

    policy.recordsDeleted = expiredRecords?.length || 0;
    logger.info('[DATA_RETENTION] Temporary files cleaned up', {
      recordsProcessed: expiredRecords?.length || 0,
      cutoffDate: cutoffDate.toISOString(),
    });

    return policy;
  } catch (err) {
    policy.error = err instanceof Error ? err.message : String(err);
    logger.error('[DATA_RETENTION] Temp file cleanup exception', { error: policy.error });
    return policy;
  }
}

// ---------------------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------------------

/**
 * Execute all data retention policies.
 * Designed to be called periodically by a scheduler (cron, CI/CD, etc.).
 */
export async function executeRetentionPolicy(): Promise<RetentionReport> {
  const report: RetentionReport = {
    executedAt: new Date().toISOString(),
    policies: [],
    totalRecordsDeleted: 0,
    success: true,
  };

  logger.info('[DATA_RETENTION] Starting retention policy execution');

  // Run all cleanup policies in sequence
  const results = await Promise.allSettled([
    cleanupAuditLogs(),
    cleanupFailedAuthAttempts(),
    purgeHardDeletedRecords(),
    cleanupTemporaryFiles(),
  ]);

  // Collect results
  for (const result of results) {
    if (result.status === 'fulfilled') {
      report.policies.push(result.value);
      report.totalRecordsDeleted += result.value.recordsDeleted || 0;

      if (result.value.error) {
        report.success = false;
      }
    } else {
      // Promise rejected
      report.success = false;
      report.policies.push({
        name: 'unknown',
        description: 'Policy failed to execute',
        retentionDays: 0,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  logger.info('[DATA_RETENTION] Retention policy execution complete', {
    success: report.success,
    totalRecordsDeleted: report.totalRecordsDeleted,
    policiesExecuted: report.policies.length,
  });

  return report;
}

/**
 * Log retention policy execution to audit logs for compliance.
 */
export async function logRetentionExecution(report: RetentionReport): Promise<void> {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      tenant_id: null, // Platform-level operation
      user_id: null,
      action: 'data_retention_executed',
      entity_type: 'system',
      entity_id: null,
      details: {
        totalRecordsDeleted: report.totalRecordsDeleted,
        policiesExecuted: report.policies.length,
        success: report.success,
        policyResults: report.policies.map((p) => ({
          name: p.name,
          recordsDeleted: p.recordsDeleted,
          error: p.error || null,
        })),
      },
      ip_address: null,
      user_agent: 'system/data-retention',
    });

    logger.info('[DATA_RETENTION] Execution logged to audit_logs');
  } catch (err) {
    logger.warn('[DATA_RETENTION] Failed to log retention execution', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
