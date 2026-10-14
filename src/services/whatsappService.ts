/**
 * WhatsApp Business API Notification Service
 *
 * Implements Requirements 12.1, 12.2, 12.3, 12.4, 12.6, 12.9, 12.10:
 *   - 12.1  Send WhatsApp enrollment confirmation to trainees
 *   - 12.2  Send WhatsApp schedule change notifications
 *   - 12.3  Send WhatsApp reminders 24 hours before training starts
 *   - 12.4  Send WhatsApp completion notification with certificate access
 *   - 12.6  Local Admin configures WhatsApp API credentials per tenant
 *   - 12.9  Log all notification attempts with delivery status to audit_logs
 *   - 12.10 Retry failed WhatsApp messages up to 3 times with exponential backoff
 *
 * Each tenant supplies its own WhatsApp Business API credentials stored in
 * the tenant's configuration JSONB column. The service retrieves these at
 * send time so credentials are never hard-coded.
 */

import { getTenantConfiguration } from './tenantConfigurationService';
import type { WhatsAppConfig } from './tenantConfigurationService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhatsAppTemplateMessage {
  /** Tenant whose WhatsApp credentials to use */
  tenantId: string;
  /** Recipient's phone number in E.164 format (e.g. +639171234567) */
  recipientPhone: string;
  /** WhatsApp message template name (must be approved in Meta Business Manager) */
  templateName: string;
  /** Language code for the template (e.g. 'en_US', 'fil') */
  languageCode?: string;
  /** Ordered list of variable values to substitute into the template body */
  templateVariables?: string[];
  /** Optional header variable (image URL or document URL) */
  headerVariable?: string;
}

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
  deliveryStatus: 'sent' | 'failed' | 'queued';
  attempts: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of send attempts before giving up (Req 12.10) */
const MAX_RETRIES = 3;

/** Base delay in milliseconds for exponential backoff (Req 12.10) */
const BASE_BACKOFF_MS = 1000;

/** WhatsApp Cloud API base URL */
const WA_API_BASE = 'https://graph.facebook.com/v18.0';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute exponential backoff delay for a given attempt number (0-indexed).
 * Attempt 0 → 1 s, attempt 1 → 2 s, attempt 2 → 4 s.
 */
function backoffDelay(attempt: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, attempt);
}

/**
 * Build the WhatsApp Cloud API request body for a template message.
 */
function buildTemplatePayload(
  recipientPhone: string,
  templateName: string,
  languageCode: string,
  variables: string[],
  headerVariable?: string
): Record<string, unknown> {
  const components: Record<string, unknown>[] = [];

  if (headerVariable) {
    components.push({
      type: 'header',
      parameters: [{ type: 'text', text: headerVariable }],
    });
  }

if (variables.length > 0) {
    components.push({
      type: 'body',
      parameters: variables.map((v) => ({ type: 'text', text: v })),
    });
  }

  return {
    messaging_product: 'whatsapp',
    to: recipientPhone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  };
}

/**
 * Persist a notification attempt record to the audit_logs table (Req 12.9).
 */
async function logNotificationAttempt(params: {
  tenantId: string;
  recipientPhone: string;
  templateName: string;
  deliveryStatus: 'sent' | 'failed' | 'queued';
  messageId?: string;
  error?: string;
  attempts: number;
}): Promise<void> {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      tenant_id: params.tenantId,
      action: 'whatsapp_notification',
      entity_type: 'notification',
      entity_id: null,
      details: {
        channel: 'whatsapp',
        recipient_phone: params.recipientPhone,
        template_name: params.templateName,
        delivery_status: params.deliveryStatus,
        message_id: params.messageId ?? null,
        error: params.error ?? null,
        attempts: params.attempts,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (logError) {
    // Non-critical — log to console but don't throw
    logger.warn('[WHATSAPP] Failed to write notification audit log', { logError });
  }
}

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

/**
 * Send a WhatsApp template message using the tenant's configured credentials.
 *
 * Implements retry logic with exponential backoff (Req 12.10):
 *   - Attempt 1 immediately
 *   - Attempt 2 after 1 second
 *   - Attempt 3 after 2 seconds
 *
 * All attempts are logged to audit_logs (Req 12.9).
 *
 * @returns NotificationResult describing the outcome.
 */
export async function sendWhatsApp(
  message: WhatsAppTemplateMessage
): Promise<NotificationResult> {
  const {
    tenantId,
    recipientPhone,
    templateName,
    languageCode = 'en_US',
    templateVariables = [],
    headerVariable,
  } = message;

  // ── 1. Retrieve tenant WhatsApp configuration ────────────────────────────

let waConfig: WhatsAppConfig | null = null;
  try {
    const tenantConfig = await getTenantConfiguration(tenantId);
    waConfig = tenantConfig?.notifications?.whatsapp ?? null;
  } catch (configError) {
    logger.error('[WHATSAPP] Failed to retrieve tenant configuration', {
      tenantId,
      configError,
    });
  }

if (!waConfig?.accessToken || !waConfig?.phoneNumberId) {
    const result: NotificationResult = {
      success: false,
      error: 'WhatsApp is not configured for this tenant',
      deliveryStatus: 'failed',
      attempts: 0,
    };

    await logNotificationAttempt({
      tenantId,
      recipientPhone,
      templateName,
      ...result,
    });

    return result;
  }

  // ── 2. Build request payload ─────────────────────────────────────────────

const payload = buildTemplatePayload(
    recipientPhone,
    templateName,
    languageCode,
    templateVariables,
    headerVariable
  );

  const url = `${WA_API_BASE}/${waConfig.phoneNumberId}/messages`;

  // ── 3. Send with retry logic (Req 12.10) ─────────────────────────────────

let lastError: string | undefined;
  let messageId: string | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = backoffDelay(attempt - 1);
      logger.info(`[WHATSAPP] Retrying send (attempt ${attempt + 1}/${MAX_RETRIES}) after ${delay}ms`, {
        tenantId,
        recipientPhone,
        templateName,
      });
      await sleep(delay);
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waConfig.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseBody = await response.json() as Record<string, any>;

      if (response.ok && responseBody?.messages?.[0]?.id) {
        messageId = responseBody.messages[0].id;

        const result: NotificationResult = {
          success: true,
          messageId,
          deliveryStatus: 'sent',
          attempts: attempt + 1,
        };

        await logNotificationAttempt({
          tenantId,
          recipientPhone,
          templateName,
          ...result,
        });

        logger.info('[WHATSAPP] Message sent successfully', {
          tenantId,
          recipientPhone,
          templateName,
          messageId,
          attempts: attempt + 1,
        });

        return result;
      }

      // API returned an error response
      lastError =
        responseBody?.error?.message ??
        `HTTP ${response.status}: ${response.statusText}`;

      logger.warn(`[WHATSAPP] Send attempt ${attempt + 1} failed`, {
        tenantId,
        recipientPhone,
        templateName,
        error: lastError,
        status: response.status,
      });
    } catch (fetchError: any) {
      lastError = fetchError?.message ?? 'Network error';
      logger.warn(`[WHATSAPP] Send attempt ${attempt + 1} threw an error`, {
        tenantId,
        recipientPhone,
        templateName,
        error: lastError,
      });
    }
  }

  // ── 4. All attempts exhausted ────────────────────────────────────────────

const failedResult: NotificationResult = {
    success: false,
    error: lastError ?? 'All retry attempts failed',
    deliveryStatus: 'failed',
    attempts: MAX_RETRIES,
  };

  await logNotificationAttempt({
    tenantId,
    recipientPhone,
    templateName,
    ...failedResult,
  });

  logger.error('[WHATSAPP] All send attempts failed', {
    tenantId,
    recipientPhone,
    templateName,
    error: lastError,
  });

  return failedResult;
}

// ---------------------------------------------------------------------------
// Convenience wrappers for specific notification types (Req 12.1–12.4)
// ---------------------------------------------------------------------------

/**
 * Send enrollment confirmation notification (Req 12.1).
 */
export async function sendEnrollmentConfirmation(params: {
  tenantId: string;
  recipientPhone: string;
  traineeName: string;
  programName: string;
  startDate: string;
}): Promise<NotificationResult> {
  return sendWhatsApp({
    tenantId: params.tenantId,
    recipientPhone: params.recipientPhone,
    templateName: 'enrollment_confirmation',
    templateVariables: [params.traineeName, params.programName, params.startDate],
  });
}

/**
 * Send training schedule change notification (Req 12.2).
 */
export async function sendScheduleChangeNotification(params: {
  tenantId: string;
  recipientPhone: string;
  traineeName: string;
  programName: string;
  changeDescription: string;
}): Promise<NotificationResult> {
  return sendWhatsApp({
    tenantId: params.tenantId,
    recipientPhone: params.recipientPhone,
    templateName: 'schedule_change',
    templateVariables: [params.traineeName, params.programName, params.changeDescription],
  });
}

/**
 * Send 24-hour training reminder notification (Req 12.3).
 */
export async function sendTrainingReminder(params: {
  tenantId: string;
  recipientPhone: string;
  traineeName: string;
  programName: string;
  sessionDate: string;
  sessionTime: string;
  location?: string;
}): Promise<NotificationResult> {
  return sendWhatsApp({
    tenantId: params.tenantId,
    recipientPhone: params.recipientPhone,
    templateName: 'training_reminder',
    templateVariables: [
      params.traineeName,
      params.programName,
      params.sessionDate,
      params.sessionTime,
      params.location ?? 'TBA',
    ],
  });
}

/**
 * Send training completion notification with certificate access link (Req 12.4).
 */
export async function sendCompletionNotification(params: {
  tenantId: string;
  recipientPhone: string;
  traineeName: string;
  programName: string;
  certificateUrl: string;
}): Promise<NotificationResult> {
  return sendWhatsApp({
    tenantId: params.tenantId,
    recipientPhone: params.recipientPhone,
    templateName: 'training_completion',
    templateVariables: [params.traineeName, params.programName, params.certificateUrl],
  });
}
