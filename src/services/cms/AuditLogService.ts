/**
 * AuditLogService
 * 
 * Comprehensive audit trail service for CMS customization compliance tracking.
 * Enforces strict tenant isolation at every query and logs all administrative actions.
 * 
 * Requirements: 15.1, 15.2, 15.3, 15.4, 2.10
 * 
 * All queries MUST include tenant_id filter to ensure audit logs from different tenants are never mixed.
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class TenantMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantMismatchError';
  }
}

export class AuditLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditLogError';
  }
}

// ============================================================================
// INTERFACES AND TYPES
// ============================================================================

export interface AuditLogEntry {
  id: string;
  tenant_id: string;
  admin_id: string | null;
  action: 'create' | 'update' | 'delete' | 'import' | 'rollback' | 'apply_preset' | 'export';
  resource_type?: string;
  resource_id?: string;
  changes?: Record<string, any>;
  error_message?: string;
  ip_address?: string;
  user_agent?: string;
  timestamp: string;
}

export interface AuditLogFilters {
  limit?: number;
  offset?: number;
  action?: string;
  adminId?: string;
  startDate?: string;
  endDate?: string;
}

export interface AuditLogResult {
  logs: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// AUDIT LOG SERVICE
// ============================================================================

export class AuditLogService {
  private supabase;

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
  }

  /**
   * Validates tenant_id is present and not null
   * Requirement 2.10: Tenant_ID Filter validation
   */
  private validateTenantId(tenantId: string | null | undefined): void {
    if (!tenantId || tenantId.trim() === '') {
      throw new TenantMismatchError('tenant_id is required for audit logging');
    }
  }

  /**
   * Logs an administrative action to the audit trail
   * 
   * Requirement 15.1: Administrative actions logged with admin_id and timestamp
   * Requirement 15.2: Admin, action, and change details recorded
   * 
   * @param tenantId - The tenant performing the action (REQUIRED)
   * @param adminId - The admin user ID performing the action
   * @param action - The action type (create, update, delete, import, rollback, apply_preset, export)
   * @param resourceType - Type of resource affected (e.g., 'cms_settings', 'theme_preset')
   * @param resourceId - ID of the resource affected
   * @param changes - Details of what changed (before/after or relevant metadata)
   * @param ipAddress - IP address of the request (optional)
   * @param userAgent - User agent string (optional)
   * @param errorMessage - Error message if action failed (optional)
   * 
   * @throws TenantMismatchError if tenant_id is missing
   */
  async logAction(
    tenantId: string,
    adminId: string | null,
    action: 'create' | 'update' | 'delete' | 'import' | 'rollback' | 'apply_preset' | 'export',
    resourceType?: string,
    resourceId?: string,
    changes?: Record<string, any>,
    ipAddress?: string,
    userAgent?: string,
    errorMessage?: string
  ): Promise<AuditLogEntry> {
    // Validate tenant context (Requirement 2.10)
    this.validateTenantId(tenantId);

    try {
      const { data, error } = await this.supabase
        .from('cms_audit_log')
        .insert([
          {
            tenant_id: tenantId,
            admin_id: adminId,
            action,
            resource_type: resourceType || null,
            resource_id: resourceId || null,
            changes: changes || null,
            error_message: errorMessage || null,
            ip_address: ipAddress || null,
            user_agent: userAgent || null,
            timestamp: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) {
        throw new AuditLogError(
          `Failed to log audit entry: ${error.message}`
        );
      }

      return this.mapToAuditLogEntry(data);
    } catch (error) {
      if (error instanceof TenantMismatchError) {
        throw error;
      }
      if (error instanceof AuditLogError) {
        throw error;
      }
      throw new AuditLogError(
        `Unexpected error logging audit action: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Retrieves audit logs for a specific tenant with optional filtering
   * 
   * Requirement 15.2: Display audit log with admin_id, timestamp, action details
   * Requirement 15.3: Filter logs by action type and admin
   * Requirement 2.10: All queries filtered by tenant_id
   * 
   * @param tenantId - The tenant whose logs to retrieve (REQUIRED)
   * @param filters - Optional filters (limit, offset, action, adminId, dateRange)
   * 
   * @returns Object with logs, total count, and pagination info
   * @throws TenantMismatchError if tenant_id is missing
   */
  async getLogsByTenant(
    tenantId: string,
    filters: AuditLogFilters = {}
  ): Promise<AuditLogResult> {
    // Validate tenant context (Requirement 2.10)
    this.validateTenantId(tenantId);

    const {
      limit = 50,
      offset = 0,
      action,
      adminId,
      startDate,
      endDate,
    } = filters;

    try {
      // Build base query with tenant_id filter (Requirement 2.10 - CRITICAL)
      let query = this.supabase
        .from('cms_audit_log')
        .select('*', { count: 'exact' })
        .eq('tenant_id', tenantId) // CRITICAL: Tenant isolation filter
        .order('timestamp', { ascending: false }); // Latest first

      // Apply optional filters
      if (action) {
        query = query.eq('action', action);
      }

      if (adminId) {
        query = query.eq('admin_id', adminId);
      }

      if (startDate) {
        query = query.gte('timestamp', startDate);
      }

      if (endDate) {
        query = query.lte('timestamp', endDate);
      }

      // Apply pagination
      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        throw new AuditLogError(
          `Failed to fetch audit logs: ${error.message}`
        );
      }

      return {
        logs: (data || []).map((entry) => this.mapToAuditLogEntry(entry)),
        total: count || 0,
        limit,
        offset,
      };
    } catch (error) {
      if (error instanceof TenantMismatchError || error instanceof AuditLogError) {
        throw error;
      }
      throw new AuditLogError(
        `Unexpected error retrieving audit logs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Retrieves audit logs filtered by action type for a specific tenant
   * 
   * Requirement 15.3: Filter logs by action type
   * Requirement 2.10: All queries filtered by tenant_id
   * 
   * @param tenantId - The tenant whose logs to retrieve (REQUIRED)
   * @param action - The action type to filter by
   * @param limit - Maximum number of results (default: 50)
   * @param offset - Number of results to skip for pagination (default: 0)
   * 
   * @returns Object with filtered logs and pagination info
   * @throws TenantMismatchError if tenant_id is missing
   */
  async getLogsByAction(
    tenantId: string,
    action: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<AuditLogResult> {
    // Validate tenant context (Requirement 2.10)
    this.validateTenantId(tenantId);

    return this.getLogsByTenant(tenantId, { action, limit, offset });
  }

  /**
   * Retrieves all audit logs for a specific tenant with pagination
   * 
   * Requirement 15.1, 15.2, 15.3: Retrieve complete audit trail with pagination
   * Requirement 2.10: All queries filtered by tenant_id
   * 
   * @param tenantId - The tenant whose logs to retrieve (REQUIRED)
   * @param limit - Maximum number of results (default: 50)
   * @param offset - Number of results to skip for pagination (default: 0)
   * 
   * @returns Object with all audit logs for the tenant and pagination info
   * @throws TenantMismatchError if tenant_id is missing
   */
  async getAllLogsForTenant(
    tenantId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<AuditLogResult> {
    // Validate tenant context (Requirement 2.10)
    this.validateTenantId(tenantId);

    return this.getLogsByTenant(tenantId, { limit, offset });
  }

  /**
   * Counts the total number of audit log entries for a tenant
   * Useful for determining if pagination is needed
   * 
   * Requirement 2.10: All queries filtered by tenant_id
   * 
   * @param tenantId - The tenant whose logs to count (REQUIRED)
   * 
   * @returns Total count of audit logs for the tenant
   * @throws TenantMismatchError if tenant_id is missing
   */
  async getLogCountForTenant(tenantId: string): Promise<number> {
    // Validate tenant context (Requirement 2.10)
    this.validateTenantId(tenantId);

    try {
      const { count, error } = await this.supabase
        .from('cms_audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId); // CRITICAL: Tenant isolation filter

      if (error) {
        throw new AuditLogError(
          `Failed to count audit logs: ${error.message}`
        );
      }

      return count || 0;
    } catch (error) {
      if (error instanceof TenantMismatchError || error instanceof AuditLogError) {
        throw error;
      }
      throw new AuditLogError(
        `Unexpected error counting audit logs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Retrieves the most recent audit logs for quick inspection
   * 
   * Requirement 15.2: Display audit logs with timestamps
   * Requirement 2.10: All queries filtered by tenant_id
   * 
   * @param tenantId - The tenant whose logs to retrieve (REQUIRED)
   * @param count - Number of recent logs to retrieve (default: 20)
   * 
   * @returns Array of most recent audit log entries
   * @throws TenantMismatchError if tenant_id is missing
   */
  async getRecentLogs(
    tenantId: string,
    count: number = 20
  ): Promise<AuditLogEntry[]> {
    // Validate tenant context (Requirement 2.10)
    this.validateTenantId(tenantId);

    try {
      const { data, error } = await this.supabase
        .from('cms_audit_log')
        .select('*')
        .eq('tenant_id', tenantId) // CRITICAL: Tenant isolation filter
        .order('timestamp', { ascending: false })
        .limit(count);

      if (error) {
        throw new AuditLogError(
          `Failed to fetch recent audit logs: ${error.message}`
        );
      }

      return (data || []).map((entry) => this.mapToAuditLogEntry(entry));
    } catch (error) {
      if (error instanceof TenantMismatchError || error instanceof AuditLogError) {
        throw error;
      }
      throw new AuditLogError(
        `Unexpected error retrieving recent audit logs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Maps raw database entry to AuditLogEntry interface
   */
  private mapToAuditLogEntry(entry: any): AuditLogEntry {
    return {
      id: entry.id,
      tenant_id: entry.tenant_id,
      admin_id: entry.admin_id,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      changes: entry.changes,
      error_message: entry.error_message,
      ip_address: entry.ip_address,
      user_agent: entry.user_agent,
      timestamp: entry.timestamp,
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const auditLogService = new AuditLogService();
