/**
 * Multi-Tenant Authentication Service
 *
 * Implements Requirements 6.1, 6.2, 6.6, 6.7:
 *   - 6.1  Verify username and password against the Database_Schema
 *   - 6.2  Determine the user's tenant association after authentication succeeds
 *   - 6.6  Support multi-tenant login where users can belong to multiple tenants
 *   - 6.7  Prompt for tenant selection when a user belongs to multiple tenants
 *
 * Flow:
 *   1. Caller verifies credentials (password check) externally.
 *   2. Call `getUserTenants(userId)` to retrieve all tenant associations.
 *   3. If exactly one tenant → call `buildTenantScopedToken(user, tenantId)`.
 *   4. If multiple tenants → call `issueTenantSelectionToken(userId, tenants)`
 *      and return the list to the client so it can prompt for selection.
 *   5. Client POSTs chosen tenantId + selectionToken to /api/auth/select-tenant.
 *   6. Call `redeemTenantSelectionToken(selectionToken, tenantId)` to validate
 *      and get the final tenant-scoped JWT payload.
 */

import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateToken } from '@/lib/auth/jwt';
import type { UserRole } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantSummary {
  /** Tenant UUID */
  id: string;
  /** Human-readable LGU name */
  name: string;
  /** Whether this is the user's primary tenant */
  is_primary: boolean;
  /** Tenant status — inactive tenants should not be selectable */
  status: 'active' | 'inactive' | 'suspended';
}

export interface UserTenantInfo {
  userId: string;
  email: string;
  role: UserRole | string;
  tenants: TenantSummary[];
}

export interface TenantScopedTokenResult {
  token: string;
  tenantId: string;
  tenantName: string;
}

// ---------------------------------------------------------------------------
// In-memory selection token store
//
// A selection token is a short-lived (5-minute) opaque token issued when a
// user belongs to multiple tenants. It binds a userId to the set of tenants
// they are allowed to select from, preventing an attacker from choosing an
// arbitrary tenant after credential verification.
//
// NOTE: This in-memory store is suitable for single-process deployments.
// For multi-instance deployments replace with Redis or a database table.
// ---------------------------------------------------------------------------

interface SelectionTokenEntry {
  userId: string;
  email: string;
  role: UserRole | string;
  allowedTenantIds: Set<string>;
  expiresAt: number; // epoch ms
}

const selectionTokenStore = new Map<string, SelectionTokenEntry>();

/** Evict expired selection tokens every minute */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of selectionTokenStore) {
    if (entry.expiresAt <= now) selectionTokenStore.delete(key);
  }
}, 60_000);

/** Selection token lifetime: 5 minutes */
const SELECTION_TOKEN_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Core service functions
// ---------------------------------------------------------------------------

/**
 * Retrieve all active tenant associations for a given user.
 *
 * Joins `users_tenants` with `tenants` to return tenant metadata.
 * Only tenants with status 'active' are returned — inactive/suspended
 * tenants are excluded so users cannot log in to deactivated instances
 * (Req 1.7).
 *
 * @param userId - UUID of the authenticated user.
 * @returns Array of TenantSummary objects (may be empty if user has no tenants).
 */
export async function getUserTenants(userId: string): Promise<TenantSummary[]> {
  const { data, error } = await supabaseAdmin
    .from('users_tenants')
    .select(`
      is_primary,
      tenants (
        id,
        name,
        status
      )
    `)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to retrieve tenant associations: ${error.message}`);
  }

if (!data || data.length === 0) {
    return [];
  }

  // Flatten the join result and filter to active tenants only
  const tenants: TenantSummary[] = [];
  for (const row of data) {
    const tenant = row.tenants as unknown as { id: string; name: string; status: string } | null;
    if (!tenant) continue;
    // Only allow login to active tenants (Req 1.7)
    if (tenant.status !== 'active') continue;

    // Build the tenant summary object with proper type casting
    const tenantSummary: TenantSummary = {
      id: tenant.id,
      name: tenant.name,
      is_primary: row.is_primary,
      status: 'active' as const, // Status is guaranteed to be 'active' due to the check above
    };
    tenants.push(tenantSummary);
  }

  return tenants;
}

/**
 * Issue a short-lived selection token binding a userId to their allowed tenants.
 *
 * The token is returned to the client alongside the tenant list. The client
 * must present this token when calling /api/auth/select-tenant to prove that
 * the credential verification step was completed.
 *
 * @param userId  - UUID of the authenticated user.
 * @param email   - User's email address (included in final JWT).
 * @param role    - User's role (included in final JWT).
 * @param tenants - Tenants the user is allowed to select from.
 * @returns Opaque selection token string.
 */
export function issueTenantSelectionToken(
  userId: string,
  email: string,
  role: UserRole | string,
  tenants: TenantSummary[]
): string {
  const token = crypto.randomBytes(32).toString('hex');
  const allowedTenantIds = new Set(tenants.map((t) => t.id));

  selectionTokenStore.set(token, {
    userId,
    email,
    role,
    allowedTenantIds,
    expiresAt: Date.now() + SELECTION_TOKEN_TTL_MS,
  });

  return token;
}

/**
 * Redeem a tenant selection token and generate a tenant-scoped JWT.
 *
 * Validates:
 *   - Token exists and has not expired
 *   - The requested tenantId is in the allowed set for this token
 *
 * On success the token is consumed (deleted) to prevent replay.
 *
 * @param selectionToken - Opaque token issued by `issueTenantSelectionToken`.
 * @param tenantId       - UUID of the tenant the user selected.
 * @returns Tenant-scoped JWT string, or null if validation fails.
 */
export function redeemTenantSelectionToken(
  selectionToken: string,
  tenantId: string
): { token: string; userId: string; email: string; role: UserRole | string } | null {
  const entry = selectionTokenStore.get(selectionToken);

  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    selectionTokenStore.delete(selectionToken);
    return null;
  }

if (!entry.allowedTenantIds.has(tenantId)) return null;

  // Consume the token (one-time use)
  selectionTokenStore.delete(selectionToken);

  const jwt = generateToken({
    userId: entry.userId,
    email: entry.email,
    role: entry.role,
    tenantId,
  });

  return {
    token: jwt,
    userId: entry.userId,
    email: entry.email,
    role: entry.role,
  };
}

/**
 * Generate a tenant-scoped JWT directly (used when user has exactly one tenant).
 *
 * @param userId   - UUID of the authenticated user.
 * @param email    - User's email address.
 * @param role     - User's role.
 * @param tenantId - UUID of the user's single tenant.
 * @returns Signed JWT string.
 */
export function generateTenantScopedToken(
  userId: string,
  email: string,
  role: UserRole | string,
  tenantId: string
): string {
  return generateToken({ userId, email, role, tenantId });
}
