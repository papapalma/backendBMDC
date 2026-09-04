/**
 * Tenant Configuration Service (3NF Normalized)
 *
 * Implements Requirements 4.3, 4.4, 11.1, 11.2, 11.3, 11.4, 11.5:
 *   - 4.3  Local Admin configures Tenant_Configuration (LGU name, logo, contact details, announcements)
 *   - 4.4  Local Admin customizes branding (colors, logos, welcome messages)
 *   - 11.1 Local Admin uploads a custom logo (validated for size ≤ 2 MB and format PNG/JPG/SVG)
 *   - 11.2 Local Admin configures primary and secondary brand colors
 *   - 11.3 Local Admin customizes the welcome message on the login page
 *   - 11.4 Local Admin configures contact information
 *   - 11.5 Local Admin creates local announcements displayed on the dashboard
 *
 * NORMALIZATION (3NF):
 * - Configuration is now split across multiple normalized tables:
 *   - tenant_branding: Logo, colors, welcome message (1-to-1 with tenants)
 *   - tenant_notification_channels: Email/SMS/Push/WhatsApp configs (many-to-1 with tenants)
 *   - tenant_features: Feature flags (many-to-1 with tenants)
 *   - tenants.configuration JSONB: Announcements (kept temporarily for backward compat)
 *
 * This service constructs a unified FullTenantConfiguration view by joining
 * these normalized tables, maintaining backward compatibility.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { cacheGetOrSet, cacheDelete, tenantCacheKey, TTL } from '@/lib/cache';
import type { TenantConfiguration } from './tenantProvisioningService';

// ---------------------------------------------------------------------------
// Extended configuration types
// ---------------------------------------------------------------------------

/**
 * WhatsApp Business API configuration per tenant.
 */
export interface WhatsAppConfig {
  /** WhatsApp Business API access token */
  accessToken: string;
  /** Phone number ID registered in the WhatsApp Business API */
  phoneNumberId: string;
  /** Business Account ID */
  businessAccountId: string;
  /** Default message template namespace */
  templateNamespace?: string;
}

/**
 * SMTP email configuration per tenant.
 */
export interface EmailConfig {
  /** Sender display name */
  senderName: string;
  /** Sender email address */
  senderEmail: string;
  /** SMTP host */
  smtpHost: string;
  /** SMTP port (typically 587 for TLS, 465 for SSL) */
  smtpPort: number;
  /** Whether to use TLS */
  useTls: boolean;
  /** SMTP authentication username */
  smtpUsername: string;
  /** SMTP authentication password */
  smtpPassword: string;
}

/**
 * Full tenant configuration including extended notification settings.
 */
export interface FullTenantConfiguration {
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
    whatsapp: WhatsAppConfig | null;
    email: EmailConfig | null;
  };
  contact?: {
    phone?: string;
    email?: string;
    address?: string;
    website?: string;
  };
  announcements?: Array<{
    id: string;
    title: string;
    content: string;
    createdAt: string;
    expiresAt?: string | null;
  }>;
}

/**
 * Partial branding update payload.
 */
export interface BrandingUpdate {
  logoUrl?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
  welcomeMessage?: string;
}

/**
 * Partial feature flags update payload.
 */
export interface FeaturesUpdate {
  inventoryManagement?: boolean;
  certificateGeneration?: boolean;
  qrCodeAttendance?: boolean;
  mobileAppAccess?: boolean;
}

/**
 * Partial notification settings update payload.
 */
export interface NotificationsUpdate {
  whatsapp?: WhatsAppConfig | null;
  email?: EmailConfig | null;
}

/**
 * Contact information update payload.
 */
export interface ContactUpdate {
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
}

/**
 * Announcement payload for creating/updating announcements.
 */
export interface AnnouncementPayload {
  title: string;
  content: string;
  expiresAt?: string | null;
}

/**
 * Top-level configuration update payload.
 * All fields are optional — only supplied fields are merged.
 */
export interface ConfigurationUpdatePayload {
  branding?: BrandingUpdate;
  features?: FeaturesUpdate;
  notifications?: NotificationsUpdate;
  contact?: ContactUpdate;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Allowed logo file formats (Req 11.1) */
const ALLOWED_LOGO_FORMATS = ['png', 'jpg', 'jpeg', 'svg'];

/** Maximum logo file size in bytes: 2 MB (Req 11.1) */
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

/** Hex color regex */
const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

/**
 * Validate a hex color string.
 * Returns an error message if invalid, or null if valid.
 */
export function validateHexColor(color: string): string | null {
  if (!HEX_COLOR_REGEX.test(color)) {
    return `"${color}" is not a valid hex color (expected format: #RGB or #RRGGBB)`;
  }
  return null;
}

/**
 * Validate a logo URL for format and (optionally) size.
 *
 * Checks that the URL ends with an allowed extension (Req 11.1).
 * Actual file-size enforcement happens at upload time; here we only
 * validate the URL format.
 *
 * Returns an error message if invalid, or null if valid.
 */
export function validateLogoUrl(logoUrl: string): string | null {
  if (!logoUrl) return null; // null/empty is allowed (removes logo)

  try {
    const url = new URL(logoUrl);
    const pathname = url.pathname.toLowerCase();
    const hasAllowedExtension = ALLOWED_LOGO_FORMATS.some(ext =>
      pathname.endsWith(`.${ext}`)
    );
    if (!hasAllowedExtension) {
      return `Logo URL must point to a PNG, JPG, or SVG file (got: ${pathname})`;
    }
  } catch {
    // Not a full URL — treat as a relative path

const lower = logoUrl.toLowerCase();
    const hasAllowedExtension = ALLOWED_LOGO_FORMATS.some(ext =>
      lower.endsWith(`.${ext}`)
    );
    if (!hasAllowedExtension) {
      return `Logo path must end with .png, .jpg, .jpeg, or .svg (got: ${logoUrl})`;
    }
  }

  return null;
}

/**
 * Validate a branding update payload.
 * Returns an array of validation error messages (empty if valid).
 */
export function validateBrandingUpdate(branding: BrandingUpdate): string[] {
  const errors: string[] = [];

  if (branding.logoUrl !== undefined && branding.logoUrl !== null) {
    const logoError = validateLogoUrl(branding.logoUrl);
    if (logoError) errors.push(logoError);
  }

if (branding.primaryColor !== undefined) {
    const colorError = validateHexColor(branding.primaryColor);
    if (colorError) errors.push(`primaryColor: ${colorError}`);
  }

if (branding.secondaryColor !== undefined) {
    const colorError = validateHexColor(branding.secondaryColor);
    if (colorError) errors.push(`secondaryColor: ${colorError}`);
  }

if (branding.welcomeMessage !== undefined) {
    if (typeof branding.welcomeMessage !== 'string') {
      errors.push('welcomeMessage must be a string');
    } else if (branding.welcomeMessage.trim().length === 0) {
      errors.push('welcomeMessage must not be empty');
    } else if (branding.welcomeMessage.length > 500) {
      errors.push('welcomeMessage must not exceed 500 characters');
    }
  }

  return errors;
}

/**
 * Validate a notification settings update payload.
 * Returns an array of validation error messages (empty if valid).
 */
export function validateNotificationsUpdate(notifications: NotificationsUpdate): string[] {
  const errors: string[] = [];

  if (notifications.whatsapp !== undefined && notifications.whatsapp !== null) {
    const wa = notifications.whatsapp;
    if (!wa.accessToken?.trim()) {
      errors.push('notifications.whatsapp.accessToken is required');
    }

if (!wa.phoneNumberId?.trim()) {
      errors.push('notifications.whatsapp.phoneNumberId is required');
    }

if (!wa.businessAccountId?.trim()) {
      errors.push('notifications.whatsapp.businessAccountId is required');
    }
  }

if (notifications.email !== undefined && notifications.email !== null) {
    const em = notifications.email;
    if (!em.senderName?.trim()) {
      errors.push('notifications.email.senderName is required');
    }

if (!em.senderEmail?.trim()) {
      errors.push('notifications.email.senderEmail is required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.senderEmail)) {
      errors.push('notifications.email.senderEmail must be a valid email address');
    }

if (!em.smtpHost?.trim()) {
      errors.push('notifications.email.smtpHost is required');
    }

if (typeof em.smtpPort !== 'number' || em.smtpPort < 1 || em.smtpPort > 65535) {
      errors.push('notifications.email.smtpPort must be a number between 1 and 65535');
    }

if (!em.smtpUsername?.trim()) {
      errors.push('notifications.email.smtpUsername is required');
    }

if (!em.smtpPassword?.trim()) {
      errors.push('notifications.email.smtpPassword is required');
    }
  }

  return errors;
}

/**
 * Validate the full configuration update payload.
 * Returns an array of validation error messages (empty if valid).
 */
export function validateConfigurationUpdate(payload: ConfigurationUpdatePayload): string[] {
  const errors: string[] = [];

  if (payload.branding) {
    errors.push(...validateBrandingUpdate(payload.branding));
  }

if (payload.notifications) {
    errors.push(...validateNotificationsUpdate(payload.notifications));
  }

if (payload.contact) {
    const { email } = payload.contact;
    if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('contact.email must be a valid email address');
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Core service functions
// ---------------------------------------------------------------------------

/**
 * Retrieve the current configuration for a tenant.
 *
 * Reconstructs the full configuration from normalized tables:
 * - tenant_branding (1-to-1): Logo, colors, welcome message
 * - tenant_notification_channels (many): Email, SMS, Push, WhatsApp
 * - tenant_features (many): Feature flags
 * - tenants.configuration JSONB: Announcements (backward compat)
 *
 * @param tenantId - UUID of the tenant.
 * @returns The current FullTenantConfiguration, or null if tenant not found.
 */
export async function getTenantConfiguration(
  tenantId: string
): Promise<FullTenantConfiguration | null> {
  // Cache tenant configuration for 15 minutes (Req 19.5)
  const cacheKey = tenantCacheKey(tenantId, 'config');
  return cacheGetOrSet<FullTenantConfiguration | null>(
    cacheKey,
    TTL.TENANT_CONFIG,
    async () => {
      try {
        // Fetch branding (1-to-1)
        const { data: brandingData, error: brandingError } = await supabaseAdmin
          .from('tenant_branding')
          .select('logo_url, primary_color, secondary_color, welcome_message')
          .eq('tenant_id', tenantId)
          .maybeSingle();

        if (brandingError) {
          logger.warn('[TENANT_CONFIG] Failed to fetch branding', { error: brandingError, tenantId });
        }

        // Fetch features (many)
        const { data: featuresData, error: featuresError } = await supabaseAdmin
          .from('tenant_features')
          .select('feature_name, is_enabled')
          .eq('tenant_id', tenantId);

        if (featuresError) {
          logger.warn('[TENANT_CONFIG] Failed to fetch features', { error: featuresError, tenantId });
        }

        // Fetch notification channels (many)
        const { data: channelsData, error: channelsError } = await supabaseAdmin
          .from('tenant_notification_channels')
          .select('channel_type, is_enabled, configuration')
          .eq('tenant_id', tenantId);

        if (channelsError) {
          logger.warn('[TENANT_CONFIG] Failed to fetch notification channels', { error: channelsError, tenantId });
        }

        // Fetch announcements from old JSONB column (backward compat)
        const { data: tenantData, error: tenantError } = await supabaseAdmin
          .from('tenants')
          .select('configuration')
          .eq('id', tenantId)
          .maybeSingle();

        if (tenantError) {
          logger.error('[TENANT_CONFIG] Failed to fetch tenant', { error: tenantError, tenantId });
          return null;
        }

        if (!tenantData) return null;

        // Reconstruct configuration from normalized tables
        const branding = brandingData ? {
          logoUrl: brandingData.logo_url ?? null,
          primaryColor: brandingData.primary_color ?? '#007bff',
          secondaryColor: brandingData.secondary_color ?? '#6c757d',
          welcomeMessage: brandingData.welcome_message ?? '',
        } : {
          logoUrl: null,
          primaryColor: '#007bff',
          secondaryColor: '#6c757d',
          welcomeMessage: '',
        };

        const features: Record<string, boolean> = {
          inventoryManagement: false,
          certificateGeneration: false,
          qrCodeAttendance: false,
          mobileAppAccess: false,
        };

        if (featuresData) {
          for (const feat of featuresData) {
            const key = feat.feature_name
              .replace('_', '')
              .replace(/^(.)/, (c: string) => c.toLowerCase())
              .split('_')
              .reduce((acc: string, part: string, i: number) => 
                acc + (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)), '');
            
            if (feat.feature_name === 'inventory_management') features.inventoryManagement = feat.is_enabled;
            if (feat.feature_name === 'certificate_generation') features.certificateGeneration = feat.is_enabled;
            if (feat.feature_name === 'qr_code_attendance') features.qrCodeAttendance = feat.is_enabled;
            if (feat.feature_name === 'mobile_app_access') features.mobileAppAccess = feat.is_enabled;
          }
        }

        // Reconstruct notifications from channels
        const notifications: Record<string, any> = {
          whatsapp: null,
          email: null,
        };

        if (channelsData) {
          for (const channel of channelsData) {
            if (channel.channel_type === 'whatsapp' && channel.is_enabled) {
              notifications.whatsapp = channel.configuration ?? null;
            } else if (channel.channel_type === 'email' && channel.is_enabled) {
              notifications.email = channel.configuration ?? null;
            }
          }
        }

        // Extract announcements from old JSONB (backward compat)
        const announcements = (tenantData.configuration as any)?.announcements ?? [];

        return {
          branding,
          features: features as any,
          notifications: notifications as any,
          announcements,
        } as FullTenantConfiguration;
      } catch (err) {
        logger.error('[TENANT_CONFIG] Error constructing configuration', { error: err, tenantId });
        return null;
      }
    }
  );
}

/**
 * Update the configuration for a tenant using normalized tables.
 *
 * Writes to:
 * - tenant_branding: Logo, colors, welcome message
 * - tenant_notification_channels: Email/SMS/Push/WhatsApp configs
 * - tenant_features: Feature flags
 * - tenants.configuration JSONB: Announcements (for backward compat)
 *
 * Implements Requirements 4.3, 4.4, 11.1–11.5.
 *
 * @param tenantId - UUID of the tenant to update.
 * @param payload  - Partial configuration update.
 * @returns The updated FullTenantConfiguration.
 * @throws Error if the tenant is not found or the update fails.
 */
export async function updateTenantConfiguration(
  tenantId: string,
  payload: ConfigurationUpdatePayload
): Promise<FullTenantConfiguration> {
  // Get current config to preserve unchanged fields
  const current = await getTenantConfiguration(tenantId);
  if (!current) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  try {
    // Update branding if provided
    if (payload.branding) {
      const brandingUpdate = {
        tenant_id: tenantId,
        logo_url: payload.branding.logoUrl ?? current.branding.logoUrl,
        primary_color: payload.branding.primaryColor ?? current.branding.primaryColor,
        secondary_color: payload.branding.secondaryColor ?? current.branding.secondaryColor,
        welcome_message: payload.branding.welcomeMessage ?? current.branding.welcomeMessage,
        updated_at: new Date().toISOString(),
      };

      // Upsert branding (insert if not exists, update if exists)
      const { error: brandingError } = await supabaseAdmin
        .from('tenant_branding')
        .upsert(brandingUpdate, { onConflict: 'tenant_id' });

      if (brandingError) {
        logger.error('[TENANT_CONFIG] Failed to update branding', { error: brandingError, tenantId });
        throw brandingError;
      }
    }

    // Update features if provided
    if (payload.features) {
      for (const [key, value] of Object.entries(payload.features)) {
        const featureName = key
          .replace(/([A-Z])/g, '_$1')
          .toLowerCase()
          .replace(/^_/, '');

        const { error: featureError } = await supabaseAdmin
          .from('tenant_features')
          .upsert(
            {
              tenant_id: tenantId,
              feature_name: featureName,
              is_enabled: value,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'tenant_id,feature_name' }
          );

        if (featureError) {
          logger.error('[TENANT_CONFIG] Failed to update feature', { error: featureError, tenantId, featureName });
          throw featureError;
        }
      }
    }

    // Update notification channels if provided
    if (payload.notifications) {
      for (const [channelType, config] of Object.entries(payload.notifications)) {
        const isEnabled = config !== null && config !== undefined;
        
        const { error: channelError } = await supabaseAdmin
          .from('tenant_notification_channels')
          .upsert(
            {
              tenant_id: tenantId,
              channel_type: channelType,
              is_enabled: isEnabled,
              configuration: config ?? {},
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'tenant_id,channel_type' }
          );

        if (channelError) {
          logger.error('[TENANT_CONFIG] Failed to update notification channel', { error: channelError, tenantId, channelType });
          throw channelError;
        }
      }
    }

    logger.info('[TENANT_CONFIG] Tenant configuration updated', {
      tenantId,
      updatedFields: Object.keys(payload),
    });

    // Invalidate configuration cache
    cacheDelete(tenantCacheKey(tenantId, 'config'));

    // Return the updated configuration
    const updated = await getTenantConfiguration(tenantId);
    if (!updated) {
      throw new Error('Failed to retrieve updated configuration');
    }

    return updated;
  } catch (err) {
    logger.error('[TENANT_CONFIG] Error updating configuration', { error: err, tenantId });
    throw err;
  }
}

/**
 * Add or update an announcement in the tenant's configuration.
 *
 * Implements Requirement 11.5: Local Admin creates local announcements.
 *
 * @param tenantId    - UUID of the tenant.
 * @param announcement - Announcement data to add.
 * @returns The updated FullTenantConfiguration.
 */
export async function addTenantAnnouncement(
  tenantId: string,
  announcement: AnnouncementPayload
): Promise<FullTenantConfiguration> {
  const current = await getTenantConfiguration(tenantId);
  if (!current) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

const newAnnouncement = {
    id: crypto.randomUUID(),
    title: announcement.title,
    content: announcement.content,
    createdAt: new Date().toISOString(),
    expiresAt: announcement.expiresAt ?? null,
  };

  const updated: FullTenantConfiguration = {
    ...current,
    announcements: [...(current.announcements ?? []), newAnnouncement],
  };

  const { data: updatedTenant, error } = await supabaseAdmin
    .from('tenants')
    .update({ configuration: updated, updated_at: new Date().toISOString() })
    .eq('id', tenantId)
    .select('configuration')
    .single();

  if (error || !updatedTenant) {
    logger.error('[TENANT_CONFIG] Failed to add announcement', { error, tenantId });
    throw new Error(`Failed to add announcement: ${error?.message ?? 'Unknown error'}`);
  }

  logger.info('[TENANT_CONFIG] Announcement added', {
    tenantId,
    announcementId: newAnnouncement.id,
  });

  cacheDelete(tenantCacheKey(tenantId, 'config'));
  return updatedTenant.configuration as FullTenantConfiguration;
}

/**
 * Remove an announcement from the tenant's configuration.
 *
 * @param tenantId       - UUID of the tenant.
 * @param announcementId - ID of the announcement to remove.
 * @returns The updated FullTenantConfiguration.
 */
export async function removeTenantAnnouncement(
  tenantId: string,
  announcementId: string
): Promise<FullTenantConfiguration> {
  const current = await getTenantConfiguration(tenantId);
  if (!current) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

const updated: FullTenantConfiguration = {
    ...current,
    announcements: (current.announcements ?? []).filter(a => a.id !== announcementId),
  };

  const { data: updatedTenant, error } = await supabaseAdmin
    .from('tenants')
    .update({ configuration: updated, updated_at: new Date().toISOString() })
    .eq('id', tenantId)
    .select('configuration')
    .single();

  if (error || !updatedTenant) {
    logger.error('[TENANT_CONFIG] Failed to remove announcement', { error, tenantId });
    throw new Error(`Failed to remove announcement: ${error?.message ?? 'Unknown error'}`);
  }

  logger.info('[TENANT_CONFIG] Announcement removed', { tenantId, announcementId });

  cacheDelete(tenantCacheKey(tenantId, 'config'));
  return updatedTenant.configuration as FullTenantConfiguration;
}
