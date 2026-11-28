/**
 * Certificate Template Configuration Service
 *
 * Implements Requirement 16.7:
 *   - Local Admin configures certificate templates (layout, fonts, signatory positions)
 *   - Templates stored in tenant configuration JSONB under `certificateTemplates`
 *   - Multiple templates per tenant are supported
 *
 * Templates are stored as an array in the tenant's configuration JSONB:
 *   configuration.certificateTemplates: CertificateTemplate[]
 *
 * The first template in the array is used as the default when no templateId
 * is specified during certificate generation.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import type { CertificateTemplate } from './certificateService';

// ---------------------------------------------------------------------------
// Re-export the type so callers only need one import
// ---------------------------------------------------------------------------
export type { CertificateTemplate };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the current certificate templates array for a tenant.
 * Returns an empty array if none are configured.
 */
async function fetchTemplates(tenantId: string): Promise<CertificateTemplate[]> {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('configuration')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch tenant: ${error.message}`);
  if (!data) throw new Error(`Tenant not found: ${tenantId}`);

  const config = data.configuration as any;
  return (config?.certificateTemplates as CertificateTemplate[]) ?? [];
}

/**
 * Persist the updated templates array back to the tenant configuration.
 */
async function saveTemplates(
  tenantId: string,
  templates: CertificateTemplate[]
): Promise<CertificateTemplate[]> {
  // Fetch current config to preserve all other fields

const { data, error: fetchError } = await supabaseAdmin
    .from('tenants')
    .select('configuration')
    .eq('id', tenantId)
    .maybeSingle();

  if (fetchError) throw new Error(`Failed to fetch tenant: ${fetchError.message}`);
  if (!data) throw new Error(`Tenant not found: ${tenantId}`);

  const updatedConfig = {
    ...(data.configuration as object),
    certificateTemplates: templates,
  };

  const { error: updateError } = await supabaseAdmin
    .from('tenants')
    .update({ configuration: updatedConfig, updated_at: new Date().toISOString() })
    .eq('id', tenantId);

  if (updateError) throw new Error(`Failed to save templates: ${updateError.message}`);

  logger.info('[CERT_TEMPLATE] Templates saved', { tenantId, count: templates.length });
  return templates;
}

// ---------------------------------------------------------------------------
// CRUD operations for certificate templates (Req 16.7)
// ---------------------------------------------------------------------------

/**
 * List all certificate templates for a tenant.
 */
export async function listCertificateTemplates(
  tenantId: string
): Promise<CertificateTemplate[]> {
  return fetchTemplates(tenantId);
}

/**
 * Get a single certificate template by ID.
 * Returns null if not found.
 */
export async function getCertificateTemplate(
  tenantId: string,
  templateId: string
): Promise<CertificateTemplate | null> {
  const templates = await fetchTemplates(tenantId);
  return templates.find((t) => t.id === templateId) ?? null;
}

/**
 * Create a new certificate template for a tenant.
 *
 * Generates a UUID for the template and appends it to the existing list.
 * The first template in the list is treated as the default.
 */
export async function createCertificateTemplate(
  tenantId: string,
  payload: Omit<CertificateTemplate, 'id'>
): Promise<CertificateTemplate> {
  const templates = await fetchTemplates(tenantId);

  const newTemplate: CertificateTemplate = {
    ...payload,
    id: crypto.randomUUID(),
  };

  await saveTemplates(tenantId, [...templates, newTemplate]);

  logger.info('[CERT_TEMPLATE] Template created', {
    tenantId,
    templateId: newTemplate.id,
    name: newTemplate.name,
  });

  return newTemplate;
}

/**
 * Update an existing certificate template.
 *
 * Only the fields supplied in `payload` are changed; all other fields
 * are preserved (partial update).
 */
export async function updateCertificateTemplate(
  tenantId: string,
  templateId: string,
  payload: Partial<Omit<CertificateTemplate, 'id'>>
): Promise<CertificateTemplate> {
  const templates = await fetchTemplates(tenantId);
  const index = templates.findIndex((t) => t.id === templateId);

  if (index === -1) {
    throw new Error(`Certificate template not found: ${templateId}`);
  }

const updated: CertificateTemplate = { ...templates[index], ...payload };
  templates[index] = updated;

  await saveTemplates(tenantId, templates);

  logger.info('[CERT_TEMPLATE] Template updated', { tenantId, templateId });
  return updated;
}

/**
 * Delete a certificate template.
 *
 * The default template (index 0) can be deleted; the next template in the
 * list becomes the new default.
 */
export async function deleteCertificateTemplate(
  tenantId: string,
  templateId: string
): Promise<void> {
  const templates = await fetchTemplates(tenantId);
  const filtered = templates.filter((t) => t.id !== templateId);

  if (filtered.length === templates.length) {
    throw new Error(`Certificate template not found: ${templateId}`);
  }

  await saveTemplates(tenantId, filtered);
  logger.info('[CERT_TEMPLATE] Template deleted', { tenantId, templateId });
}

/**
 * Set the default template (move it to index 0).
 */
export async function setDefaultCertificateTemplate(
  tenantId: string,
  templateId: string
): Promise<CertificateTemplate[]> {
  const templates = await fetchTemplates(tenantId);
  const index = templates.findIndex((t) => t.id === templateId);

  if (index === -1) {
    throw new Error(`Certificate template not found: ${templateId}`);
  }

  // Move to front

const reordered = [
    templates[index],
    ...templates.slice(0, index),
    ...templates.slice(index + 1),
  ];

  return saveTemplates(tenantId, reordered);
}
