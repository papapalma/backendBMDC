import { supabaseAdmin } from '@/lib/supabase-admin';
import { db } from '@/lib/db';
import { Anomaly } from '@/types';
import { ResolveAnomalyInput } from '@/utils/validators';
import { objectsToCsv } from '@/utils/export';

interface DetectionConfigValue {
  enabled_checks?: {
    quantity_discrepancy?: boolean;
    overdue_lending?: boolean;
    name_email_mismatch?: boolean;
    impossible_availability?: boolean;
    zero_quantity_lending?: boolean;
    active_trainee_without_program?: boolean;
    expired_active_program?: boolean;
    lending_inactive_trainee?: boolean;
    minimum_quantity_unset?: boolean;
  };
  thresholds?: {
    quantity_discrepancy_warning_ratio?: number;
    quantity_discrepancy_critical_ratio?: number;
    overdue_warning_days?: number;
    overdue_critical_days?: number;
  };
  auto_resolve?: {
    enabled?: boolean;
    max_days?: number;
  };
  [key: string]: unknown;
}

interface DetectionConfigRecord {
  id: string;
  config_key: string;
  config_value: DetectionConfigValue;
  description: string | null;
  updated_at: string;
  updated_by: string;
}

interface DetectionRunRecord {
  id: string;
  tenant_id?: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  total_anomalies_found: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
  trigger_type: 'scheduled' | 'manual';
  triggered_by: string | null;
  status: 'running' | 'completed' | 'failed';
  error_message: string | null;
  config_snapshot: Record<string, unknown> | null;
}

interface DetectionResult {
  total_found: number;
  by_type: Record<string, number>;
  anomalies: Anomaly[];
}

interface DetectionRunOptions {
  detectionRunId?: string;
  config?: DetectionConfigValue;
  tenantId?: string;
}

interface AnomalyQueryFilters {
  type?: string;
  ids?: string[];
  category?: string | string[];
  severity?: string | string[];
  status?: string | string[];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  entityType?: string;
  entityId?: string;
  tenantId?: string;
}

interface PaginationOptions {
  page?: number;
  limit?: number;
}

interface PaginatedAnomalyResult {
  data: Anomaly[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export class AnomalyService {
  private readonly defaultConfig: DetectionConfigValue = {
    enabled_checks: {
      quantity_discrepancy: true,
      overdue_lending: true,
      name_email_mismatch: false,
      impossible_availability: true,
      zero_quantity_lending: true,
      active_trainee_without_program: true,
      expired_active_program: true,
      lending_inactive_trainee: true,
      minimum_quantity_unset: true,
    },
    thresholds: {
      quantity_discrepancy_warning_ratio: 0.1,
      quantity_discrepancy_critical_ratio: 0.3,
      overdue_warning_days: 3,
      overdue_critical_days: 7,
    },
    auto_resolve: {
      enabled: true,
      max_days: 14,
    },
  };

  private isMissingRelationError(error: unknown): boolean {
    return Boolean(
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: string }).code === '42P01'
    );
  }

  private applyAnomalyFilters(query: any, filters?: AnomalyQueryFilters): any {
    // Apply tenant filtering first (tenant isolation - Req 14.x)

if (filters?.tenantId) {
      query = query.eq('tenant_id', filters.tenantId);
    }

if (filters?.ids && filters.ids.length > 0) {
      query = query.in('id', filters.ids);
    }

if (filters?.type) {
      query = query.eq('anomaly_type', filters.type);
    }

if (filters?.category) {
      query = Array.isArray(filters.category)
        ? query.in('category', filters.category)
        : query.eq('category', filters.category);
    }

if (filters?.severity) {
      query = Array.isArray(filters.severity)
        ? query.in('severity', filters.severity)
        : query.eq('severity', filters.severity);
    }

if (filters?.status) {
      query = Array.isArray(filters.status)
        ? query.in('status', filters.status)
        : query.eq('status', filters.status);
    }

if (filters?.dateFrom) {
      query = query.gte('detected_at', filters.dateFrom);
    }

if (filters?.dateTo) {
      query = query.lte('detected_at', filters.dateTo);
    }

if (filters?.search) {
      query = query.ilike('description', `%${filters.search}%`);
    }

if (filters?.entityType) {
      query = query.eq('entity_type', filters.entityType);
    }

if (filters?.entityId) {
      query = query.eq('entity_id', filters.entityId);
    }

    return query;
  }

  private async hasUnresolvedAnomaly(anomalyType: string, entityId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('anomalies')
      .select('id')
      .eq('anomaly_type', anomalyType)
      .eq('entity_id', entityId)
      .in('status', ['open', 'in_progress'])
      .maybeSingle();

    if (error) throw error;
    return Boolean(data);
  }

  async getAllAnomalies(filters?: AnomalyQueryFilters): Promise<Anomaly[]> {
    let query = supabaseAdmin.from('anomalies').select('*');
    query = this.applyAnomalyFilters(query, filters);
    query = query.order('detected_at', { ascending: false });

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  async getAllAnomaliesPaginated(
    filters?: AnomalyQueryFilters,
    pagination?: PaginationOptions
  ): Promise<PaginatedAnomalyResult> {
    const page = Number.isNaN(pagination?.page) ? 1 : Math.max(pagination?.page || 1, 1);
    const limit = Number.isNaN(pagination?.limit) ? 10 : Math.min(Math.max(pagination?.limit || 10, 1), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from('anomalies')
      .select('*', { count: 'exact' });

    query = this.applyAnomalyFilters(query, filters);
    query = query
      .order('detected_at', { ascending: false })
      .range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    const total = count || 0;
    return {
      data: data || [],
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getDetectionConfig(tenantId?: string): Promise<DetectionConfigRecord> {
    let query = supabaseAdmin
      .from('anomaly_detection_configs')
      .select('*')
      .eq('config_key', 'default');

    // Tenant isolation — filter by tenant_id when provided
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      if (this.isMissingRelationError(error)) {
        return {
          id: 'default',
          config_key: 'default',
          config_value: this.defaultConfig,
          description: 'Default anomaly detection configuration (fallback)',
          updated_at: new Date().toISOString(),
          updated_by: 'system',
        };
      }
      throw error;
    }

    if (data) {
      return data as DetectionConfigRecord;
    }

    // Create default config for tenant if it doesn't exist
    const { data: created, error: createError } = await supabaseAdmin
      .from('anomaly_detection_configs')
      .insert({
        tenant_id: tenantId || '00000000-0000-0000-0000-000000000000', // Fallback for platform-level
        config_key: 'default',
        config_value: this.defaultConfig,
        description: 'Default anomaly detection configuration',
        updated_by: 'system',
      })
      .select('*')
      .single();

    if (createError) throw createError;
    return created as DetectionConfigRecord;
  }

  async updateDetectionConfig(
    input: {
      config_key?: string;
      config_value?: Record<string, unknown>;
      description?: string | null;
    },
    updatedBy: string,
    tenantId?: string
  ): Promise<DetectionConfigRecord> {
    const existing = await this.getDetectionConfig(tenantId);
    const incoming = (input.config_value || {}) as DetectionConfigValue;

    const mergedConfig: DetectionConfigValue = {
      ...existing.config_value,
      ...incoming,
      enabled_checks: {
        ...existing.config_value?.enabled_checks,
        ...incoming.enabled_checks,
      },
      thresholds: {
        ...existing.config_value?.thresholds,
        ...incoming.thresholds,
      },
      auto_resolve: {
        ...existing.config_value?.auto_resolve,
        ...incoming.auto_resolve,
      },
    };

    const { data, error } = await supabaseAdmin
      .from('anomaly_detection_configs')
      .update({
        config_key: input.config_key || existing.config_key,
        config_value: mergedConfig,
        description: input.description ?? existing.description,
        updated_by: updatedBy,
      })
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error) throw error;
    return data as DetectionConfigRecord;
  }

  async getDetectionRuns(limit: number = 20): Promise<DetectionRunRecord[]> {
    const safeLimit = Number.isNaN(limit) ? 20 : Math.min(Math.max(limit, 1), 200);
    const { data, error } = await supabaseAdmin
      .from('anomaly_detection_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(safeLimit);

    if (error) {
      if (this.isMissingRelationError(error)) {
        return [];
      }
      throw error;
    }
    return (data || []) as DetectionRunRecord[];
  }

  async getDetectionRunById(id: string): Promise<DetectionRunRecord | null> {
    const { data, error } = await supabaseAdmin
      .from('anomaly_detection_runs')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      if (this.isMissingRelationError(error)) {
        return null;
      }
      throw error;
    }
    return (data as DetectionRunRecord) || null;
  }

  private async createDetectionRun(
    triggerType: 'scheduled' | 'manual',
    triggeredBy: string | null,
    configSnapshot: DetectionConfigValue,
    tenantId?: string
  ): Promise<DetectionRunRecord> {
    const { data, error } = await supabaseAdmin
      .from('anomaly_detection_runs')
      .insert({
        tenant_id: tenantId,
        trigger_type: triggerType,
        triggered_by: triggeredBy,
        status: 'running',
        config_snapshot: configSnapshot,
      })
      .select('*')
      .single();

    if (error) {
      if (this.isMissingRelationError(error)) {
        return {
          id: `scan-${Date.now()}`,
          tenant_id: tenantId,
          started_at: new Date().toISOString(),
          completed_at: null,
          duration_seconds: null,
          total_anomalies_found: 0,
          critical_count: 0,
          warning_count: 0,
          info_count: 0,
          trigger_type: triggerType,
          triggered_by: triggeredBy,
          status: 'running',
          error_message: null,
          config_snapshot: configSnapshot,
        };
      }
      throw error;
    }
    return data as DetectionRunRecord;
  }

  private async completeDetectionRun(
    id: string,
    payload: {
      status: 'completed' | 'failed';
      total_anomalies_found?: number;
      critical_count?: number;
      warning_count?: number;
      info_count?: number;
      duration_seconds?: number;
      error_message?: string | null;
    }
  ): Promise<void> {
    const { error } = await supabaseAdmin
      .from('anomaly_detection_runs')
      .update({
        ...payload,
        completed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error && !this.isMissingRelationError(error)) {
      throw error;
    }
  }

  async runDetectionScan(
    triggerType: 'scheduled' | 'manual',
    triggeredBy: string | null,
    tenantId?: string
  ): Promise<{ run: DetectionRunRecord; result: DetectionResult }> {
    console.log('🔍 [SERVICE] runDetectionScan called:', { triggerType, triggeredBy, tenantId });
    
    console.log('🔍 [SERVICE] Getting detection config...');
    const config = await this.getDetectionConfig(tenantId);
    console.log('🔍 [SERVICE] Config retrieved:', { hasConfig: !!config, enabledChecks: config.config_value?.enabled_checks });
    
    const startedAt = Date.now();
    
    console.log('🔍 [SERVICE] Creating detection run...');
    const run = await this.createDetectionRun(triggerType, triggeredBy, config.config_value, tenantId);
    console.log('🔍 [SERVICE] Detection run created:', { runId: run.id, status: run.status });

    try {
      console.log('🔍 [SERVICE] Running all detections...');
      const result = await this.runAllDetections({
        detectionRunId: run.id,
        config: config.config_value,
        tenantId,
      });
      console.log('🔍 [SERVICE] Detections completed:', { totalFound: result.total_found, byType: result.by_type });

      const criticalCount = result.anomalies.filter((a) => a.severity === 'critical').length;
      const warningCount = result.anomalies.filter((a) => a.severity === 'warning').length;
      const infoCount = result.anomalies.filter((a) => a.severity === 'info').length;
      const durationSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

      await this.completeDetectionRun(run.id, {
        status: 'completed',
        total_anomalies_found: result.total_found,
        critical_count: criticalCount,
        warning_count: warningCount,
        info_count: infoCount,
        duration_seconds: durationSeconds,
      });

      const completedRun = await this.getDetectionRunById(run.id);
      const resolvedRun = completedRun || {
        ...run,
        status: 'completed',
        completed_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        total_anomalies_found: result.total_found,
        critical_count: criticalCount,
        warning_count: warningCount,
        info_count: infoCount,
      };

      return { run: resolvedRun, result };
    } catch (error) {
      const durationSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      await this.completeDetectionRun(run.id, {
        status: 'failed',
        duration_seconds: durationSeconds,
        error_message: error instanceof Error ? error.message : 'Detection scan failed',
      });
      throw error;
    }
  }

  async getAnomalyById(id: string): Promise<Anomaly | null> {
    return db.findById<Anomaly>('anomalies', id);
  }

  async createAnomaly(anomalyData: Partial<Anomaly>): Promise<Anomaly> {
    const newAnomaly: Partial<Anomaly> = {
      ...anomalyData,
      status: 'open',
      detected_at: new Date().toISOString(),
    };
    
    return db.create<Anomaly>('anomalies', newAnomaly);
  }

  async resolveAnomaly(
    id: string,
    resolveData: ResolveAnomalyInput,
    userId: string
  ): Promise<Anomaly> {
    const anomaly = await this.getAnomalyById(id);
    if (!anomaly) {
      throw new Error('Anomaly not found');
    }

if (anomaly.status === 'resolved' || anomaly.status === 'dismissed') {
      throw new Error('Anomaly already resolved');
    }

const targetStatus = resolveData.status ?? (resolveData.resolution_type === 'dismiss' ? 'dismissed' : 'resolved');
    
    return db.update<Anomaly>('anomalies', id, {
      status: targetStatus,
      resolution_notes: resolveData.resolution_notes,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    });
  }

  async reopenAnomaly(id: string, userId: string): Promise<Anomaly> {
    const anomaly = await this.getAnomalyById(id);
    if (!anomaly) {
      throw new Error('Anomaly not found');
    }

if (anomaly.status !== 'resolved' && anomaly.status !== 'dismissed') {
      throw new Error('Only resolved or dismissed anomalies can be reopened');
    }

    return db.update<Anomaly>('anomalies', id, {
      status: 'open',
      resolved_at: null,
      resolved_by: null,
      resolution_notes: null,
    });
  }

  async detectQuantityDiscrepancies(options?: DetectionRunOptions): Promise<Anomaly[]> {
    const warningRatio = options?.config?.thresholds?.quantity_discrepancy_warning_ratio ?? 0.1;
    const criticalRatio = options?.config?.thresholds?.quantity_discrepancy_critical_ratio ?? 0.3;

    let query = supabaseAdmin.from('items').select('*');
    if (options?.tenantId) {
      query = query.eq('tenant_id', options.tenantId);
    }

const { data: items, error } = await query;
    
    if (error) throw error;
    
    const anomalies: Anomaly[] = [];
    
    for (const item of items || []) {
      const discrepancy = Math.abs(item.quantity - item.available_quantity);
      const baseline = item.quantity > 0 ? item.quantity : 1;
      const discrepancyRatio = discrepancy / baseline;
      
      if (discrepancyRatio > warningRatio) {
        if (await this.hasUnresolvedAnomaly('quantity_mismatch', item.id)) continue;
        
        const anomaly = await this.createAnomaly({
          category: 'inventory',
          anomaly_type: 'quantity_mismatch',
          entity_type: 'item',
          entity_id: item.id,
          entity_identifier: item.name,
          severity: discrepancyRatio > criticalRatio ? 'critical' : 'warning',
          description: `Quantity discrepancy for "${item.name}": expected ${item.quantity}, available ${item.available_quantity}, discrepancy ${discrepancy}`,
          recommendation: 'Verify physical inventory count and update the available quantity to match the actual stock.',
          metadata: { item_id: item.id, expected: item.quantity, available: item.available_quantity, discrepancy },
          detection_run_id: options?.detectionRunId,
          tenant_id: options?.tenantId,
        });
        anomalies.push(anomaly);
      }
    }
    
    return anomalies;
  }

  async detectOverdueLendings(options?: DetectionRunOptions): Promise<Anomaly[]> {
    const warningDays = options?.config?.thresholds?.overdue_warning_days ?? 3;
    const criticalDays = options?.config?.thresholds?.overdue_critical_days ?? 7;

    let query = supabaseAdmin
      .from('lendings')
      .select('*, trainees(first_name, last_name)')
      .in('status', ['active', 'partially_returned'])
      .lt('expected_return_date', new Date().toISOString());
    
    if (options?.tenantId) {
      query = query.eq('tenant_id', options.tenantId);
    }

const { data: lendings, error } = await query;
    
    if (error) throw error;
    
    const anomalies: Anomaly[] = [];
    
    for (const lending of lendings || []) {
      if (await this.hasUnresolvedAnomaly('overdue', lending.id)) continue;
      
      const daysOverdue = Math.floor(
        (new Date().getTime() - new Date(lending.expected_return_date).getTime()) / 
        (1000 * 60 * 60 * 24)
      );

      const traineeName = lending.trainees
        ? `${lending.trainees.first_name} ${lending.trainees.last_name}`
        : 'Unknown Trainee';
      
      const anomaly = await this.createAnomaly({
        category: 'lending',
        anomaly_type: 'overdue',
        entity_type: 'lending',
        entity_id: lending.id,
        entity_identifier: `Lending #${lending.id.slice(0, 8)}`,
        severity: daysOverdue > criticalDays ? 'critical' : daysOverdue > warningDays ? 'warning' : 'info',
        description: `Lending by ${traineeName} is ${daysOverdue} day(s) overdue (expected return: ${lending.expected_return_date})`,
        recommendation: 'Contact the trainee immediately and request return or renewal of the borrowed item.',
        metadata: { lending_id: lending.id, days_overdue: daysOverdue, trainee_name: traineeName, expected_return_date: lending.expected_return_date },
        detection_run_id: options?.detectionRunId,
        tenant_id: options?.tenantId,
      });
      anomalies.push(anomaly);
    }
    
    return anomalies;
  }

  async detectTraineeNameEmailMismatch(options?: DetectionRunOptions): Promise<Anomaly[]> {
    let query = supabaseAdmin
      .from('trainees')
      .select('id, first_name, last_name, middle_name, email, tenant_id');
    
    if (options?.tenantId) {
      query = query.eq('tenant_id', options.tenantId);
    }

const { data: trainees, error } = await query;
    
    if (error) throw error;
    
    const anomalies: Anomaly[] = [];
    
    for (const trainee of trainees || []) {
      if (!trainee.email) continue;

      // Extract email prefix (part before @)

const emailPrefix = trainee.email.split('@')[0].toLowerCase();
      
      // Normalize names for comparison (letters only, lowercase)

const firstName = (trainee.first_name || '').toLowerCase().replace(/[^a-z]/g, '');
      const lastName = (trainee.last_name || '').toLowerCase().replace(/[^a-z]/g, '');
      const middleName = (trainee.middle_name || '').toLowerCase().replace(/[^a-z]/g, '');
      
      // Normalize email prefix (letters only)

const normalizedEmail = emailPrefix.replace(/[^a-z]/g, '');
      
      // Check if email contains any part of the name
      const hasFirstName = normalizedEmail.includes(firstName) || firstName.includes(normalizedEmail);
      const hasLastName = normalizedEmail.includes(lastName) || lastName.includes(normalizedEmail);
      const hasMiddleName = middleName.length >= 3 && (normalizedEmail.includes(middleName) || middleName.includes(normalizedEmail));
      
      // Require at least 4-char email prefix to reduce false positives

if (!hasFirstName && !hasLastName && !hasMiddleName && normalizedEmail.length >= 4) {
        if (await this.hasUnresolvedAnomaly('name_email_mismatch', trainee.id)) continue;
        
        const anomaly = await this.createAnomaly({
          category: 'trainee',
          anomaly_type: 'name_email_mismatch',
          entity_type: 'trainee',
          entity_id: trainee.id,
          entity_identifier: `${trainee.first_name} ${trainee.last_name}`,
          severity: 'warning',
          description: `Trainee "${trainee.first_name} ${trainee.last_name}" has email "${trainee.email}" that does not appear to match their name`,
          recommendation: 'Verify the trainee\'s identity and correct the email address if it belongs to a different person.',
          metadata: { trainee_id: trainee.id, email: trainee.email },
          detection_run_id: options?.detectionRunId,
          tenant_id: options?.tenantId,
        });
        anomalies.push(anomaly);
      }
    }
    
    return anomalies;
  }

  async runAllDetections(options?: DetectionRunOptions): Promise<DetectionResult> {
    const config = options?.config || this.defaultConfig;
    const checks = config.enabled_checks || {};

    const quantityPromise = checks.quantity_discrepancy === false
      ? Promise.resolve([] as Anomaly[])
      : this.detectQuantityDiscrepancies(options);

    const overduePromise = checks.overdue_lending === false
      ? Promise.resolve([] as Anomaly[])
      : this.detectOverdueLendings(options);

    const nameEmailPromise = checks.name_email_mismatch === false
      ? Promise.resolve([] as Anomaly[])
      : this.detectTraineeNameEmailMismatch(options);

    const impossibleAvailabilityPromise = checks.impossible_availability === false
      ? Promise.resolve([] as Anomaly[])
      : this.detectImpossibleAvailability(options);

    const zeroQuantityLendingPromise = checks.zero_quantity_lending === false
      ? Promise.resolve([] as Anomaly[])
      : this.detectZeroQuantityLending(options);

    const activeWithoutProgramPromise = checks.active_trainee_without_program === false
      ? Promise.resolve([] as Anomaly[])
      : this.detectActiveTraineeWithoutProgram(options);

    const expiredProgramPromise = checks.expired_active_program === false
      ? Promise.resolve([] as Anomaly[])
      : this.detectExpiredActiveProgram(options);

    const lendingInactiveTraineePromise = checks.lending_inactive_trainee === false
      ? Promise.resolve([] as Anomaly[])
      : this.detectLendingToInactiveTrainee(options);

    const minimumQuantityUnsetPromise = checks.minimum_quantity_unset === false
      ? Promise.resolve([] as Anomaly[])
      : this.detectMinimumQuantityUnset(options);

    const [
      quantityAnomalies,
      overdueAnomalies,
      nameEmailAnomalies,
      impossibleAvailabilityAnomalies,
      zeroQuantityLendingAnomalies,
      activeWithoutProgramAnomalies,
      expiredProgramAnomalies,
      lendingInactiveTraineeAnomalies,
      minimumQuantityUnsetAnomalies,
    ] = await Promise.all([
      quantityPromise,
      overduePromise,
      nameEmailPromise,
      impossibleAvailabilityPromise,
      zeroQuantityLendingPromise,
      activeWithoutProgramPromise,
      expiredProgramPromise,
      lendingInactiveTraineePromise,
      minimumQuantityUnsetPromise,
    ]);
    
    const allAnomalies = [
      ...quantityAnomalies,
      ...overdueAnomalies,
      ...nameEmailAnomalies,
      ...impossibleAvailabilityAnomalies,
      ...zeroQuantityLendingAnomalies,
      ...activeWithoutProgramAnomalies,
      ...expiredProgramAnomalies,
      ...lendingInactiveTraineeAnomalies,
      ...minimumQuantityUnsetAnomalies,
    ];
    
    const byType: Record<string, number> = {};
    allAnomalies.forEach(anomaly => {
      byType[anomaly.anomaly_type] = (byType[anomaly.anomaly_type] || 0) + 1;
    });
    
    return {
      total_found: allAnomalies.length,
      by_type: byType,
      anomalies: allAnomalies,
    };
  }

  // Additional data-integrity checks (AN-9 additions)
  async detectImpossibleAvailability(options?: DetectionRunOptions): Promise<Anomaly[]> {
    let query = supabaseAdmin.from('items').select('*');
    if (options?.tenantId) {
      query = query.eq('tenant_id', options.tenantId);
    }

const { data: items, error } = await query;
    if (error) throw error;
    const anomalies: Anomaly[] = [];
    for (const item of items || []) {
      if (item.available_quantity > item.quantity) {
        if (await this.hasUnresolvedAnomaly('available_gt_quantity', item.id)) continue;
        const anomaly = await this.createAnomaly({
          category: 'inventory',
          anomaly_type: 'available_gt_quantity',
          entity_type: 'item',
          entity_id: item.id,
          entity_identifier: item.name,
          severity: 'critical',
          description: `Available quantity (${item.available_quantity}) greater than total quantity (${item.quantity}) for item ${item.name}`,
          recommendation: 'Investigate inventory update logic and correct quantities.' ,
          metadata: { item_id: item.id, quantity: item.quantity, available: item.available_quantity },
          detection_run_id: options?.detectionRunId,
          tenant_id: options?.tenantId,
        });
        anomalies.push(anomaly);
      }
    }
    return anomalies;
  }

  async detectZeroQuantityLending(options?: DetectionRunOptions): Promise<Anomaly[]> {
    let query = supabaseAdmin.from('lendings').select('*');
    if (options?.tenantId) {
      query = query.eq('tenant_id', options.tenantId);
    }

const { data: lendings, error } = await query;
    if (error) throw error;
    const anomalies: Anomaly[] = [];
    for (const lending of lendings || []) {
      if (Number(lending.quantity) === 0) {
        if (await this.hasUnresolvedAnomaly('lending_zero_quantity', lending.id)) continue;
        const anomaly = await this.createAnomaly({
          category: 'lending',
          anomaly_type: 'lending_zero_quantity',
          entity_type: 'lending',
          entity_id: lending.id,
          entity_identifier: `Lending #${lending.id.slice(0,8)}`,
          severity: 'critical',
          description: `Lending record ${lending.id} has quantity = 0`,
          recommendation: 'Review lending input validation and correct the record.',
          metadata: { lending_id: lending.id },
          detection_run_id: options?.detectionRunId,
          tenant_id: options?.tenantId,
        });
        anomalies.push(anomaly);
      }
    }
    return anomalies;
  }

  async detectActiveTraineeWithoutProgram(options?: DetectionRunOptions): Promise<Anomaly[]> {
    let query = supabaseAdmin.from('trainees').select('*').eq('status', 'active');
    if (options?.tenantId) {
      query = query.eq('tenant_id', options.tenantId);
    }

const { data: trainees, error } = await query;
    if (error) throw error;
    const anomalies: Anomaly[] = [];
    for (const trainee of trainees || []) {
      if (!trainee.program_id) {
        if (await this.hasUnresolvedAnomaly('active_without_program', trainee.id)) continue;
        const anomaly = await this.createAnomaly({
          category: 'trainee',
          anomaly_type: 'active_without_program',
          entity_type: 'trainee',
          entity_id: trainee.id,
          entity_identifier: `${trainee.first_name || ''} ${trainee.last_name || ''}`.trim() || 'Unknown',
          severity: 'warning',
          description: `Active trainee ${trainee.id} is not enrolled in any program.`,
          recommendation: 'Assign program or update trainee status.',
          metadata: { trainee_id: trainee.id },
          detection_run_id: options?.detectionRunId,
          tenant_id: options?.tenantId,
        });
        anomalies.push(anomaly);
      }
    }
    return anomalies;
  }

  async detectExpiredActiveProgram(options?: DetectionRunOptions): Promise<Anomaly[]> {
    let query = supabaseAdmin.from('programs').select('*').eq('status', 'active');
    if (options?.tenantId) {
      query = query.eq('tenant_id', options.tenantId);
    }

const { data: programs, error } = await query;
    if (error) throw error;
    const anomalies: Anomaly[] = [];
    for (const program of programs || []) {
      if (program.end_date && new Date(program.end_date) < new Date()) {
        if (await this.hasUnresolvedAnomaly('program_expired_but_active', program.id)) continue;
        const anomaly = await this.createAnomaly({
          category: 'program',
          anomaly_type: 'program_expired_but_active',
          entity_type: 'program',
          entity_id: program.id,
          entity_identifier: program.name || `Program ${program.id.slice(0,8)}`,
          severity: 'warning',
          description: `Program ${program.name || program.id} is marked active but end_date has passed.`,
          recommendation: 'Review program status and update to inactive or extend end_date.',
          metadata: { program_id: program.id, end_date: program.end_date },
          detection_run_id: options?.detectionRunId,
          tenant_id: options?.tenantId,
        });
        anomalies.push(anomaly);
      }
    }
    return anomalies;
  }

  async detectLendingToInactiveTrainee(options?: DetectionRunOptions): Promise<Anomaly[]> {
    let query = supabaseAdmin
      .from('lendings')
      .select('*, trainees(id, first_name, last_name, status)')
      .in('status', ['active', 'partially_returned']);
    
    if (options?.tenantId) {
      query = query.eq('tenant_id', options.tenantId);
    }

const { data: lendings, error } = await query;
    if (error) throw error;
    const anomalies: Anomaly[] = [];
    for (const lending of lendings || []) {
      if (lending.trainees && lending.trainees.status && lending.trainees.status !== 'active') {
        if (await this.hasUnresolvedAnomaly('lending_to_inactive_trainee', lending.id)) continue;
        const traineeName = `${lending.trainees.first_name || ''} ${lending.trainees.last_name || ''}`.trim();
        const anomaly = await this.createAnomaly({
          category: 'lending',
          anomaly_type: 'lending_to_inactive_trainee',
          entity_type: 'lending',
          entity_id: lending.id,
          entity_identifier: `Lending #${lending.id.slice(0,8)}`,
          severity: 'warning',
          description: `Lending ${lending.id} is active but assigned trainee (${traineeName}) is not active.`,
          recommendation: 'Verify trainee status or close the lending record.',
          metadata: { lending_id: lending.id, trainee_id: lending.trainees.id, trainee_status: lending.trainees.status },
          detection_run_id: options?.detectionRunId,
          tenant_id: options?.tenantId,
        });
        anomalies.push(anomaly);
      }
    }
    return anomalies;
  }

  async detectMinimumQuantityUnset(options?: DetectionRunOptions): Promise<Anomaly[]> {
    const tenantId = options?.tenantId;
    let query = supabaseAdmin.from('items').select('*');
    
    // Apply tenant filtering if tenantId is provided (non-super-admin)

if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

const { data: items, error } = await query;
    if (error) throw error;
    const anomalies: Anomaly[] = [];
    for (const item of items || []) {
      if (item.minimum_quantity == null || Number(item.minimum_quantity) === 0) {
        if (await this.hasUnresolvedAnomaly('minimum_quantity_unset', item.id)) continue;
        const anomaly = await this.createAnomaly({
          tenant_id: tenantId,
          category: 'inventory',
          anomaly_type: 'minimum_quantity_unset',
          entity_type: 'item',
          entity_id: item.id,
          entity_identifier: item.name,
          severity: 'info',
          description: `Item ${item.name} has no minimum_quantity set.`,
          recommendation: 'Set minimum_quantity to enable low-stock alerts.',
          metadata: { item_id: item.id },
          detection_run_id: options?.detectionRunId,
        });
        anomalies.push(anomaly);
      }
    }
    return anomalies;
  }

  async exportAnomaliesToCsv(filters?: {
    ids?: string[];
    type?: string;
    category?: string | string[];
    severity?: string | string[];
    status?: string | string[];
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    entityType?: string;
    entityId?: string;
  }): Promise<string> {
    const anomalies = await this.getAllAnomalies(filters);
    const rows = anomalies.map((anomaly) => ({
      id: anomaly.id,
      category: anomaly.category,
      anomaly_type: anomaly.anomaly_type,
      severity: anomaly.severity,
      status: anomaly.status,
      entity_type: anomaly.entity_type || '',
      entity_id: anomaly.entity_id || '',
      entity_identifier: anomaly.entity_identifier || '',
      description: anomaly.description,
      recommendation: anomaly.recommendation || '',
      detected_at: anomaly.detected_at,
      resolved_at: anomaly.resolved_at || '',
      resolution_notes: anomaly.resolution_notes || '',
      detection_run_id: anomaly.detection_run_id || '',
    }));

    return objectsToCsv(rows, [
      'id',
      'category',
      'anomaly_type',
      'severity',
      'status',
      'entity_type',
      'entity_id',
      'entity_identifier',
      'description',
      'recommendation',
      'detected_at',
      'resolved_at',
      'resolution_notes',
      'detection_run_id',
    ]);
  }

  async dismissAnomalies(
    ids: string[],
    reason: string,
    userId: string
  ): Promise<{ dismissed: number }> {
    if (!ids.length) {
      return { dismissed: 0 };
    }

const { data, error } = await supabaseAdmin
      .from('anomalies')
      .update({
        status: 'dismissed',
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
        resolution_notes: reason,
      })
      .in('id', ids)
      .in('status', ['open', 'in_progress'])
      .select('id');

    if (error) throw error;
    return { dismissed: data?.length || 0 };
  }

  async autoResolveAnomalies(
    userId: string,
    options?: {
      category?: string;
      olderThanDays?: number;
      tenantId?: string;
    }
  ): Promise<{ resolved: number }> {
    const config = await this.getDetectionConfig(options?.tenantId);
    if (config.config_value?.auto_resolve?.enabled === false) {
      return { resolved: 0 };
    }

const thresholdDays = options?.olderThanDays
      ?? config.config_value?.auto_resolve?.max_days
      ?? 14;
    const cutoffDate = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000).toISOString();

    let query = supabaseAdmin
      .from('anomalies')
      .select('id')
      .in('status', ['open', 'in_progress'])
      .eq('severity', 'info')
      .lte('detected_at', cutoffDate);

    if (options?.category) {
      query = query.eq('category', options.category);
    }

const { data, error } = await query;
    if (error) throw error;

    const ids = (data || []).map((item) => item.id);
    if (!ids.length) {
      return { resolved: 0 };
    }

const { data: updated, error: updateError } = await supabaseAdmin
      .from('anomalies')
      .update({
        status: 'resolved',
        auto_resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
        resolution_notes: `Auto-resolved after ${thresholdDays} day(s) with info severity`,
      })
      .in('id', ids)
      .select('id');

    if (updateError) throw updateError;
    return { resolved: updated?.length || 0 };
  }

  async getAnomalyStats(tenantId?: string): Promise<{
    total: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
  }> {
    const anomalies = await this.getAllAnomalies(tenantId ? { tenantId } : undefined);
    
    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    
    anomalies.forEach(anomaly => {
      byStatus[anomaly.status] = (byStatus[anomaly.status] || 0) + 1;
      bySeverity[anomaly.severity] = (bySeverity[anomaly.severity] || 0) + 1;
      byType[anomaly.anomaly_type] = (byType[anomaly.anomaly_type] || 0) + 1;
    });
    
    return {
      total: anomalies.length,
      byStatus,
      bySeverity,
      byType,
    };
  }
}

export const anomalyService = new AnomalyService();
