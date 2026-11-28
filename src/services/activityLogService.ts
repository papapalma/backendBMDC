import { supabaseAdmin } from '@/lib/supabase-admin';
import { fetchAllRows } from '@/lib/supabasePagination';
import { db } from '@/lib/db';
import { ActivityLog } from '@/types';

export class ActivityLogService {
  async getAllLogs(filters?: {
    user_id?: string;
    entity_type?: string;
    action?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    tenant_id?: string;
    is_super_admin?: boolean;
  }): Promise<ActivityLog[]> {
    const buildBaseQuery = () => {
      let query = supabaseAdmin
        .from('activity_logs')
        .select(`
          *,
          users:user_id (
            id,
            username,
            email
          ),
          tenants:tenant_id (
            id,
            name
          )
        `);

      // Tenant filtering
      if (filters?.is_super_admin) {
        if (filters.tenant_id) {
          if (filters.tenant_id === 'platform') {
            query = query.is('tenant_id', null);
          } else {
            query = query.eq('tenant_id', filters.tenant_id);
          }
        }
      } else if (filters?.tenant_id) {
        query = query.eq('tenant_id', filters.tenant_id);
      }

      if (filters?.user_id) {
        query = query.eq('user_id', filters.user_id);
      }

      if (filters?.entity_type) {
        query = query.eq('entity_type', filters.entity_type);
      }

      if (filters?.action) {
        query = query.eq('action', filters.action);
      }

      if (filters?.start_date) {
        query = query.gte('created_at', filters.start_date);
      }

      if (filters?.end_date) {
        query = query.lte('created_at', filters.end_date);
      }

      return query.order('created_at', { ascending: false });
    };

    let data: any[];
    if (filters?.limit) {
      const { data: limitedData, error } = await buildBaseQuery().limit(filters.limit);
      if (error) throw error;
      data = limitedData || [];
    } else {
      // Paginate past PostgREST's 1,000-row default cap (capped at 3,000 for safety)
      data = await fetchAllRows(buildBaseQuery, 1000, 3000);
    }

    // Transform data to match frontend expectations
    return data.map(log => this.transformLog(log));
  }

  private transformLog(log: any): ActivityLog {
    // Generate description from action and entity_type

const description = this.generateDescription(log.action, log.entity_type, log.entity_id);
    
    // Determine scope (platform or tenant)

const scope = log.tenant_id ? 'tenant' : 'platform';
    const tenantName = log.tenants?.name || null;
    
    return {
      id: log.id,
      user_id: log.user_id,
      action: log.action,
      entity_type: log.entity_type,
      entity_id: log.entity_id,
      details: log.details,
      ip_address: log.ip_address,
      user_agent: log.user_agent,
      created_at: log.created_at,
      // Additional fields for frontend
      userName: log.users?.username || log.users?.email || 'Unknown User',
      module: this.mapEntityTypeToModule(log.entity_type),
      description: description,
      metadata: log.details || {},
      // Cross-tenant fields
      tenant_id: log.tenant_id,
      tenantName: tenantName,
      scope: scope,
    } as any;
  }

  private generateDescription(action: string, entityType: string, entityId: string): string {
    const actionMap: Record<string, string> = {
      create: 'created',
      update: 'updated',
      delete: 'deleted',
      view: 'viewed',
      login: 'logged in',
      logout: 'logged out',
      borrow: 'borrowed',
      return: 'returned',
    };

    const entityMap: Record<string, string> = {
      item: 'item',
      trainee: 'trainee',
      program: 'program',
      lending: 'lending record',
      user: 'user',
    };

    const actionText = actionMap[action.toLowerCase()] || action;
    const entityText = entityMap[entityType.toLowerCase()] || entityType;

    return `${actionText} ${entityText}`;
  }

  private mapEntityTypeToModule(entityType: string): string {
    const moduleMap: Record<string, string> = {
      item: 'Inventory',
      trainee: 'Trainees',
      program: 'Programs',
      lending: 'Lendings',
      user: 'Users',
      auth: 'Authentication',
    };

    return moduleMap[entityType.toLowerCase()] || entityType;
  }

  async createLog(logData: {
    user_id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    details?: any;
    ip_address?: string;
    user_agent?: string;
    tenant_id?: string;
  }): Promise<ActivityLog> {
    const newLog = {
      ...logData,
    };
    
    // Use supabaseAdmin to bypass RLS policies for activity log creation

const { data, error } = await supabaseAdmin
      .from('activity_logs')
      .insert(newLog)
      .select()
      .single();
    
    if (error) {
      console.error('Failed to create activity log:', error);
      throw error;
    }
    
    return data as ActivityLog;
  }

  async logAction(
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    details?: any,
    request?: Request,
    tenantId?: string
  ): Promise<void> {
    const ip_address = request?.headers.get('x-forwarded-for') || 
                      request?.headers.get('x-real-ip') || 
                      undefined;
    const user_agent = request?.headers.get('user-agent') || undefined;
    
    await this.createLog({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
      ip_address,
      user_agent,
      tenant_id: tenantId,
    });
  }

  async getUserActivity(userId: string, limit: number = 50): Promise<ActivityLog[]> {
    return this.getAllLogs({ user_id: userId, limit });
  }

  async getRecentActivity(limit: number = 100): Promise<ActivityLog[]> {
    return this.getAllLogs({ limit });
  }

  async getEntityHistory(
    entityType: string,
    entityId: string
  ): Promise<ActivityLog[]> {
    const { data, error } = await supabaseAdmin
      .from('activity_logs')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  async getActivityStats(startDate?: string, endDate?: string): Promise<{
    totalActions: number;
    byAction: Record<string, number>;
    byEntityType: Record<string, number>;
    byUser: Record<string, number>;
  }> {
    const logs = await this.getAllLogs({ start_date: startDate, end_date: endDate });
    
    const byAction: Record<string, number> = {};
    const byEntityType: Record<string, number> = {};
    const byUser: Record<string, number> = {};
    
    logs.forEach(log => {
      byAction[log.action] = (byAction[log.action] || 0) + 1;
      byEntityType[log.entity_type] = (byEntityType[log.entity_type] || 0) + 1;
      byUser[log.user_id] = (byUser[log.user_id] || 0) + 1;
    });
    
    return {
      totalActions: logs.length,
      byAction,
      byEntityType,
      byUser,
    };
  }
}

export const activityLogService = new ActivityLogService();
