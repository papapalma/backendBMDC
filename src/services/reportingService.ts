/**
 * Reporting Service
 *
 * Implements Requirements 4.6, 4.7, 7.9, 8.7, 3.3–3.6, 10.1–10.9:
 *   - 4.6   Local Admin views training activity summaries
 *   - 4.7   Local Admin monitors inventory levels and utilization
 *   - 7.9   Training program reports scoped to tenant
 *   - 8.7   Inventory reports scoped to tenant
 *   - 3.3   Super Admin requests aggregated cross-tenant reports
 *   - 3.4   Super Admin views training statistics across all LGUs
 *   - 3.5   Super Admin views inventory summaries across all LGUs
 *   - 3.6   Super Admin views trainee demographics across all LGUs
 *   - 10.1  Aggregated report queries data across all active tenants
 *   - 10.2  Total programs, enrollments, completions across all LGUs
 *   - 10.3  Trainee demographics aggregated by LGU
 *   - 10.4  Inventory reports across all LGUs
 *   - 10.5  Platform usage statistics
 *   - 10.6  Tenant-level breakdowns in aggregated reports
 *   - 10.7  Cache aggregated report data for 1 hour
 *   - 10.8  Export reports in PDF and CSV formats
 *   - 10.9  Log all report generation to audit_logs
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// In-memory cache (Req 10.7 — 1-hour TTL for aggregated reports)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const reportCache = new Map<string, CacheEntry<unknown>>();

/** Cache TTL: 1 hour in milliseconds (Req 10.7) */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Tenant-scoped cache TTL: 15 minutes (Req 19.5) */
const TENANT_CACHE_TTL_MS = 15 * 60 * 1000;

function cacheGet<T>(key: string): T | null {
  const entry = reportCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    reportCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function cacheSet<T>(key: string, data: T, ttlMs: number = CACHE_TTL_MS): void {
  reportCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** Build a tenant-scoped cache key (Req 10.7) */
function tenantCacheKey(tenantId: string, reportType: string, params: string = ''): string {
  return `tenant:${tenantId}:${reportType}:${params}`;
}

/** Build a platform-wide cache key */
function platformCacheKey(reportType: string, params: string = ''): string {
  return `platform:${reportType}:${params}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateRangeFilter {
  startDate?: string;
  endDate?: string;
}

export interface TrainingSummaryReport {
  tenantId: string;
  generatedAt: string;
  dateRange: DateRangeFilter;
  totalPrograms: number;
  activePrograms: number;
  completedPrograms: number;
  upcomingPrograms: number;
  totalEnrollments: number;
  activeEnrollments: number;
  completedEnrollments: number;
  droppedEnrollments: number;
  totalCertificates: number;
  enrollmentRate: number;
  completionRate: number;
  programBreakdown: Array<{
    id: string;
    name: string;
    status: string;
    enrollments: number;
    completions: number;
    certificates: number;
  }>;
}

export interface InventorySummaryReport {
  tenantId: string;
  generatedAt: string;
  dateRange: DateRangeFilter;
  totalItems: number;
  totalQuantity: number;
  availableQuantity: number;
  borrowedQuantity: number;
  lowStockCount: number;
  outOfStockCount: number;
  byCategory: Record<string, { count: number; totalQty: number; availableQty: number }>;
  byStatus: Record<string, number>;
  lowStockItems: Array<{ id: string; name: string; category: string; quantity: number; minimum_quantity: number }>;
}

export interface TraineeDemographicsReport {
  tenantId: string;
  generatedAt: string;
  dateRange: DateRangeFilter;
  totalTrainees: number;
  byStatus: Record<string, number>;
  bySex: Record<string, number>;
  byClassification: Record<string, number>;
  byEmploymentStatus: Record<string, number>;
  byEducationalAttainment: Record<string, number>;
  byMunicipality: Record<string, number>;
  enrollmentTrend: Array<{ date: string; count: number }>;
  completionRate: number;
}

export interface TenantSummary {
  tenantId: string;
  tenantName: string;
  status: string;
  programs: number;
  enrollments: number;
  completions: number;
  trainees: number;
  items: number;
  certificates: number;
}

export interface PlatformSummaryReport {
  generatedAt: string;
  dateRange: DateRangeFilter;
  totalTenants: number;
  activeTenants: number;
  totalPrograms: number;
  totalEnrollments: number;
  totalCompletions: number;
  totalTrainees: number;
  totalItems: number;
  totalCertificates: number;
  tenantBreakdowns: TenantSummary[];
}

export interface CrossTenantComparisonReport {
  generatedAt: string;
  dateRange: DateRangeFilter;
  tenants: Array<TenantSummary & {
    enrollmentRate: number;
    completionRate: number;
    inventoryUtilization: number;
  }>;
}

// ---------------------------------------------------------------------------
// Audit logging helper (Req 10.9)
// ---------------------------------------------------------------------------

async function logReportGeneration(params: {
  tenantId?: string;
  userId: string;
  reportType: string;
  dateRange: DateRangeFilter;
  fromCache: boolean;
}): Promise<void> {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      tenant_id: params.tenantId ?? null,
      user_id: params.userId,
      action: 'report.generate',
      entity_type: 'report',
      entity_id: null,
      details: {
        report_type: params.reportType,
        date_range: params.dateRange,
        from_cache: params.fromCache,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.warn('[REPORTING] Failed to log report generation', { err });
  }
}

// ---------------------------------------------------------------------------
// 9.1 — Tenant-scoped reports (Req 4.6, 4.7, 7.9, 8.7)
// ---------------------------------------------------------------------------

/**
 * Training summary report for a single tenant (Req 4.6, 7.9).
 * Returns programs, enrollments, completions, and certificates.
 */
export async function getTrainingSummary(
  tenantId: string,
  userId: string,
  filter: DateRangeFilter = {}
): Promise<TrainingSummaryReport> {
  const cacheKey = tenantCacheKey(tenantId, 'training-summary', JSON.stringify(filter));
  const cached = cacheGet<TrainingSummaryReport>(cacheKey);
  if (cached) {
    await logReportGeneration({ tenantId, userId, reportType: 'training-summary', dateRange: filter, fromCache: true });
    return cached;
  }

  // Programs

let programsQuery = supabaseAdmin
    .from('programs')
    .select('id, name, status, max_trainees, start_date, end_date')
    .eq('tenant_id', tenantId);
  if (filter.startDate) programsQuery = programsQuery.gte('start_date', filter.startDate);
  if (filter.endDate)   programsQuery = programsQuery.lte('end_date', filter.endDate);
  const { data: programs, error: pErr } = await programsQuery.order('start_date', { ascending: false });
  if (pErr) throw pErr;

  const programRows = programs ?? [];
  const programIds = programRows.map((p) => p.id);

  // Enrollments

let enrollmentsQuery = supabaseAdmin
    .from('enrollments')
    .select('id, program_id, status, enrollment_date, completion_date')
    .eq('tenant_id', tenantId);
  if (programIds.length > 0) enrollmentsQuery = enrollmentsQuery.in('program_id', programIds);
  if (filter.startDate) enrollmentsQuery = enrollmentsQuery.gte('enrollment_date', filter.startDate);
  if (filter.endDate)   enrollmentsQuery = enrollmentsQuery.lte('enrollment_date', filter.endDate);
  const { data: enrollments, error: eErr } = await enrollmentsQuery;
  if (eErr) throw eErr;

  const enrollmentRows = enrollments ?? [];

  // Certificates

const { data: certs, error: cErr } = await supabaseAdmin
    .from('certificates')
    .select('id, enrollment_id')
    .eq('tenant_id', tenantId);
  if (cErr) throw cErr;
  const certRows = certs ?? [];

  // Aggregate

const enrollByProgram: Record<string, number> = {};
  const completeByProgram: Record<string, number> = {};
  for (const e of enrollmentRows) {
    enrollByProgram[e.program_id] = (enrollByProgram[e.program_id] ?? 0) + 1;
    if (e.status === 'completed') {
      completeByProgram[e.program_id] = (completeByProgram[e.program_id] ?? 0) + 1;
    }
  }

const certByEnrollment = new Set(certRows.map((c) => c.enrollment_id));
  const certByProgram: Record<string, number> = {};
  for (const e of enrollmentRows) {
    if (certByEnrollment.has(e.id)) {
      certByProgram[e.program_id] = (certByProgram[e.program_id] ?? 0) + 1;
    }
  }

const totalEnrollments = enrollmentRows.length;
  const completedEnrollments = enrollmentRows.filter((e) => e.status === 'completed').length;
  const totalCapacity = programRows.reduce((s, p) => s + (p.max_trainees ?? 0), 0);

  const report: TrainingSummaryReport = {
    tenantId,
    generatedAt: new Date().toISOString(),
    dateRange: filter,
    totalPrograms: programRows.length,
    activePrograms: programRows.filter((p) => p.status === 'active').length,
    completedPrograms: programRows.filter((p) => p.status === 'completed').length,
    upcomingPrograms: programRows.filter((p) => p.status === 'upcoming').length,
    totalEnrollments,
    activeEnrollments: enrollmentRows.filter((e) => e.status === 'active' || e.status === 'enrolled').length,
    completedEnrollments,
    droppedEnrollments: enrollmentRows.filter((e) => e.status === 'dropped').length,
    totalCertificates: certRows.length,
    enrollmentRate: totalCapacity > 0 ? Math.round((totalEnrollments / totalCapacity) * 100) : 0,
    completionRate: totalEnrollments > 0 ? Math.round((completedEnrollments / totalEnrollments) * 100) : 0,
    programBreakdown: programRows.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      enrollments: enrollByProgram[p.id] ?? 0,
      completions: completeByProgram[p.id] ?? 0,
      certificates: certByProgram[p.id] ?? 0,
    })),
  };

  cacheSet(cacheKey, report, TENANT_CACHE_TTL_MS);
  await logReportGeneration({ tenantId, userId, reportType: 'training-summary', dateRange: filter, fromCache: false });
  return report;
}

/**
 * Inventory summary report for a single tenant (Req 4.7, 8.7).
 */
export async function getInventorySummary(
  tenantId: string,
  userId: string,
  filter: DateRangeFilter = {}
): Promise<InventorySummaryReport> {
  const cacheKey = tenantCacheKey(tenantId, 'inventory-summary', JSON.stringify(filter));
  const cached = cacheGet<InventorySummaryReport>(cacheKey);
  if (cached) {
    await logReportGeneration({ tenantId, userId, reportType: 'inventory-summary', dateRange: filter, fromCache: true });
    return cached;
  }

let query = supabaseAdmin
    .from('items')
    .select('id, name, category, quantity, available_quantity, status, minimum_quantity, purchase_date')
    .eq('tenant_id', tenantId);
  if (filter.startDate) query = query.gte('purchase_date', filter.startDate);
  if (filter.endDate)   query = query.lte('purchase_date', filter.endDate);

  const { data: items, error } = await query;
  if (error) throw error;

  const rows = items ?? [];

  const byCategory: Record<string, { count: number; totalQty: number; availableQty: number }> = {};
  const byStatus: Record<string, number> = {};

  for (const item of rows) {
    if (!byCategory[item.category]) {
      byCategory[item.category] = { count: 0, totalQty: 0, availableQty: 0 };
    }
    byCategory[item.category].count++;
    byCategory[item.category].totalQty += item.quantity;
    byCategory[item.category].availableQty += item.available_quantity;
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
  }

const report: InventorySummaryReport = {
    tenantId,
    generatedAt: new Date().toISOString(),
    dateRange: filter,
    totalItems: rows.length,
    totalQuantity: rows.reduce((s, i) => s + i.quantity, 0),
    availableQuantity: rows.reduce((s, i) => s + i.available_quantity, 0),
    borrowedQuantity: rows.reduce((s, i) => s + (i.quantity - i.available_quantity), 0),
    lowStockCount: rows.filter((i) => i.status === 'low_stock').length,
    outOfStockCount: rows.filter((i) => i.status === 'out_of_stock').length,
    byCategory,
    byStatus,
    lowStockItems: rows
      .filter((i) => i.status === 'low_stock' || i.status === 'out_of_stock')
      .map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        quantity: i.available_quantity,
        minimum_quantity: i.minimum_quantity,
      })),
  };

  cacheSet(cacheKey, report, TENANT_CACHE_TTL_MS);
  await logReportGeneration({ tenantId, userId, reportType: 'inventory-summary', dateRange: filter, fromCache: false });
  return report;
}

/**
 * Trainee demographics report for a single tenant (Req 4.6).
 */
export async function getTraineeDemographics(
  tenantId: string,
  userId: string,
  filter: DateRangeFilter = {}
): Promise<TraineeDemographicsReport> {
  const cacheKey = tenantCacheKey(tenantId, 'trainee-demographics', JSON.stringify(filter));
  const cached = cacheGet<TraineeDemographicsReport>(cacheKey);
  if (cached) {
    await logReportGeneration({ tenantId, userId, reportType: 'trainee-demographics', dateRange: filter, fromCache: true });
    return cached;
  }

let query = supabaseAdmin
    .from('trainees')
    .select('id, status, sex, classification, employment_status, educational_attainment, municipality, enrollment_date')
    .eq('tenant_id', tenantId);
  if (filter.startDate) query = query.gte('enrollment_date', filter.startDate);
  if (filter.endDate)   query = query.lte('enrollment_date', filter.endDate);

  const { data: trainees, error } = await query.order('enrollment_date', { ascending: true });
  if (error) throw error;

  const rows = trainees ?? [];

  const byStatus: Record<string, number> = {};
  const bySex: Record<string, number> = {};
  const byClassification: Record<string, number> = {};
  const byEmploymentStatus: Record<string, number> = {};
  const byEducationalAttainment: Record<string, number> = {};
  const byMunicipality: Record<string, number> = {};
  const trendMap: Record<string, number> = {};

  for (const t of rows) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    if (t.sex) bySex[t.sex] = (bySex[t.sex] ?? 0) + 1;
    if (t.classification) byClassification[t.classification] = (byClassification[t.classification] ?? 0) + 1;
    if (t.employment_status) byEmploymentStatus[t.employment_status] = (byEmploymentStatus[t.employment_status] ?? 0) + 1;
    if (t.educational_attainment) byEducationalAttainment[t.educational_attainment] = (byEducationalAttainment[t.educational_attainment] ?? 0) + 1;
    if (t.municipality) byMunicipality[t.municipality] = (byMunicipality[t.municipality] ?? 0) + 1;
    const dateKey = (t.enrollment_date ?? '').split('T')[0];
    if (dateKey) trendMap[dateKey] = (trendMap[dateKey] ?? 0) + 1;
  }

const completedCount = byStatus['completed'] ?? 0;

  const report: TraineeDemographicsReport = {
    tenantId,
    generatedAt: new Date().toISOString(),
    dateRange: filter,
    totalTrainees: rows.length,
    byStatus,
    bySex,
    byClassification,
    byEmploymentStatus,
    byEducationalAttainment,
    byMunicipality,
    enrollmentTrend: Object.entries(trendMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count })),
    completionRate: rows.length > 0 ? Math.round((completedCount / rows.length) * 100) : 0,
  };

  cacheSet(cacheKey, report, TENANT_CACHE_TTL_MS);
  await logReportGeneration({ tenantId, userId, reportType: 'trainee-demographics', dateRange: filter, fromCache: false });
  return report;
}

// ---------------------------------------------------------------------------
// 9.2 — Aggregated cross-tenant reports (Req 3.3–3.6, 10.1–10.6)
// ---------------------------------------------------------------------------

/**
 * Fetch summary stats for a single tenant (used in aggregated reports).
 */
async function fetchTenantSummary(
  tenantId: string,
  tenantName: string,
  tenantStatus: string,
  filter: DateRangeFilter
): Promise<TenantSummary> {
  const [programs, enrollments, trainees, items, certs] = await Promise.all([
    supabaseAdmin.from('programs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabaseAdmin.from('enrollments').select('id, status', { count: 'exact' }).eq('tenant_id', tenantId),
    supabaseAdmin.from('trainees').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabaseAdmin.from('items').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabaseAdmin.from('certificates').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ]);

  const enrollmentRows = enrollments.data ?? [];
  const completions = enrollmentRows.filter((e) => e.status === 'completed').length;

  return {
    tenantId,
    tenantName,
    status: tenantStatus,
    programs: programs.count ?? 0,
    enrollments: enrollments.count ?? 0,
    completions,
    trainees: trainees.count ?? 0,
    items: items.count ?? 0,
    certificates: certs.count ?? 0,
  };
}

/**
 * Platform-wide summary report across all active tenants (Req 10.1–10.6).
 * Restricted to Super Admin (enforced at route level).
 * Cached for 1 hour (Req 10.7).
 */
export async function getPlatformSummary(
  userId: string,
  filter: DateRangeFilter = {}
): Promise<PlatformSummaryReport> {
  const cacheKey = platformCacheKey('platform-summary', JSON.stringify(filter));
  const cached = cacheGet<PlatformSummaryReport>(cacheKey);
  if (cached) {
    await logReportGeneration({ userId, reportType: 'platform-summary', dateRange: filter, fromCache: true });
    return cached;
  }

  // Fetch all tenants (Req 10.1)

const { data: tenants, error: tErr } = await supabaseAdmin
    .from('tenants')
    .select('id, name, status')
    .order('name');
  if (tErr) throw tErr;

  const tenantRows = tenants ?? [];

  // Fetch per-tenant summaries in parallel (Req 10.6)

const tenantBreakdowns = await Promise.all(
    tenantRows.map((t) => fetchTenantSummary(t.id, t.name, t.status, filter))
  );

  const report: PlatformSummaryReport = {
    generatedAt: new Date().toISOString(),
    dateRange: filter,
    totalTenants: tenantRows.length,
    activeTenants: tenantRows.filter((t) => t.status === 'active').length,
    totalPrograms: tenantBreakdowns.reduce((s, t) => s + t.programs, 0),
    totalEnrollments: tenantBreakdowns.reduce((s, t) => s + t.enrollments, 0),
    totalCompletions: tenantBreakdowns.reduce((s, t) => s + t.completions, 0),
    totalTrainees: tenantBreakdowns.reduce((s, t) => s + t.trainees, 0),
    totalItems: tenantBreakdowns.reduce((s, t) => s + t.items, 0),
    totalCertificates: tenantBreakdowns.reduce((s, t) => s + t.certificates, 0),
    tenantBreakdowns,
  };

  cacheSet(cacheKey, report, CACHE_TTL_MS);
  await logReportGeneration({ userId, reportType: 'platform-summary', dateRange: filter, fromCache: false });
  return report;
}

/**
 * Cross-tenant comparison report with per-LGU metrics (Req 10.6).
 * Restricted to Super Admin (enforced at route level).
 * Cached for 1 hour (Req 10.7).
 */
export async function getCrossTenantComparison(
  userId: string,
  filter: DateRangeFilter = {}
): Promise<CrossTenantComparisonReport> {
  const cacheKey = platformCacheKey('cross-tenant-comparison', JSON.stringify(filter));
  const cached = cacheGet<CrossTenantComparisonReport>(cacheKey);
  if (cached) {
    await logReportGeneration({ userId, reportType: 'cross-tenant-comparison', dateRange: filter, fromCache: true });
    return cached;
  }

const { data: tenants, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name, status')
    .order('name');
  if (error) throw error;

  const tenantRows = tenants ?? [];
  const summaries = await Promise.all(
    tenantRows.map((t) => fetchTenantSummary(t.id, t.name, t.status, filter))
  );

  // Fetch inventory totals for utilization rate

const inventoryTotals = await Promise.all(
    tenantRows.map(async (t) => {
      const { data } = await supabaseAdmin
        .from('items')
        .select('quantity, available_quantity')
        .eq('tenant_id', t.id);
      const rows = data ?? [];
      const total = rows.reduce((s, i) => s + i.quantity, 0);
      const borrowed = rows.reduce((s, i) => s + (i.quantity - i.available_quantity), 0);
      return total > 0 ? Math.round((borrowed / total) * 100) : 0;
    })
  );

  const report: CrossTenantComparisonReport = {
    generatedAt: new Date().toISOString(),
    dateRange: filter,
    tenants: summaries.map((s, i) => ({
      ...s,
      enrollmentRate: s.programs > 0 ? Math.round((s.enrollments / s.programs) * 100) : 0,
      completionRate: s.enrollments > 0 ? Math.round((s.completions / s.enrollments) * 100) : 0,
      inventoryUtilization: inventoryTotals[i],
    })),
  };

  cacheSet(cacheKey, report, CACHE_TTL_MS);
  await logReportGeneration({ userId, reportType: 'cross-tenant-comparison', dateRange: filter, fromCache: false });
  return report;
}

// ---------------------------------------------------------------------------
// Cache invalidation helper
// ---------------------------------------------------------------------------

/**
 * Invalidate all cached reports for a tenant.
 * Call this when tenant data changes significantly.
 */
export function invalidateTenantReportCache(tenantId: string): void {
  for (const key of reportCache.keys()) {
    if (key.startsWith(`tenant:${tenantId}:`)) {
      reportCache.delete(key);
    }
  }
}

/**
 * Invalidate all platform-level cached reports.
 */
export function invalidatePlatformReportCache(): void {
  for (const key of reportCache.keys()) {
    if (key.startsWith('platform:')) {
      reportCache.delete(key);
    }
  }
}
