/**
 * Comprehensive Audit Log Utility
 *
 * Implements Requirements 2.6, 5.9, 21.8–21.13:
 *   - 2.6   Log all cross-tenant data access attempts
 *   - 5.9   Log all authorization failures for security monitoring
 *   - 21.8  Log authentication events (login, logout, token refresh, password change)
 *   - 21.9  Log authorization events (permission denied, role change, cross-tenant access)
 *   - 21.10 Log data access events (read sensitive data, export data)
 *   - 21.11 Log data modification events (create, update, delete)
 *   - 21.12 Log configuration changes (tenant settings, feature flags, notification config)
 *   - 21.13 Log security events (account lockout, suspicious activity, RLS bypass attempts)
 *
 * All events are written to the `audit_logs` table which has:
 *   - tenant_id (nullable — NULL for platform-level events)
 *   - user_id
 *   - action (structured string: category.event, e.g. 'auth.login_success')
 *   - entity_type
 *   - entity_id
 *   - details (JSONB)
 *   - ip_address
 *   - user_agent
 *   - created_at
 *
 * Retention policy (Req 21.14):
 *   - Standard events: 2 years
 *   - Security events (category = 'security' | 'auth'): 5 years
 *   - Enforced via a scheduled database job (see migrations/006_audit_retention.sql)
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Action categories (structured action strings)
// ---------------------------------------------------------------------------

/**
 * Structured action constants for consistent audit log entries.
 * Format: {category}.{event}
 */
export const AuditAction = {
  // Authentication events (Req 21.8)
  AUTH_LOGIN_SUCCESS:        'auth.login_success',
  AUTH_LOGIN_FAILED:         'auth.login_failed',
  AUTH_LOGOUT:               'auth.logout',
  AUTH_TOKEN_REFRESH:        'auth.token_refresh',
  AUTH_PASSWORD_CHANGE:      'auth.password_change',
  AUTH_PASSWORD_RESET:       'auth.password_reset',
  AUTH_TENANT_SELECTED:      'auth.tenant_selected',

  // Authorization events (Req 21.9)
  AUTHZ_PERMISSION_DENIED:   'authz.permission_denied',
  AUTHZ_ROLE_CHANGE:         'authz.role_change',
  AUTHZ_CROSS_TENANT_ATTEMPT:'authz.cross_tenant_attempt',
  AUTHZ_INVALID_TOKEN:       'authz.invalid_token',

  // Data access events (Req 21.10)
  DATA_READ_SENSITIVE:       'data.read_sensitive',
  DATA_EXPORT:               'data.export',
  DATA_REPORT_GENERATED:     'data.report_generated',

  // Data modification events (Req 21.11)
  DATA_CREATE:               'data.create',
  DATA_UPDATE:               'data.update',
  DATA_DELETE:               'data.delete',
  DATA_BULK_UPDATE:          'data.bulk_update',

  // Configuration changes (Req 21.12)
  CONFIG_TENANT_UPDATED:     'config.tenant_updated',
  CONFIG_FEATURE_FLAG:       'config.feature_flag',
  CONFIG_NOTIFICATION:       'config.notification',
  CONFIG_BRANDING:           'config.branding',
  CONFIG_CERT_TEMPLATE:      'config.cert_template',

  // Security events (Req 21.13)
  SECURITY_ACCOUNT_LOCKOUT:  'security.account_lockout',
  SECURITY_SUSPICIOUS:       'security.suspicious_activity',
  SECURITY_RLS_BYPASS:       'security.rls_bypass_attempt',
  SECURITY_FILE_ACCESS_DENIED:'security.file_access_denied',
  SECURITY_RATE_LIMIT:       'security.rate_limit_exceeded',
  SECURITY_INVALID_QR:       'security.invalid_qr_scan',
} as const;

export type AuditActionType = typeof AuditAction[keyof typeof AuditAction];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  /** Tenant UUID — null for platform-level events */
  tenantId?: string | null;
  /** User UUID — null for system/anonymous events */
  userId?: string | null;
  /** Structured action string (use AuditAction constants) */
  action: AuditActionType | string;
  /** Entity type (e.g. 'user', 'program', 'trainee', 'certificate') */
  entityType: string;
  /** Entity UUID — null for collection-level events */
  entityId?: string | null;
  /** Additional structured details */
  details?: Record<string, unknown>;
  /** Client IP address */
  ipAddress?: string | null;
  /** Client user agent */
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Core write function
// ---------------------------------------------------------------------------

/**
 * Write a single audit log entry to the `audit_logs` table.
 *
 * This function is fire-and-forget — it logs errors to the console but
 * never throws, so a logging failure never breaks the main request flow.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('audit_logs').insert({
      tenant_id:   entry.tenantId   ?? null,
      user_id:     entry.userId     ?? null,
      action:      entry.action,
      entity_type: entry.entityType,
      entity_id:   entry.entityId   ?? null,
      details:     entry.details    ?? null,
      ip_address:  entry.ipAddress  ?? null,
      user_agent:  entry.userAgent  ?? null,
    });

    if (error) {
      logger.warn('[AUDIT_LOG] Failed to write audit log entry', {
        action: entry.action,
        error: error.message,
      });
    }
  } catch (err) {
    // Never throw from audit logging — it must not break request handling
    logger.warn('[AUDIT_LOG] Unexpected error writing audit log', { err });
  }
}

// ---------------------------------------------------------------------------
// Request context extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract IP address and user agent from a Next.js request.
 */
export function extractRequestContext(request: NextRequest): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp    = request.headers.get('x-real-ip');
  const ipAddress = forwarded?.split(',')[0]?.trim() ?? realIp ?? null;
  const userAgent = request.headers.get('user-agent') ?? null;
  return { ipAddress, userAgent };
}

// ---------------------------------------------------------------------------
// Convenience wrappers for each event category
// ---------------------------------------------------------------------------

/**
 * Log an authentication event (Req 21.8).
 */
export async function logAuthEvent(params: {
  action: AuditActionType;
  userId?: string | null;
  tenantId?: string | null;
  details?: Record<string, unknown>;
  request?: NextRequest;
}): Promise<void> {
  const ctx = params.request ? extractRequestContext(params.request) : {};
  await writeAuditLog({
    tenantId:   params.tenantId,
    userId:     params.userId,
    action:     params.action,
    entityType: 'user',
    entityId:   params.userId,
    details:    params.details,
    ...ctx,
  });
}

/**
 * Log an authorization event (Req 21.9).
 */
export async function logAuthzEvent(params: {
  action: AuditActionType;
  userId?: string | null;
  tenantId?: string | null;
  entityType?: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  request?: NextRequest;
}): Promise<void> {
  const ctx = params.request ? extractRequestContext(params.request) : {};
  await writeAuditLog({
    tenantId:   params.tenantId,
    userId:     params.userId,
    action:     params.action,
    entityType: params.entityType ?? 'authorization',
    entityId:   params.entityId,
    details:    params.details,
    ...ctx,
  });
}

/**
 * Log a data access event (Req 21.10).
 */
export async function logDataAccess(params: {
  action: AuditActionType;
  userId: string;
  tenantId: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  request?: NextRequest;
}): Promise<void> {
  const ctx = params.request ? extractRequestContext(params.request) : {};
  await writeAuditLog({
    tenantId:   params.tenantId,
    userId:     params.userId,
    action:     params.action,
    entityType: params.entityType,
    entityId:   params.entityId,
    details:    params.details,
    ...ctx,
  });
}

/**
 * Log a data modification event (Req 21.11).
 */
export async function logDataModification(params: {
  action: AuditActionType;
  userId: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
  request?: NextRequest;
}): Promise<void> {
  const ctx = params.request ? extractRequestContext(params.request) : {};
  await writeAuditLog({
    tenantId:   params.tenantId,
    userId:     params.userId,
    action:     params.action,
    entityType: params.entityType,
    entityId:   params.entityId,
    details:    params.details,
    ...ctx,
  });
}

/**
 * Log a configuration change event (Req 21.12).
 */
export async function logConfigChange(params: {
  action: AuditActionType;
  userId: string;
  tenantId: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  request?: NextRequest;
}): Promise<void> {
  const ctx = params.request ? extractRequestContext(params.request) : {};
  await writeAuditLog({
    tenantId:   params.tenantId,
    userId:     params.userId,
    action:     params.action,
    entityType: params.entityType,
    entityId:   params.entityId,
    details:    params.details,
    ...ctx,
  });
}

/**
 * Log a security event (Req 21.13).
 * Security events are retained for 5 years (Req 21.14).
 */
export async function logSecurityEvent(params: {
  action: AuditActionType;
  userId?: string | null;
  tenantId?: string | null;
  entityType?: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  request?: NextRequest;
}): Promise<void> {
  const ctx = params.request ? extractRequestContext(params.request) : {};
  await writeAuditLog({
    tenantId:   params.tenantId,
    userId:     params.userId,
    action:     params.action,
    entityType: params.entityType ?? 'security',
    entityId:   params.entityId,
    details: {
      ...params.details,
      // Tag security events for retention policy enforcement
      _retention: '5years',
    },
    ...ctx,
  });
}
