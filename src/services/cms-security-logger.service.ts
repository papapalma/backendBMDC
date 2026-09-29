/**
 * CMS Security Logger Service
 * Logs all CMS operations with tenant context for audit and security compliance
 *
 * Requirements: 2.15, 14.4, 15.1, 15.2, 15.3
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

export interface CMSAuditLogEntry {
  tenant_id: string;
  admin_id?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  changes?: Record<string, any>;
  error_message?: string;
  ip_address?: string;
  user_agent?: string;
  timestamp?: Date;
}

export interface SecurityIncident {
  tenantId: string;
  adminId?: string;
  incidentType: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export class CMSSecurityLogger {
  /**
   * Log a CMS action to audit log
   * Requirements: 15.1
   */
  static async logAction(
    tenantId: string,
    action: string,
    options: {
      adminId?: string;
      resourceType?: string;
      resourceId?: string;
      changes?: Record<string, any>;
      ipAddress?: string;
      userAgent?: string;
    } = {}
  ): Promise<void> {
    try {
      if (!tenantId) {
        logger.error('[CMS Security Logger] Cannot log action without tenant_id');
        return;
      }

      const entry: CMSAuditLogEntry = {
        tenant_id: tenantId,
        admin_id: options.adminId,
        action,
        resource_type: options.resourceType,
        resource_id: options.resourceId,
        changes: options.changes,
        ip_address: options.ipAddress,
        user_agent: options.userAgent,
        timestamp: new Date(),
      };

      // Log to database
      const { error } = await supabaseAdmin
        .from('cms_audit_log')
        .insert([entry]);

      if (error) {
        logger.error('[CMS Security Logger] Failed to log action to database:', error);
      } else {
        logger.info('[CMS Security Logger] Action logged', {
          tenantId,
          action,
          adminId: options.adminId,
          resourceType: options.resourceType,
        });
      }
    } catch (err) {
      logger.error('[CMS Security Logger] Error logging action:', err);
    }
  }

  /**
   * Log tenant mismatch attempt (security incident)
   * Requirements: 2.15
   */
  static async logTenantMismatchAttempt(
    attemptedTenantId: string | undefined,
    requestingTenantId: string,
    adminId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    try {
      const incident: SecurityIncident = {
        tenantId: requestingTenantId,
        adminId,
        incidentType: 'TENANT_MISMATCH',
        details: {
          attemptedTenantId,
          requestingTenantId,
          timestamp: new Date().toISOString(),
        },
        ipAddress,
        userAgent,
      };

      // Log security incident
      logger.warn('[CMS Security Logger] TENANT MISMATCH ATTEMPT DETECTED', {
        attemptedTenantId,
        requestingTenantId,
        adminId,
        ipAddress,
      });

      // Try to store in audit log
      await this.logAction(
        requestingTenantId,
        'security_incident_tenant_mismatch',
        {
          adminId,
          resourceType: 'security',
          changes: {
            incidentType: 'TENANT_MISMATCH',
            attemptedTenantId,
          },
          ipAddress,
          userAgent,
        }
      );
    } catch (err) {
      logger.error('[CMS Security Logger] Error logging tenant mismatch attempt:', err);
    }
  }

  /**
   * Log validation error
   * Requirements: 14.4
   */
  static async logValidationError(
    tenantId: string,
    errors: Record<string, string[]>,
    adminId?: string,
    resourceType?: string,
    ipAddress?: string
  ): Promise<void> {
    try {
      if (!tenantId) {
        logger.error('[CMS Security Logger] Cannot log validation error without tenant_id');
        return;
      }

      logger.warn('[CMS Security Logger] Validation error', {
        tenantId,
        adminId,
        resourceType,
        errorCount: Object.keys(errors).length,
        errors,
      });

      await this.logAction(
        tenantId,
        'validation_error',
        {
          adminId,
          resourceType,
          changes: {
            errors,
            errorCount: Object.keys(errors).length,
          },
          ipAddress,
        }
      );
    } catch (err) {
      logger.error('[CMS Security Logger] Error logging validation error:', err);
    }
  }

  /**
   * Log sanitization error (potential injection attack)
   * Requirements: 14.4
   */
  static async logSanitizationError(
    tenantId: string,
    fieldName: string,
    violationType: string,
    adminId?: string,
    ipAddress?: string
  ): Promise<void> {
    try {
      if (!tenantId) {
        logger.error('[CMS Security Logger] Cannot log sanitization error without tenant_id');
        return;
      }

      logger.warn('[CMS Security Logger] SANITIZATION ERROR (POSSIBLE INJECTION ATTEMPT)', {
        tenantId,
        adminId,
        fieldName,
        violationType,
        ipAddress,
      });

      await this.logAction(
        tenantId,
        'security_incident_injection_attempt',
        {
          adminId,
          resourceType: 'security',
          changes: {
            incidentType: 'POTENTIAL_INJECTION',
            fieldName,
            violationType,
          },
          ipAddress,
        }
      );
    } catch (err) {
      logger.error('[CMS Security Logger] Error logging sanitization error:', err);
    }
  }

  /**
   * Log database error
   * Requirements: 14.4
   */
  static async logDatabaseError(
    tenantId: string,
    error: Error,
    context: Record<string, any>,
    adminId?: string,
    ipAddress?: string
  ): Promise<void> {
    try {
      if (!tenantId) {
        logger.error('[CMS Security Logger] Cannot log database error without tenant_id');
        return;
      }

      logger.error('[CMS Security Logger] Database error', {
        tenantId,
        adminId,
        errorMessage: error.message,
        errorStack: error.stack,
        context,
      });

      await this.logAction(
        tenantId,
        'database_error',
        {
          adminId,
          resourceType: 'database',
          changes: {
            errorMessage: error.message,
            context,
          },
          ipAddress,
        }
      );
    } catch (err) {
      logger.error('[CMS Security Logger] Error logging database error:', err);
    }
  }

  /**
   * Log successful save operation
   * Requirements: 15.1
   */
  static async logSaveSettings(
    tenantId: string,
    adminId: string,
    summary: string = 'Settings saved',
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.logAction(
      tenantId,
      'save_settings',
      {
        adminId,
        resourceType: 'cms_settings',
        changes: { summary },
        ipAddress,
        userAgent,
      }
    );
  }

  /**
   * Log import operation
   * Requirements: 15.1
   */
  static async logImport(
    tenantId: string,
    adminId: string,
    fileName: string,
    mergeStrategy: string,
    ipAddress?: string
  ): Promise<void> {
    await this.logAction(
      tenantId,
      'import',
      {
        adminId,
        resourceType: 'cms_settings',
        changes: {
          action: 'import',
          fileName,
          mergeStrategy,
        },
        ipAddress,
      }
    );
  }

  /**
   * Log export operation
   * Requirements: 15.1
   */
  static async logExport(
    tenantId: string,
    adminId: string,
    fileName: string,
    ipAddress?: string
  ): Promise<void> {
    await this.logAction(
      tenantId,
      'export',
      {
        adminId,
        resourceType: 'cms_settings',
        changes: {
          action: 'export',
          fileName,
        },
        ipAddress,
      }
    );
  }

  /**
   * Log rollback operation
   * Requirements: 15.1
   */
  static async logRollback(
    tenantId: string,
    adminId: string,
    fromVersionId: string,
    toVersionId: string,
    ipAddress?: string
  ): Promise<void> {
    await this.logAction(
      tenantId,
      'rollback',
      {
        adminId,
        resourceType: 'cms_settings_versions',
        changes: {
          action: 'rollback',
          fromVersionId,
          toVersionId,
        },
        ipAddress,
      }
    );
  }

  /**
   * Log preset application
   * Requirements: 15.1
   */
  static async logApplyPreset(
    tenantId: string,
    adminId: string,
    presetId: string,
    presetName: string,
    ipAddress?: string
  ): Promise<void> {
    await this.logAction(
      tenantId,
      'apply_preset',
      {
        adminId,
        resourceType: 'theme_presets',
        changes: {
          action: 'apply',
          presetId,
          presetName,
        },
        ipAddress,
      }
    );
  }

  /**
   * Get audit logs for a tenant
   * Requirements: 15.2, 15.3
   */
  static async getAuditLogs(
    tenantId: string,
    options: {
      limit?: number;
      offset?: number;
      action?: string;
      adminId?: string;
    } = {}
  ): Promise<CMSAuditLogEntry[]> {
    try {
      if (!tenantId) {
        logger.error('[CMS Security Logger] Cannot fetch logs without tenant_id');
        return [];
      }

      const limit = options.limit || 50;
      const offset = options.offset || 0;

      let query = supabaseAdmin
        .from('cms_audit_log')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('timestamp', { ascending: false })
        .range(offset, offset + limit - 1);

      // Apply filters
      if (options.action) {
        query = query.eq('action', options.action);
      }

      if (options.adminId) {
        query = query.eq('admin_id', options.adminId);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('[CMS Security Logger] Error fetching audit logs:', error);
        return [];
      }

      return data || [];
    } catch (err) {
      logger.error('[CMS Security Logger] Error in getAuditLogs:', err);
      return [];
    }
  }

  /**
   * Get count of audit logs for a tenant
   */
  static async getAuditLogCount(tenantId: string): Promise<number> {
    try {
      if (!tenantId) {
        return 0;
      }

      const { count, error } = await supabaseAdmin
        .from('cms_audit_log')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      if (error) {
        logger.error('[CMS Security Logger] Error counting audit logs:', error);
        return 0;
      }

      return count || 0;
    } catch (err) {
      logger.error('[CMS Security Logger] Error in getAuditLogCount:', err);
      return 0;
    }
  }

  /**
   * Get security incidents for a tenant
   */
  static async getSecurityIncidents(
    tenantId: string,
    options: {
      limit?: number;
      offset?: number;
      daysBack?: number;
    } = {}
  ): Promise<CMSAuditLogEntry[]> {
    try {
      if (!tenantId) {
        logger.error('[CMS Security Logger] Cannot fetch incidents without tenant_id');
        return [];
      }

      const limit = options.limit || 50;
      const offset = options.offset || 0;
      const daysBack = options.daysBack || 30;

      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysBack);

      let query = supabaseAdmin
        .from('cms_audit_log')
        .select('*')
        .eq('tenant_id', tenantId)
        .like('action', '%security%')
        .gte('timestamp', fromDate.toISOString())
        .order('timestamp', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        logger.error('[CMS Security Logger] Error fetching security incidents:', error);
        return [];
      }

      return data || [];
    } catch (err) {
      logger.error('[CMS Security Logger] Error in getSecurityIncidents:', err);
      return [];
    }
  }

  /**
   * Extract IP address and User-Agent from request headers
   */
  static extractRequestContext(headers: Headers): {
    ipAddress?: string;
    userAgent?: string;
  } {
    const ipAddress = (
      headers.get('x-forwarded-for') ||
      headers.get('x-real-ip') ||
      headers.get('cf-connecting-ip') ||
      'unknown'
    )?.split(',')[0].trim();

    const userAgent = headers.get('user-agent') || undefined;

    return {
      ipAddress: ipAddress !== 'unknown' ? ipAddress : undefined,
      userAgent,
    };
  }
}
