/**
 * Tenant Provisioning Service
 *
 * Implements Requirements 1.1, 1.2, 1.3, 1.4, 1.5:
 *   - 1.1  Generate a unique tenant identifier (UUID v4) when creating a new tenant
 *   - 1.2  Initialize the Database_Schema with tenant-specific RLS context
 *   - 1.3  Create default TenantConfiguration with placeholder branding and settings
 *   - 1.4  Validate that the tenant name is unique across the Platform
 *   - 1.5  Store tenant metadata including name, creation date, status, and contact information
 *
 * This service uses the supabaseAdmin client (service role key) to bypass RLS
 * for platform-level operations such as creating tenants and their initial admin
 * user. All tenant-scoped operations performed by regular users go through the
 * RLS-enforced supabase client.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { hashPassword } from '@/lib/auth';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateTenantParams {
  /** Human-readable LGU name — must be unique across the platform (Req 1.4) */
  name: string;
  /** Primary contact email for the tenant */
  contactEmail: string;
  /** Optional contact phone number */
  contactPhone?: string;
  /** Optional physical address */
  address?: string;
  /** Email for the default Local Admin user account */
  adminEmail: string;
  /** Username for the default Local Admin user account */
  adminUsername: string;
  /** Password for the default Local Admin user account */
  adminPassword: string;
}

export interface TenantConfiguration {
  branding: {
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    welcomeMessage: string;
  };
  features: {
    inventoryManagement: boolean;
    certificateGeneration: boolean;
    qrCodeAttendance: boolean;
    mobileAppAccess: boolean;
  };
  notifications: {
    whatsapp: null;
    email: null;
  };
}

export interface CreatedTenant {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'suspended';
  contactEmail: string;
  contactPhone: string | null;
  address: string | null;
  configuration: TenantConfiguration;
  createdAt: string;
  updatedAt: string;
  adminUser: {
    id: string;
    email: string;
    username: string;
    role: string;
  };
}

// ---------------------------------------------------------------------------
// Default configuration factory
// ---------------------------------------------------------------------------

/**
 * Build the default TenantConfiguration for a newly provisioned tenant.
 *
 * Implements Req 1.3: Initialize default Tenant_Configuration with placeholder
 * branding (default colors, welcome message) and all features disabled by
 * default (feature flags are managed separately via the feature_flags table).
 */
function buildDefaultConfiguration(tenantName: string): TenantConfiguration {
  return {
    branding: {
      logoUrl: null,
      primaryColor: '#1a56db',    // Default blue — matches the platform design system
      secondaryColor: '#7e3af2',  // Default purple accent
      welcomeMessage: `Welcome to ${tenantName} Training Management System`,
    },
    features: {
      inventoryManagement: true,
      certificateGeneration: false,
      qrCodeAttendance: false,
      mobileAppAccess: false,
    },
    notifications: {
      whatsapp: null,
      email: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Core service functions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types for management operations (Task 4.2)
// ---------------------------------------------------------------------------

export interface TenantSummary {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'suspended';
  contactEmail: string;
  contactPhone: string | null;
  address: string | null;
  configuration: TenantConfiguration;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Management service functions (Req 1.6, 1.7, 1.8)
// ---------------------------------------------------------------------------

/**
 * Return all tenant instances with their current status and configuration.
 *
 * Implements Req 1.6: Super_Admin requests tenant list → Platform returns all
 * tenant instances with their current status and configuration summary.
 *
 * @returns Array of all tenants ordered by creation date (newest first).
 */
export async function getAllTenants(): Promise<TenantSummary[]> {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name, status, contact_email, contact_phone, address, configuration, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('[TENANT_MANAGEMENT] Failed to fetch tenants', { error });
    throw new Error(`Failed to fetch tenants: ${error.message}`);
  }

  return (data ?? []).map(mapTenantRow);
}

/**
 * Return a single tenant by its UUID.
 *
 * @param tenantId - UUID of the tenant to retrieve.
 * @returns The tenant record, or null if not found.
 */
export async function getTenantById(tenantId: string): Promise<TenantSummary | null> {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name, status, contact_email, contact_phone, address, configuration, created_at, updated_at')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) {
    logger.error('[TENANT_MANAGEMENT] Failed to fetch tenant by id', { error, tenantId });
    throw new Error(`Failed to fetch tenant: ${error.message}`);
  }

  return data ? mapTenantRow(data) : null;
}

/**
 * Deactivate a tenant — prevents all user access while preserving data.
 *
 * Implements Req 1.7: Super_Admin deactivates a tenant → Platform prevents
 * all user access to that Instance while preserving data.
 *
 * @param tenantId - UUID of the tenant to deactivate.
 * @returns The updated tenant record.
 * @throws Error if tenant not found or already inactive.
 */
export async function deactivateTenant(tenantId: string): Promise<TenantSummary> {
  // Verify tenant exists

const existing = await getTenantById(tenantId);
  if (!existing) {
    throw new Error(`Tenant not found`);
  }

if (existing.status === 'inactive') {
    throw new Error(`Tenant is already inactive`);
  }

const { data, error } = await supabaseAdmin
    .from('tenants')
    .update({ status: 'inactive', updated_at: new Date().toISOString() })
    .eq('id', tenantId)
    .select('id, name, status, contact_email, contact_phone, address, configuration, created_at, updated_at')
    .single();

  if (error || !data) {
    logger.error('[TENANT_MANAGEMENT] Failed to deactivate tenant', { error, tenantId });
    throw new Error(`Failed to deactivate tenant: ${error?.message ?? 'Unknown error'}`);
  }

  logger.info('[TENANT_MANAGEMENT] Tenant deactivated', { tenantId, name: data.name });
  return mapTenantRow(data);
}

/**
 * Reactivate a tenant — restores user access.
 *
 * Implements Req 1.8: Super_Admin reactivates a tenant → Platform restores
 * user access to that Instance.
 *
 * @param tenantId - UUID of the tenant to reactivate.
 * @returns The updated tenant record.
 * @throws Error if tenant not found or already active.
 */
export async function reactivateTenant(tenantId: string): Promise<TenantSummary> {
  // Verify tenant exists

const existing = await getTenantById(tenantId);
  if (!existing) {
    throw new Error(`Tenant not found`);
  }

if (existing.status === 'active') {
    throw new Error(`Tenant is already active`);
  }

const { data, error } = await supabaseAdmin
    .from('tenants')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', tenantId)
    .select('id, name, status, contact_email, contact_phone, address, configuration, created_at, updated_at')
    .single();

  if (error || !data) {
    logger.error('[TENANT_MANAGEMENT] Failed to reactivate tenant', { error, tenantId });
    throw new Error(`Failed to reactivate tenant: ${error?.message ?? 'Unknown error'}`);
  }

  logger.info('[TENANT_MANAGEMENT] Tenant reactivated', { tenantId, name: data.name });
  return mapTenantRow(data);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Map a raw Supabase row to a TenantSummary. */
function mapTenantRow(row: Record<string, unknown>): TenantSummary {
  return {
    id: row.id as string,
    name: row.name as string,
    status: row.status as 'active' | 'inactive' | 'suspended',
    contactEmail: row.contact_email as string,
    contactPhone: (row.contact_phone as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    configuration: row.configuration as TenantConfiguration,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// Uniqueness check (used by provisioning)
// ---------------------------------------------------------------------------

/**
 * Check whether a tenant name is already in use across the platform.
 *
 * Implements Req 1.4: Validate that the tenant name is unique.
 *
 * @param name - Proposed tenant name (case-insensitive comparison).
 * @returns true if the name is already taken, false if available.
 */
export async function isTenantNameTaken(name: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .ilike('name', name)
    .maybeSingle();

  if (error) {
    logger.error('[TENANT_PROVISIONING] Error checking tenant name uniqueness', { error, name });
    throw new Error(`Failed to check tenant name uniqueness: ${error.message}`);
  }

  return data !== null;
}

/**
 * Create a new tenant instance with default configuration and a Local Admin user.
 *
 * Steps performed atomically (best-effort — Supabase does not support true
 * multi-statement transactions via the REST API, so we clean up on failure):
 *   1. Validate tenant name uniqueness (Req 1.4)
 *   2. Insert tenant record with UUID v4 PK (Req 1.1) and default config (Req 1.3)
 *   3. Create default Local Admin user account (Req 1.5)
 *   4. Link user to tenant via users_tenants junction table
 *
 * @param params - Tenant creation parameters.
 * @returns The created tenant with its admin user details.
 * @throws Error if name is taken, email is already in use, or a DB error occurs.
 */
export async function createTenant(params: CreateTenantParams): Promise<CreatedTenant> {
  const {
    name,
    contactEmail,
    contactPhone,
    address,
    adminEmail,
    adminUsername,
    adminPassword,
  } = params;

  // ── Step 1: Validate tenant name uniqueness (Req 1.4) ───────────────────

const nameTaken = await isTenantNameTaken(name);
  if (nameTaken) {
    throw new Error(`A tenant with the name "${name}" already exists`);
  }

  // ── Step 2: Check admin email uniqueness ────────────────────────────────

const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', adminEmail.toLowerCase())
    .maybeSingle();

  if (existingUser) {
    throw new Error(`A user with email "${adminEmail}" already exists`);
  }

  // ── Step 3: Check admin username uniqueness ──────────────────────────────

const { data: existingUsername } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('username', adminUsername)
    .maybeSingle();

  if (existingUsername) {
    throw new Error(`A user with username "${adminUsername}" already exists`);
  }

  // ── Step 4: Build default configuration (Req 1.3) ───────────────────────

const configuration = buildDefaultConfiguration(name);

  // ── Step 5: Insert tenant record (Req 1.1, 1.5) ─────────────────────────
  // UUID v4 is generated by PostgreSQL's gen_random_uuid() (DEFAULT on the PK)

const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .insert({
      name,
      status: 'active',
      contact_email: contactEmail,
      contact_phone: contactPhone ?? null,
      address: address ?? null,
      configuration,
    })
    .select('id, name, status, contact_email, contact_phone, address, configuration, created_at, updated_at')
    .single();

  if (tenantError || !tenant) {
    logger.error('[TENANT_PROVISIONING] Failed to create tenant record', { error: tenantError, name });
    throw new Error(`Failed to create tenant: ${tenantError?.message ?? 'Unknown error'}`);
  }

  logger.info('[TENANT_PROVISIONING] Tenant record created', { tenantId: tenant.id, name });

  // ── Step 6: Hash admin password ──────────────────────────────────────────

const passwordHash = await hashPassword(adminPassword);

  // ── Step 7: Create default Local Admin user (Req 1.5) ───────────────────

const { data: adminUser, error: userError } = await supabaseAdmin
    .from('users')
    .insert({
      email: adminEmail.toLowerCase(),
      username: adminUsername,
      password_hash: passwordHash,
      role: 'local_admin',
    })
    .select('id, email, username, role')
    .single();

  if (userError || !adminUser) {
    // Rollback: delete the tenant we just created
    logger.error('[TENANT_PROVISIONING] Failed to create admin user — rolling back tenant', {
      error: userError,
      tenantId: tenant.id,
    });
    await supabaseAdmin.from('tenants').delete().eq('id', tenant.id);
    throw new Error(`Failed to create admin user: ${userError?.message ?? 'Unknown error'}`);
  }

  logger.info('[TENANT_PROVISIONING] Admin user created', {
    userId: adminUser.id,
    tenantId: tenant.id,
  });

  // ── Step 8: Link admin user to tenant (users_tenants junction) ───────────

const { error: linkError } = await supabaseAdmin
    .from('users_tenants')
    .insert({
      user_id: adminUser.id,
      tenant_id: tenant.id,
      is_primary: true,
    });

  if (linkError) {
    // Rollback: delete user and tenant
    logger.error('[TENANT_PROVISIONING] Failed to link admin user to tenant — rolling back', {
      error: linkError,
      tenantId: tenant.id,
      userId: adminUser.id,
    });
    await supabaseAdmin.from('users').delete().eq('id', adminUser.id);
    await supabaseAdmin.from('tenants').delete().eq('id', tenant.id);
    throw new Error(`Failed to link admin user to tenant: ${linkError.message}`);
  }

  logger.info('[TENANT_PROVISIONING] Admin user linked to tenant', {
    userId: adminUser.id,
    tenantId: tenant.id,
  });

  // ── Step 9: Initialize default feature flags ─────────────────────────────
  // Insert default feature flags for the new tenant.
  // Enabled by default: inventory_management, mobile_app_access
  // Disabled by default: certificate_generation, qr_code_attendance, whatsapp_notifications, email_notifications

const defaultFeatureFlags = [
    { tenant_id: tenant.id, feature_key: 'inventory_management', enabled: true },
    { tenant_id: tenant.id, feature_key: 'certificate_generation', enabled: false },
    { tenant_id: tenant.id, feature_key: 'qr_code_attendance', enabled: false },
    { tenant_id: tenant.id, feature_key: 'mobile_app_access', enabled: true },
    { tenant_id: tenant.id, feature_key: 'whatsapp_notifications', enabled: false },
    { tenant_id: tenant.id, feature_key: 'email_notifications', enabled: false },
  ];

  const { error: flagsError } = await supabaseAdmin
    .from('feature_flags')
    .insert(defaultFeatureFlags);

  if (flagsError) {
    // Non-fatal: log but don't rollback — feature flags can be re-created
    logger.warn('[TENANT_PROVISIONING] Failed to initialize feature flags (non-fatal)', {
      error: flagsError,
      tenantId: tenant.id,
    });
  }

  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status as 'active' | 'inactive' | 'suspended',
    contactEmail: tenant.contact_email,
    contactPhone: tenant.contact_phone ?? null,
    address: tenant.address ?? null,
    configuration: tenant.configuration as TenantConfiguration,
    createdAt: tenant.created_at,
    updatedAt: tenant.updated_at,
    adminUser: {
      id: adminUser.id,
      email: adminUser.email,
      username: adminUser.username,
      role: adminUser.role,
    },
  };
}
