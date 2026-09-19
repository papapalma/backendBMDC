/**
 * PATCH /api/tenants/:id/configuration
 *
 * Tenant Configuration Management Endpoint — updates settings for a specific tenant.
 *
 * Implements Requirements 4.3, 4.4, 11.1, 11.2, 11.3, 11.4, 11.5:
 *   - 4.3  Local Admin configures Tenant_Configuration (LGU name, logo, contact details, announcements)
 *   - 4.4  Local Admin customizes branding (colors, logos, welcome messages)
 *   - 11.1 Logo upload validation (≤ 2 MB, PNG/JPG/SVG format)
 *   - 11.2 Primary and secondary brand color configuration
 *   - 11.3 Welcome message customization
 *   - 11.4 Contact information configuration
 *   - 11.5 Local announcements management
 *
 * Access:
 *   - Local Admin: can update configuration for their own tenant only
 *   - Super Admin: can update configuration for any tenant
 *
 * Request body (all fields optional — only supplied fields are updated):
 * { *   "branding": { *  "logoUrl": "https://example.com/logo.png",   // PNG, JPG, or SVG; null to remove
 *  "primaryColor": "#1a56db",  // hex color
 *  "secondaryColor": "#7e3af2",  // hex color
 *  "welcomeMessage": "Welcome to Our LGU"  // max 500 chars
 * },
 *   "features": { *  "inventoryManagement": true,
 *  "certificateGeneration": false,
 *  "qrCodeAttendance": false,
 *  "mobileAppAccess": false
 * },
 *   "notifications": { *  "whatsapp": { *  "accessToken": "...",
 *  "phoneNumberId": "...",
 *  "businessAccountId": "..."
 * },
 *  "email": { *  "senderName": "LGU Notifications",
 *  "senderEmail": "noreply@lgu.gov.ph",
 *  "smtpHost": "smtp.example.com",
 *  "smtpPort": 587,
 *  "useTls": true,
 *  "smtpUsername": "user",
 *  "smtpPassword": "pass"
 * }
 * },
 *   "contact": { *  "phone": "+63-912-345-6789",
 *  "email": "contact@lgu.gov.ph",
 *  "address": "123 Main St, City",
 *  "website": "https://lgu.gov.ph"
 * }
 * }
 *
 * Response 200:
 * { *   "success": true,
 *   "data": { ...updatedConfiguration },
 *   "message": "Tenant configuration updated successfully"
 * }
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTenantContext } from '@/middleware/tenantContext';
import { updateTenantConfiguration,
  validateConfigurationUpdate,
  type ConfigurationUpdatePayload, } from '@/services/tenantConfigurationService';
import { successResponse,
  errorResponse,
  forbiddenResponse,
  notFoundResponse, } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const hexColorSchema = z
  .string()
  .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Must be a valid hex color (e.g. #RGB or #RRGGBB)');

const brandingSchema = z
  .object({ logoUrl: z
  .string()
  .nullable()
  .optional()
  .refine(
  val => { if (val === null || val === undefined) return true;

  const lower = val.toLowerCase();
  return (
  lower.endsWith('.png') ||
  lower.endsWith('.jpg') ||
  lower.endsWith('.jpeg') ||
  lower.endsWith('.svg')
  ); },
  { message: 'Logo must be a PNG, JPG, or SVG file' }
  ),
  primaryColor: hexColorSchema.optional(),
  secondaryColor: hexColorSchema.optional(),
  welcomeMessage: z
  .string()
  .min(1, 'Welcome message must not be empty')
  .max(500, 'Welcome message must not exceed 500 characters')
  .optional(), })
  .optional();

const featuresSchema = z
  .object({ inventoryManagement: z.boolean().optional(),
  certificateGeneration: z.boolean().optional(),
  qrCodeAttendance: z.boolean().optional(),
  mobileAppAccess: z.boolean().optional(), })
  .optional();

const whatsappConfigSchema = z
  .object({ accessToken: z.string().min(1, 'WhatsApp accessToken is required'),
  phoneNumberId: z.string().min(1, 'WhatsApp phoneNumberId is required'),
  businessAccountId: z.string().min(1, 'WhatsApp businessAccountId is required'),
  templateNamespace: z.string().optional(), })
  .nullable();

const emailConfigSchema = z
  .object({ senderName: z.string().min(1, 'Email senderName is required'),
  senderEmail: z.string().email('Email senderEmail must be a valid email address'),
  smtpHost: z.string().min(1, 'SMTP host is required'),
  smtpPort: z
  .number()
  .int()
  .min(1, 'SMTP port must be at least 1')
  .max(65535, 'SMTP port must not exceed 65535'),
  useTls: z.boolean(),
  smtpUsername: z.string().min(1, 'SMTP username is required'),
  smtpPassword: z.string().min(1, 'SMTP password is required'), })
  .nullable();

const notificationsSchema = z
  .object({ whatsapp: whatsappConfigSchema.optional(),
  email: emailConfigSchema.optional(), })
  .optional();

const contactSchema = z
  .object({ phone: z.string().max(50).optional(),
  email: z.string().email('Contact email must be a valid email address').optional(),
  address: z.string().max(500).optional(),
  website: z.string().url('Contact website must be a valid URL').optional(), })
  .optional();

const updateConfigurationSchema = z
  .object({ branding: brandingSchema,
  features: featuresSchema,
  notifications: notificationsSchema,
  contact: contactSchema, })
  .refine(
  data =>
  data.branding !== undefined ||
  data.features !== undefined ||
  data.notifications !== undefined ||
  data.contact !== undefined,
  { message: 'At least one configuration section must be provided' }
  );

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// OPTIONS /api/tenants/:id/configuration — CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

/**
 * PATCH /api/tenants/:id/configuration
 *
 * Updates the configuration for a specific tenant.
 * Local Admins can only update their own tenant; Super Admins can update any.
 */
export const PATCH = withErrorHandler(
  async (request: NextRequest, context: { params: { id: string } | Promise<{ id: string }> }) => { // ── 1. Authenticate and extract tenant context ─────────────────────────

const contextResult = requireTenantContext(request);
  if (contextResult.error) return contextResult.error;

  const { tenantId: callerTenantId, userId, role, isSuperAdmin } = contextResult.context;
  const resolvedParams = await context.params;
  const targetTenantId = resolvedParams.id;

  // ── 2. Authorise ───────────────────────────────────────────────────────
  // Local Admins can only update their own tenant's configuration.
  // Super Admins can update any tenant.

if (!isSuperAdmin) { if (role !== 'local_admin') { logger.warn('[TENANT_CONFIG] Non-admin attempted configuration update', { userId,
  role,
  targetTenantId, });
  return forbiddenResponse('Only Local Admins and Super Admins can update tenant configuration'); }

if (callerTenantId !== targetTenantId) { logger.warn('[TENANT_CONFIG] Local Admin attempted cross-tenant configuration update', { userId,
  callerTenantId,
  targetTenantId, });
  return forbiddenResponse('You can only update configuration for your own tenant'); } }

  // ── 3. Parse and validate request body ────────────────────────────────

const body = await request.json();
  const validatedData = updateConfigurationSchema.parse(body);

  // Run additional semantic validation (hex colors, email formats, etc.)

const semanticErrors = validateConfigurationUpdate(
  validatedData as ConfigurationUpdatePayload
  );
  if (semanticErrors.length > 0) { return errorResponse(`Configuration validation failed: ${semanticErrors.join('; ')}`, 422); }

  // ── 4. Apply the configuration update ─────────────────────────────────
  logger.info('[TENANT_CONFIG] Updating tenant configuration', { targetTenantId,
  requestedBy: userId,
  updatedSections: Object.keys(validatedData).filter(
  k => validatedData[k as keyof typeof validatedData] !== undefined
  ), });

  let updatedConfig;
  try { updatedConfig = await updateTenantConfiguration(
  targetTenantId,
  validatedData as ConfigurationUpdatePayload
  ); } catch (err) { if (err instanceof Error && err.message.startsWith('Tenant not found')) { return notFoundResponse(`Tenant with ID "${targetTenantId}" not found`); }
  throw err; }

  logger.info('[TENANT_CONFIG] Tenant configuration updated successfully', { targetTenantId,
  requestedBy: userId, });

  // ── 5. Return updated configuration ───────────────────────────────────

return successResponse(updatedConfig, 'Tenant configuration updated successfully'); }
);

/**
 * GET /api/tenants/:id/configuration
 *
 * Retrieves the current configuration for a specific tenant.
 * Local Admins can only read their own tenant; Super Admins can read any.
 */
export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: { id: string } | Promise<{ id: string }> }) => { // ── 1. Authenticate and extract tenant context ─────────────────────────

const contextResult = requireTenantContext(request);
  if (contextResult.error) return contextResult.error;

  const { tenantId: callerTenantId, userId, role, isSuperAdmin } = contextResult.context;
  const resolvedParams = await context.params;
  const targetTenantId = resolvedParams.id;

  // ── 2. Authorise ───────────────────────────────────────────────────────

if (!isSuperAdmin && callerTenantId !== targetTenantId) { logger.warn('[TENANT_CONFIG] Cross-tenant configuration read attempt', { userId,
  role,
  callerTenantId,
  targetTenantId, });
  return forbiddenResponse('You can only read configuration for your own tenant'); }

  // ── 3. Fetch configuration ─────────────────────────────────────────────

const { supabaseAdmin } = await import('@/lib/supabase-admin');

  const { data: tenant, error } = await supabaseAdmin
  .from('tenants')
  .select('id, name, status, configuration, updated_at')
  .eq('id', targetTenantId)
  .maybeSingle();

  if (error) { throw new Error(`Failed to fetch tenant configuration: ${error.message}`); }

if (!tenant) { return notFoundResponse(`Tenant with ID "${targetTenantId}" not found`); }

  return successResponse(
  { tenantId: tenant.id,
  tenantName: tenant.name,
  status: tenant.status,
  configuration: tenant.configuration,
  updatedAt: tenant.updated_at, },
  'Tenant configuration retrieved successfully'
  ); }
);
