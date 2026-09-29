/**
 * Tenant Context Utility Functions
 *
 * Implements Requirements 14.6 and 14.8:
 *   - 14.6  Helper functions for tenant-scoped queries reducing code duplication
 *   - 14.8  Request logging capturing tenant_id, user_id, endpoint, timestamp
 *
 * These utilities complement the tenant context extraction (Task 3.1) and
 * Supabase client injection (Task 3.2). They are the primary building blocks
 * used by API route handlers to perform tenant-scoped database operations
 * without repeating boilerplate.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/utils/logger';
import type { TenantContext } from '@/middleware/tenantContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for tenant-scoped query helpers.
 */
export interface TenantQueryOptions {
  /** Additional equality filters applied on top of the tenant_id filter. */
  filters?: Record<string, unknown>;
  /** Column to order results by. */
  orderBy?: { column: string; ascending?: boolean };
  /** Maximum number of rows to return. */
  limit?: number;
  /** Number of rows to skip (for pagination). */
  offset?: number;
  /** Columns to select (defaults to '*'). */
  select?: string;
}

/**
 * Structured request log entry captured for every authenticated API call.
 * Satisfies Requirement 14.8.
 */
export interface RequestLogEntry {
  tenant_id: string;
  user_id: string;
  role: string;
  endpoint: string;
  method: string;
  timestamp: string;
  is_super_admin: boolean;
}

// ---------------------------------------------------------------------------
// Request logging (Req 14.8)
// ---------------------------------------------------------------------------

/**
 * Log an authenticated API request with tenant context.
 *
 * Captures tenant_id, user_id, endpoint, method, timestamp, and role.
 * Emits a structured log entry at INFO level so it can be aggregated by
 * any log-shipping infrastructure.
 *
 * @example
 * ```ts
 * logTenantRequest(context, request.method, request.nextUrl.pathname);
 * ```
 */
export function logTenantRequest(
  context: TenantContext,
  method: string,
  endpoint: string
): RequestLogEntry {
  const entry: RequestLogEntry = {
    tenant_id: context.tenantId,
    user_id: context.userId,
    role: context.role,
    endpoint,
    method: method.toUpperCase(),
    timestamp: new Date().toISOString(),
    is_super_admin: context.isSuperAdmin,
  };

  logger.info('[TENANT_REQUEST]', entry);

  return entry;
}

// ---------------------------------------------------------------------------
// Tenant-scoped query helpers (Req 14.6)
// ---------------------------------------------------------------------------

/**
 * Fetch all rows from a table that belong to the given tenant.
 *
 * RLS policies already enforce tenant isolation at the database level, but
 * this helper adds an explicit `tenant_id` filter as a defence-in-depth
 * measure and to make query intent clear in application code.
 *
 * @param client  - Supabase client already configured with tenant context
 *                  (via `createTenantSupabaseClient` from Task 3.2).
 * @param table   - Table name to query.
 * @param context - Resolved tenant context from the request.
 * @param options - Optional filters, ordering, pagination, and column selection.
 *
 * @example
 * ```ts
 * const { data, error } = await tenantQuery(supabase, 'programs', context);
 * ```
 */
export async function tenantQuery<T = unknown>(
  client: SupabaseClient,
  table: string,
  context: TenantContext,
  options: TenantQueryOptions = {}
): Promise<{ data: T[] | null; error: unknown }> {
  const { filters, orderBy, limit, offset, select = '*' } = options;

  // Super Admins bypass tenant filtering to allow cross-tenant queries.

let query = client.from(table).select(select);

  if (!context.isSuperAdmin) {
    query = query.eq('tenant_id', context.tenantId);
  }

if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      query = query.eq(key, value as string);
    }
  }

if (orderBy) {
    query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
  }

if (typeof limit === 'number') {
    query = query.limit(limit);
  }

if (typeof offset === 'number') {
    query = query.range(offset, offset + (limit ?? 1000) - 1);
  }

const { data, error } = await query;
  return { data: data as T[] | null, error };
}

/**
 * Fetch a single row by its primary key, scoped to the current tenant.
 *
 * Returns `null` when the row does not exist or belongs to a different tenant.
 *
 * @param client  - Tenant-configured Supabase client.
 * @param table   - Table name.
 * @param id      - Primary key value (UUID).
 * @param context - Resolved tenant context.
 * @param select  - Columns to select (defaults to '*').
 *
 * @example
 * ```ts
 * const { data, error } = await tenantFindById(supabase, 'programs', programId, context);
 * ```
 */
export async function tenantFindById<T = unknown>(
  client: SupabaseClient,
  table: string,
  id: string,
  context: TenantContext,
  select = '*'
): Promise<{ data: T | null; error: unknown }> {
  let query = client.from(table).select(select).eq('id', id);

  if (!context.isSuperAdmin) {
    query = query.eq('tenant_id', context.tenantId);
  }

const { data, error } = await query.maybeSingle();
  return { data: data as T | null, error };
}

/**
 * Insert a new row into a tenant-scoped table.
 *
 * Automatically injects `tenant_id` from the context so callers never need
 * to set it manually.
 *
 * @param client  - Tenant-configured Supabase client.
 * @param table   - Table name.
 * @param payload - Row data (without tenant_id — it is injected automatically).
 * @param context - Resolved tenant context.
 *
 * @example
 * ```ts
 * const { data, error } = await tenantInsert(supabase, 'programs', programData, context);
 * ```
 */
export async function tenantInsert<T = unknown>(
  client: SupabaseClient,
  table: string,
  payload: Record<string, unknown>,
  context: TenantContext
): Promise<{ data: T | null; error: unknown }> {
  const row = { ...payload, tenant_id: context.tenantId };

  const { data, error } = await client.from(table).insert(row).select().maybeSingle();
  return { data: data as T | null, error };
}

/**
 * Update a row in a tenant-scoped table.
 *
 * The update is constrained to the current tenant so a user cannot modify
 * records belonging to another tenant even if they know the row ID.
 *
 * @param client  - Tenant-configured Supabase client.
 * @param table   - Table name.
 * @param id      - Primary key of the row to update.
 * @param payload - Fields to update.
 * @param context - Resolved tenant context.
 *
 * @example
 * ```ts
 * const { data, error } = await tenantUpdate(supabase, 'programs', id, updates, context);
 * ```
 */
export async function tenantUpdate<T = unknown>(
  client: SupabaseClient,
  table: string,
  id: string,
  payload: Record<string, unknown>,
  context: TenantContext
): Promise<{ data: T | null; error: unknown }> {
  let query = client.from(table).update(payload).eq('id', id);

  if (!context.isSuperAdmin) {
    query = query.eq('tenant_id', context.tenantId);
  }

const { data, error } = await query.select().maybeSingle();
  return { data: data as T | null, error };
}

/**
 * Delete a row from a tenant-scoped table.
 *
 * The deletion is constrained to the current tenant.
 *
 * @param client  - Tenant-configured Supabase client.
 * @param table   - Table name.
 * @param id      - Primary key of the row to delete.
 * @param context - Resolved tenant context.
 *
 * @example
 * ```ts
 * const { error } = await tenantDelete(supabase, 'programs', id, context);
 * ```
 */
export async function tenantDelete(
  client: SupabaseClient,
  table: string,
  id: string,
  context: TenantContext
): Promise<{ error: unknown }> {
  let query = client.from(table).delete().eq('id', id);

  if (!context.isSuperAdmin) {
    query = query.eq('tenant_id', context.tenantId);
  }

const { error } = await query;
  return { error };
}

/**
 * Count rows in a tenant-scoped table matching optional filters.
 *
 * Useful for pagination metadata and dashboard statistics.
 *
 * @param client  - Tenant-configured Supabase client.
 * @param table   - Table name.
 * @param context - Resolved tenant context.
 * @param filters - Optional additional equality filters.
 *
 * @example
 * ```ts
 * const { count, error } = await tenantCount(supabase, 'trainees', context, { status: 'active' });
 * ```
 */
export async function tenantCount(
  client: SupabaseClient,
  table: string,
  context: TenantContext,
  filters?: Record<string, unknown>
): Promise<{ count: number | null; error: unknown }> {
  let query = client.from(table).select('*', { count: 'exact', head: true });

  if (!context.isSuperAdmin) {
    query = query.eq('tenant_id', context.tenantId);
  }

if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      query = query.eq(key, value as string);
    }
  }

const { count, error } = await query;
  return { count, error };
}
