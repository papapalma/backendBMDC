/**
 * Data Breach Notification Service
 *
 * Implements Requirement 22.6:
 *   - Log breach events to audit_logs
 *   - Send email notification to affected trainees within 72 hours
 *   - Send notification to the Data Protection Officer (DPO)
 *   - Store breach details in audit_logs with 5-year retention
 *
 * Under RA 10173 (Philippine Data Privacy Act), the Personal Information
 * Controller must notify the National Privacy Commission (NPC) and affected
 * data subjects within 72 hours of discovering a personal data breach.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { writeAuditLog } from '@/lib/auditLog';
import { sendEmail, renderTemplate } from './emailService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BreachSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface DataBreachReport {
  /** Tenant where the breach occurred (null = platform-level) */
  tenantId?: string | null;
  /** User who discovered/reported the breach */
  reportedBy: string;
  /** Brief title describing the breach */
  title: string;
  /** Detailed description of what happened */
  description: string;
  /** Severity level */
  severity: BreachSeverity;
  /** Categories of data affected (e.g. ['identity', 'contact', 'training_records']) */
  affectedDataCategories: string[];
  /** Estimated number of affected data subjects */
  estimatedAffectedCount: number;
  /** IDs of specific affected trainees (if known) */
  affectedTraineeIds?: string[];
  /** When the breach was discovered */
  discoveredAt: string;
  /** Immediate containment actions taken */
  containmentActions?: string;
}

export interface BreachNotificationResult {
  breachId: string;
  auditLogId: string | null;
  dpoNotified: boolean;
  traineesNotified: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

const TRAINEE_BREACH_NOTIFICATION_TEMPLATE = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:2px solid #dc2626;border-radius:8px;padding:24px;">
  <h2 style="color:#dc2626;">Important: Personal Data Breach Notification</h2>
  <p>Dear <strong>{{traineeName}}</strong>,</p>
  <p>
    We are writing to inform you that a personal data breach has been identified that
    may have affected your personal information stored in the
    <strong>{{lguName}}</strong> Training Management System.
  </p>
  <h3>What Happened</h3>
  <p>{{breachDescription}}</p>
  <h3>What Data Was Affected</h3>
  <p>{{affectedCategories}}</p>
  <h3>What We Are Doing</h3>
  <p>{{containmentActions}}</p>
  <h3>What You Can Do</h3>
  <ul>
    <li>Monitor your accounts for any suspicious activity</li>
    <li>Change your passwords if you use the same password elsewhere</li>
    <li>Contact us immediately if you notice any unauthorized use of your information</li>
  </ul>
  <h3>Contact Us</h3>
  <p>
    If you have questions or concerns, please contact our Data Protection Officer at:
    <strong>{{dpoEmail}}</strong>
  </p>
  <p>
    This notification is sent in compliance with the Philippine Data Privacy Act of 2012
    (Republic Act No. 10173).
  </p>
  <hr/>
  <p style="font-size:11px;color:#6b7280;">
    Breach Reference: {{breachId}} | Discovered: {{discoveredAt}}
  </p>
</div>`;

const DPO_BREACH_NOTIFICATION_TEMPLATE = `
<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;">
  <h2 style="color:#dc2626;">DATA BREACH INCIDENT REPORT</h2>
  <table style="width:100%;border-collapse:collapse;">
    <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;">Breach ID</td><td style="padding:8px;">{{breachId}}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;">Tenant</td><td style="padding:8px;">{{tenantId}}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;">Severity</td><td style="padding:8px;color:#dc2626;font-weight:bold;">{{severity}}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;">Title</td><td style="padding:8px;">{{title}}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;">Description</td><td style="padding:8px;">{{description}}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;">Affected Data</td><td style="padding:8px;">{{affectedCategories}}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;">Estimated Affected</td><td style="padding:8px;">{{estimatedCount}} data subjects</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;">Discovered At</td><td style="padding:8px;">{{discoveredAt}}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;">Reported By</td><td style="padding:8px;">{{reportedBy}}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;">Containment</td><td style="padding:8px;">{{containmentActions}}</td></tr>
  </table>
  <p style="margin-top:16px;color:#dc2626;font-weight:bold;">
    ACTION REQUIRED: Notify the National Privacy Commission (NPC) within 72 hours
    of breach discovery if this involves sensitive personal information.
  </p>
  <p>NPC Notification Portal: <a href="https://www.privacy.gov.ph">https://www.privacy.gov.ph</a></p>
</div>`;

// ---------------------------------------------------------------------------
// Core breach notification function (Req 22.6)
// ---------------------------------------------------------------------------

/**
 * Report a data breach, notify affected trainees and the DPO, and log to audit_logs.
 *
 * This function:
 *   1. Generates a unique breach ID
 *   2. Logs the breach to audit_logs with 5-year retention
 *   3. Sends email to the DPO immediately
 *   4. Sends email to all affected trainees (within 72-hour window)
 *
 * @returns BreachNotificationResult with notification outcomes
 */
export async function reportDataBreach(
  report: DataBreachReport
): Promise<BreachNotificationResult> {
  const breachId = `BREACH-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const errors: string[] = [];
  let auditLogId: string | null = null;
  let dpoNotified = false;
  let traineesNotified = 0;

  logger.error('[DATA_BREACH] Breach reported', {
    breachId,
    tenantId: report.tenantId,
    severity: report.severity,
    title: report.title,
    estimatedAffectedCount: report.estimatedAffectedCount,
  });

  // ── 1. Log to audit_logs (Req 22.6) ──────────────────────────────────────
  try {
    const { data: logEntry } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        tenant_id:   report.tenantId ?? null,
        user_id:     report.reportedBy,
        action:      'security.data_breach',
        entity_type: 'data_breach',
        entity_id:   null,
        details: {
          breach_id:                breachId,
          title:                    report.title,
          description:              report.description,
          severity:                 report.severity,
          affected_data_categories: report.affectedDataCategories,
          estimated_affected_count: report.estimatedAffectedCount,
          affected_trainee_ids:     report.affectedTraineeIds ?? [],
          discovered_at:            report.discoveredAt,
          containment_actions:      report.containmentActions ?? 'Under investigation',
          notification_sent_at:     new Date().toISOString(),
          // 5-year retention for security events
          _retention:               '5years',
        },
      })
      .select('id')
      .single();

    auditLogId = logEntry?.id ?? null;
  } catch (logErr: any) {
    errors.push(`Audit log failed: ${logErr?.message}`);
    logger.error('[DATA_BREACH] Failed to write audit log', { logErr });
  }

  // ── 2. Fetch tenant name and DPO email ────────────────────────────────────

let tenantName = 'LGU Training Center';
  let dpoEmail = process.env.DPO_EMAIL ?? 'dpo@lgu-training.gov.ph';

  if (report.tenantId) {
    try {
      const { data: tenant } = await supabaseAdmin
        .from('tenants')
        .select('name, configuration')
        .eq('id', report.tenantId)
        .maybeSingle();

      if (tenant) {
        tenantName = tenant.name;
        const config = tenant.configuration as any;
        if (config?.contact?.email) dpoEmail = config.contact.email;
      }
    } catch { /* use defaults */ }
  }

  // ── 3. Notify DPO (Req 22.6) ─────────────────────────────────────────────
  try {
    const dpoBody = renderTemplate(DPO_BREACH_NOTIFICATION_TEMPLATE, {
      breachId,
      tenantId:           report.tenantId ?? 'Platform-level',
      severity:           report.severity.toUpperCase(),
      title:              report.title,
      description:        report.description,
      affectedCategories: report.affectedDataCategories.join(', '),
      estimatedCount:     String(report.estimatedAffectedCount),
      discoveredAt:       report.discoveredAt,
      reportedBy:         report.reportedBy,
      containmentActions: report.containmentActions ?? 'Under investigation',
    });

    const dpoResult = await sendEmail({
      tenantId:      report.tenantId ?? 'platform',
      recipientEmail: dpoEmail,
      subject:       `[URGENT] Data Breach Incident — ${report.title} (${breachId})`,
      templateName:  'dpo_breach_notification',
      templateBody:  dpoBody,
    });

    dpoNotified = dpoResult.success;
    if (!dpoResult.success) {
      errors.push(`DPO notification failed: ${dpoResult.error}`);
    }
  } catch (dpoErr: any) {
    errors.push(`DPO notification error: ${dpoErr?.message}`);
    logger.error('[DATA_BREACH] Failed to notify DPO', { dpoErr });
  }

  // ── 4. Notify affected trainees (Req 22.6) ────────────────────────────────

if (report.affectedTraineeIds && report.affectedTraineeIds.length > 0) {
    try {
      const { data: trainees } = await supabaseAdmin
        .from('trainees')
        .select('id, first_name, last_name, email')
        .in('id', report.affectedTraineeIds)
        .not('email', 'like', '%@deleted.invalid'); // Skip anonymized records

      for (const trainee of trainees ?? []) {
        try {
          const traineeBody = renderTemplate(TRAINEE_BREACH_NOTIFICATION_TEMPLATE, {
            traineeName:        `${trainee.first_name} ${trainee.last_name}`,
            lguName:            tenantName,
            breachDescription:  report.description,
            affectedCategories: report.affectedDataCategories.join(', '),
            containmentActions: report.containmentActions ?? 'We are actively investigating and securing the system.',
            dpoEmail,
            breachId,
            discoveredAt:       report.discoveredAt,
          });

          const result = await sendEmail({
            tenantId:       report.tenantId ?? 'platform',
            recipientEmail: trainee.email,
            subject:        `Important: Personal Data Breach Notification — ${tenantName}`,
            templateName:   'trainee_breach_notification',
            templateBody:   traineeBody,
          });

          if (result.success) {
            traineesNotified++;
          } else {
            errors.push(`Failed to notify trainee ${trainee.id}: ${result.error}`);
          }
        } catch (traineeErr: any) {
          errors.push(`Error notifying trainee ${trainee.id}: ${traineeErr?.message}`);
        }
      }
    } catch (fetchErr: any) {
      errors.push(`Failed to fetch affected trainees: ${fetchErr?.message}`);
    }
  }

  logger.info('[DATA_BREACH] Breach notification complete', {
    breachId,
    dpoNotified,
    traineesNotified,
    errors: errors.length,
  });

  return { breachId, auditLogId, dpoNotified, traineesNotified, errors };
}
