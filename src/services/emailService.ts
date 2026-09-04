/**
 * Dynamic Email Notification Service
 *
 * Implements Requirements 12.7, 12.8:
 *   - 12.7  Local Admin configures Dynamic_Email_Configuration per tenant
 *           (sender address, SMTP host, port, authentication, templates)
 *   - 12.8  Staff Training Coordinator sends email using tenant-specific config
 *
 * Each tenant stores its own SMTP credentials in the tenant configuration
 * JSONB column. If a tenant has no email config, the service falls back to
 * platform-level environment variables so notifications still work during
 * initial setup.
 *
 * Template rendering uses simple {{variable}} substitution so no external
 * templating library is required.
 */

import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getTenantConfiguration } from './tenantConfigurationService';
import type { EmailConfig } from './tenantConfigurationService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailMessage {
  /** Tenant whose SMTP credentials to use */
  tenantId: string;
  /** Recipient email address */
  recipientEmail: string;
  /** Email subject line */
  subject: string;
  /** Template name (used for logging; actual body is rendered from templateBody) */
  templateName: string;
  /** HTML body with {{variable}} placeholders */
  templateBody: string;
  /** Variable substitution map: { variable: value } */
  templateVariables?: Record<string, string>;
  /** Optional plain-text fallback */
  textBody?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  deliveryStatus: 'sent' | 'failed' | 'queued';
  attempts: number;
  usedFallbackConfig: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum send attempts before giving up */
const MAX_RETRIES = 3;

/** Base backoff delay in milliseconds */
const BASE_BACKOFF_MS = 1000;

// ---------------------------------------------------------------------------
// Built-in email templates
// ---------------------------------------------------------------------------

/**
 * Pre-built HTML templates for common notification types.
 * Each template uses {{variable}} placeholders.
 */
export const EMAIL_TEMPLATES: Record<string, { subject: string; body: string }> = {
  enrollment_confirmation: {
    subject: 'Enrollment Confirmed — {{programName}}',
    body: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <h2 style="color:#2563eb;">Enrollment Confirmed</h2>
  <p>Dear <strong>{{traineeName}}</strong>,</p>
  <p>You have been successfully enrolled in <strong>{{programName}}</strong>.</p>
  <p><strong>Start Date:</strong> {{startDate}}</p>
  <p>Please arrive on time and bring a valid ID. We look forward to seeing you!</p>
  <hr/>
  <p style="font-size:12px;color:#6b7280;">{{lguName}} — Training Management System</p>
</div>`,
  },

  schedule_change: {
    subject: 'Schedule Update — {{programName}}',
    body: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <h2 style="color:#d97706;">Training Schedule Update</h2>
  <p>Dear <strong>{{traineeName}}</strong>,</p>
  <p>There has been a change to the schedule for <strong>{{programName}}</strong>:</p>
  <blockquote style="border-left:4px solid #d97706;padding-left:12px;color:#374151;">
    {{changeDescription}}
  </blockquote>
  <p>Please check the training portal for the latest schedule details.</p>
  <hr/>
  <p style="font-size:12px;color:#6b7280;">{{lguName}} — Training Management System</p>
</div>`,
  },

  training_reminder: {
    subject: 'Reminder: {{programName}} starts tomorrow',
    body: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <h2 style="color:#059669;">Training Reminder</h2>
  <p>Dear <strong>{{traineeName}}</strong>,</p>
  <p>This is a reminder that <strong>{{programName}}</strong> is scheduled for tomorrow.</p>
  <ul>
    <li><strong>Date:</strong> {{sessionDate}}</li>
    <li><strong>Time:</strong> {{sessionTime}}</li>
    <li><strong>Location:</strong> {{location}}</li>
  </ul>
  <p>Please be on time. See you there!</p>
  <hr/>
  <p style="font-size:12px;color:#6b7280;">{{lguName}} — Training Management System</p>
</div>`,
  },

  training_completion: {
    subject: 'Congratulations! You completed {{programName}}',
    body: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <h2 style="color:#7c3aed;">Congratulations, {{traineeName}}!</h2>
  <p>You have successfully completed <strong>{{programName}}</strong>.</p>
  <p>Your certificate is now available for download:</p>
  <p style="text-align:center;">
    <a href="{{certificateUrl}}"
       style="background:#7c3aed;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
      Download Certificate
    </a>
  </p>
  <p>Thank you for your dedication and hard work!</p>
  <hr/>
  <p style="font-size:12px;color:#6b7280;">{{lguName}} — Training Management System</p>
</div>`,
  },

  // OTP & Authentication Templates (migration 013)

  otp_2fa_verification: {
    subject: 'Verify Your Account — 2FA Code: {{otpCode}}',
    body: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
  <div style="background:#f3f4f6;padding:24px;border-radius:8px;margin-bottom:24px;">
    <h2 style="color:#1e40af;margin-top:0;">Verify Your Account</h2>
    <p style="margin:16px 0;">Hello {{traineeName}},</p>
    <p style="margin:16px 0;">
      Welcome! To complete your account setup, please enter this verification code:
    </p>
    <div style="background:#fff;border:2px solid #dbeafe;border-radius:8px;padding:16px;text-align:center;margin:20px 0;">
      <div style="font-size:32px;font-weight:bold;letter-spacing:4px;color:#1e40af;font-family:'Courier New',monospace;">
        {{otpCode}}
      </div>
    </div>
    <p style="margin:16px 0;color:#6b7280;">
      This code expires in <strong>15 minutes</strong>. Do not share this code with anyone.
    </p>
    <p style="margin:16px 0;">
      If you didn't request this code, you can safely ignore this email.
    </p>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;"/>
  <p style="font-size:12px;color:#6b7280;margin-top:16px;">
    {{lguName}} — Training Management System<br/>
    <a href="{{supportUrl}}" style="color:#1e40af;text-decoration:none;">Need help?</a>
  </p>
</div>`,
  },

  password_reset_otp: {
    subject: 'Reset Your Password — Code: {{otpCode}}',
    body: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
  <div style="background:#fef3c7;border-left:4px solid #d97706;padding:16px;border-radius:4px;margin-bottom:24px;">
    <p style="margin:0;color:#78350f;"><strong>⚠️ Security Notice:</strong> Someone requested to reset your password. If this wasn't you, ignore this email.</p>
  </div>
  <div style="background:#f3f4f6;padding:24px;border-radius:8px;margin-bottom:24px;">
    <h2 style="color:#dc2626;margin-top:0;">Reset Your Password</h2>
    <p style="margin:16px 0;">We received a request to reset your password.</p>
    <p style="margin:16px 0;">Enter this verification code to proceed:</p>
    <div style="background:#fff;border:2px solid #fee2e2;border-radius:8px;padding:16px;text-align:center;margin:20px 0;">
      <div style="font-size:32px;font-weight:bold;letter-spacing:4px;color:#dc2626;font-family:'Courier New',monospace;">
        {{otpCode}}
      </div>
    </div>
    <p style="margin:16px 0;color:#6b7280;">
      <strong>Important:</strong> You will need to enter this code <strong>twice</strong> for verification:
    </p>
    <ol style="margin:16px 0;color:#6b7280;">
      <li>First, enter the code to verify it</li>
      <li>Then, enter it again to confirm ownership of this email</li>
    </ol>
    <p style="margin:16px 0;color:#6b7280;">
      This code expires in <strong>15 minutes</strong>.
    </p>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;"/>
  <p style="font-size:12px;color:#6b7280;margin-top:16px;">
    {{lguName}} — Training Management System<br/>
    <a href="{{supportUrl}}" style="color:#1e40af;text-decoration:none;">Report this if you didn't request a password reset</a>
  </p>
</div>`,
  },

  email_change_verification: {
    subject: 'Confirm Your New Email Address',
    body: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
  <div style="background:#f3f4f6;padding:24px;border-radius:8px;margin-bottom:24px;">
    <h2 style="color:#059669;margin-top:0;">Confirm Your Email Address</h2>
    <p style="margin:16px 0;">Hello,</p>
    <p style="margin:16px 0;">
      Someone (hopefully you!) requested to change the email address associated with your account.
    </p>
    <p style="margin:16px 0;">
      To confirm this change, please enter this verification code:
    </p>
    <div style="background:#fff;border:2px solid #dcfce7;border-radius:8px;padding:16px;text-align:center;margin:20px 0;">
      <div style="font-size:32px;font-weight:bold;letter-spacing:4px;color:#059669;font-family:'Courier New',monospace;">
        {{otpCode}}
      </div>
    </div>
    <p style="margin:16px 0;color:#6b7280;">
      This code expires in <strong>15 minutes</strong>.
    </p>
    <p style="margin:16px 0;color:#6b7280;">
      If you didn't request this change, your email address will remain unchanged.
    </p>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;"/>
  <p style="font-size:12px;color:#6b7280;margin-top:16px;">
    {{lguName}} — Training Management System<br/>
    <a href="{{supportUrl}}" style="color:#1e40af;text-decoration:none;">Report unauthorized access</a>
  </p>
</div>`,
  },

  program_notification: {
    subject: 'New Program Available: {{programName}}',
    body: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
  <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:16px;border-radius:4px;margin-bottom:24px;">
    <p style="margin:0;color:#1e3a8a;"><strong>📚 New Opportunity!</strong> A new training program is now available.</p>
  </div>
  <div style="background:#f9fafb;padding:20px;border-radius:8px;margin-bottom:24px;">
    <h2 style="color:#2563eb;margin-top:0;">{{programName}}</h2>
    <p style="margin:12px 0;color:#4b5563;">{{programDescription}}</p>
    <table style="width:100%;margin:20px 0;">
      <tr>
        <td style="padding:8px 0;color:#6b7280;"><strong>Duration:</strong></td>
        <td style="padding:8px 0;text-align:right;color:#1f2937;">{{duration}} weeks</td>
      </tr>
      <tr style="border-top:1px solid #e5e7eb;">
        <td style="padding:8px 0;color:#6b7280;"><strong>Start Date:</strong></td>
        <td style="padding:8px 0;text-align:right;color:#1f2937;">{{startDate}}</td>
      </tr>
      <tr style="border-top:1px solid #e5e7eb;">
        <td style="padding:8px 0;color:#6b7280;"><strong>Level:</strong></td>
        <td style="padding:8px 0;text-align:right;color:#1f2937;">{{level}}</td>
      </tr>
    </table>
    <div style="text-align:center;margin-top:24px;">
      <a href="{{enrollmentUrl}}"
         style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
        View & Enroll Now
      </a>
    </div>
  </div>
  <p style="margin:16px 0;font-size:13px;color:#6b7280;">
    Spots are limited. Enroll early to secure your place in this program!
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;"/>
  <p style="font-size:12px;color:#6b7280;margin-top:16px;">
    {{lguName}} — Training Management System<br/>
    <a href="{{preferencesUrl}}" style="color:#1e40af;text-decoration:none;">Manage notification preferences</a>
  </p>
</div>`,
  },

  account_approval_confirmation: {
    subject: 'Your Account Has Been Approved — {{lguName}}',
    body: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#dcfce7;border-left:4px solid #22c55e;padding:16px;border-radius:4px;margin-bottom:24px;">
    <p style="margin:0;color:#166534;"><strong>✓ Great News!</strong> Your account registration has been approved.</p>
  </div>
  <div style="background:#f9fafb;padding:20px;border-radius:8px;margin-bottom:24px;">
    <h2 style="color:#22c55e;margin-top:0;">Welcome, {{traineeName}}!</h2>
    <p style="margin:16px 0;">Your account registration has been successfully approved and is now active.</p>
    <p style="margin:16px 0;"><strong>Account Details:</strong></p>
    <table style="width:100%;margin:16px 0;">
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 0;color:#6b7280;"><strong>Username:</strong></td>
        <td style="padding:8px 0;text-align:right;color:#1f2937;">{{username}}</td>
      </tr>
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 0;color:#6b7280;"><strong>Email:</strong></td>
        <td style="padding:8px 0;text-align:right;color:#1f2937;">{{email}}</td>
      </tr>
    </table>
    <div style="background:#eff6ff;padding:16px;border-radius:6px;margin:20px 0;">
      <p style="margin:8px 0;color:#1e40af;"><strong>Next Steps:</strong></p>
      <ol style="margin:8px 0;padding-left:20px;color:#374151;">
        <li>Log in to your account with your credentials</li>
        <li>Complete your profile if needed</li>
        <li>Browse and enroll in available programs</li>
      </ol>
    </div>
  </div>
  <div style="text-align:center;margin:24px 0;">
    <a href="{{loginUrl}}"
       style="background:#22c55e;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
      Log In Now
    </a>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;"/>
  <p style="font-size:12px;color:#6b7280;margin-top:16px;">
    {{lguName}} — Training Management System<br/>
    <a href="{{supportUrl}}" style="color:#1e40af;text-decoration:none;">Need help?</a>
  </p>
</div>`,
  },

  welcome_email: {
    subject: 'Welcome to {{lguName}} — Your Account is Ready!',
    body: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#f0f9ff;border-left:4px solid #3b82f6;padding:16px;border-radius:4px;margin-bottom:24px;">
    <p style="margin:0;color:#1e3a8a;"><strong>👋 Welcome to {{lguName}}!</strong></p>
  </div>
  <div style="background:#f9fafb;padding:20px;border-radius:8px;margin-bottom:24px;">
    <h2 style="color:#3b82f6;margin-top:0;">Let's Get You Started</h2>
    <p style="margin:16px 0;">Hello {{traineeName}},</p>
    <p style="margin:16px 0;">
      Welcome to the {{lguName}} Training Management System! We're excited to have you on board. 
      Your account has been set up and you can now access all the features and opportunities available.
    </p>
    <h3 style="color:#1f2937;font-size:16px;margin:20px 0 12px 0;">What You Can Do Now:</h3>
    <ul style="margin:12px 0;padding-left:20px;color:#374151;">
      <li style="margin:8px 0;">Browse and enroll in available training programs</li>
      <li style="margin:8px 0;">View your enrollment status and schedule</li>
      <li style="margin:8px 0;">Track your attendance and progress</li>
      <li style="margin:8px 0;">Download your certificates upon completion</li>
      <li style="margin:8px 0;">Manage your profile and notification preferences</li>
    </ul>
    <div style="background:#eff6ff;padding:16px;border-radius:6px;margin:20px 0;">
      <h3 style="color:#1e40af;font-size:14px;margin:0 0 12px 0;">Pro Tips:</h3>
      <ul style="margin:0;padding-left:20px;color:#1e40af;font-size:13px;">
        <li style="margin:6px 0;">Check out the available programs to find courses that match your interests</li>
        <li style="margin:6px 0;">Update your profile completely to help us serve you better</li>
        <li style="margin:6px 0;">Enable notifications to stay updated on program schedules and opportunities</li>
      </ul>
    </div>
  </div>
  <div style="text-align:center;margin:24px 0;">
    <a href="{{portalUrl}}"
       style="background:#3b82f6;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
      Visit Portal
    </a>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
  <div style="background:#f5f5f5;padding:16px;border-radius:6px;">
    <p style="margin:8px 0;font-size:12px;color:#6b7280;">
      <strong>Need Help?</strong><br/>
      If you have any questions, please reach out to our support team at <a href="mailto:{{supportEmail}}" style="color:#3b82f6;text-decoration:none;">{{supportEmail}}</a>
    </p>
  </div>
  <p style="font-size:11px;color:#9ca3af;margin-top:16px;text-align:center;">
    {{lguName}} — Training Management System
  </p>
</div>`,
  },

  registration_rejection: {
    subject: 'Registration Application Status — {{lguName}}',
    body: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:16px;border-radius:4px;margin-bottom:24px;">
    <p style="margin:0;color:#7f1d1d;"><strong>⚠️ Application Status Update</strong></p>
  </div>
  <div style="background:#f9fafb;padding:20px;border-radius:8px;margin-bottom:24px;">
    <h2 style="color:#dc2626;margin-top:0;">Application Not Approved</h2>
    <p style="margin:16px 0;">Hello {{traineeName}},</p>
    <p style="margin:16px 0;">
      Thank you for submitting your registration application to {{lguName}}. 
      We have reviewed your application and regret to inform you that it has not been approved at this time.
    </p>
    {{#rejectionReason}}<div style="background:#fff3f3;border:1px solid #fca5a5;padding:16px;border-radius:6px;margin:16px 0;">
      <p style="margin:0;color:#7f1d1d;"><strong>Reason:</strong></p>
      <p style="margin:8px 0;color:#5f1919;">{{rejectionReason}}</p>
    </div>{{/rejectionReason}}
    <h3 style="color:#1f2937;font-size:15px;margin:20px 0 12px 0;">What Can You Do?</h3>
    <ul style="margin:12px 0;padding-left:20px;color:#374151;">
      <li style="margin:8px 0;">Contact the training coordinators for more information about your application</li>
      <li style="margin:8px 0;">Address any concerns raised and consider reapplying</li>
      <li style="margin:8px 0;">Check back later for new program opportunities that may be a better fit</li>
    </ul>
  </div>
  <div style="background:#f5f5f5;padding:16px;border-radius:6px;margin:16px 0;">
    <p style="margin:8px 0;font-size:12px;color:#6b7280;">
      <strong>Have Questions?</strong><br/>
      Please reach out to our support team at <a href="mailto:{{supportEmail}}" style="color:#dc2626;text-decoration:none;">{{supportEmail}}</a>
    </p>
  </div>
  <p style="font-size:11px;color:#9ca3af;margin-top:16px;text-align:center;">
    {{lguName}} — Training Management System
  </p>
</div>`,
  },
};

// Create template for each ID for later reference
export const TEMPLATE_NAMES = {
  ENROLLMENT_CONFIRMATION: 'enrollment_confirmation',
  SCHEDULE_CHANGE: 'schedule_change',
  TRAINING_REMINDER: 'training_reminder',
  TRAINING_COMPLETION: 'training_completion',
  OTP_2FA_VERIFICATION: 'otp_2fa_verification',
  PASSWORD_RESET_OTP: 'password_reset_otp',
  EMAIL_CHANGE_VERIFICATION: 'email_change_verification',
  PROGRAM_NOTIFICATION: 'program_notification',
  ACCOUNT_APPROVAL_CONFIRMATION: 'account_approval_confirmation',
  WELCOME_EMAIL: 'welcome_email',
  REGISTRATION_REJECTION: 'registration_rejection',
} as const;

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
 */
function backoffDelay(attempt: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, attempt);
}

/**
 * Render a template string by substituting {{variable}} placeholders.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

/**
 * Build a Nodemailer transporter from an EmailConfig.
 */
function createTransporter(config: EmailConfig): Transporter {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465, // true for port 465, false for 587
    requireTLS: config.useTls && config.smtpPort !== 465,
    auth: {
      user: config.smtpUsername,
      pass: config.smtpPassword,
    },
  });
}

/**
 * Build a Nodemailer transporter from platform-level environment variables.
 * Used as fallback when a tenant has no email config (Req 12.7).
 */
function createFallbackTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USERNAME;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
  });
}

/**
 * Derive the sender address from config or environment fallback.
 */
function getSenderAddress(config: EmailConfig | null): string {
  if (config?.senderName && config?.senderEmail) {
    return `"${config.senderName}" <${config.senderEmail}>`;
  }

const fallbackName = process.env.SMTP_SENDER_NAME ?? 'Training Management System';
  const fallbackEmail = process.env.SMTP_SENDER_EMAIL ?? 'noreply@example.com';
  return `"${fallbackName}" <${fallbackEmail}>`;
}

/**
 * Persist a notification attempt record to the audit_logs table (Req 12.9).
 */
async function logEmailAttempt(params: {
  tenantId: string;
  recipientEmail: string;
  templateName: string;
  deliveryStatus: 'sent' | 'failed' | 'queued';
  messageId?: string;
  error?: string;
  attempts: number;
  usedFallbackConfig: boolean;
}): Promise<void> {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      tenant_id: params.tenantId,
      action: 'email_notification',
      entity_type: 'notification',
      entity_id: null,
      details: {
        channel: 'email',
        recipient_email: params.recipientEmail,
        template_name: params.templateName,
        delivery_status: params.deliveryStatus,
        message_id: params.messageId ?? null,
        error: params.error ?? null,
        attempts: params.attempts,
        used_fallback_config: params.usedFallbackConfig,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (logError) {
    logger.warn('[EMAIL] Failed to write notification audit log', { logError });
  }
}

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

/**
 * Send an email notification using the tenant's configured SMTP settings.
 *
 * Falls back to platform-level SMTP config if the tenant has none (Req 12.7).
 * Implements retry logic with exponential backoff.
 * Logs all attempts to audit_logs (Req 12.9).
 *
 * @returns EmailResult describing the outcome.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const {
    tenantId,
    recipientEmail,
    subject,
    templateName,
    templateBody,
    templateVariables = {},
    textBody,
  } = message;

  // ── 1. Retrieve tenant email configuration ───────────────────────────────

let emailConfig: EmailConfig | null = null;
  let usedFallbackConfig = false;

  try {
    const tenantConfig = await getTenantConfiguration(tenantId);
    emailConfig = tenantConfig?.notifications?.email ?? null;
  } catch (configError) {
    logger.warn('[EMAIL] Failed to retrieve tenant email config, will use fallback', {
      tenantId,
      configError,
    });
  }

  // ── 2. Build transporter ─────────────────────────────────────────────────

let transporter: Transporter | null = null;

  if (emailConfig?.smtpHost && emailConfig?.smtpUsername && emailConfig?.smtpPassword) {
    transporter = createTransporter(emailConfig);
  } else {
    // Fall back to platform defaults (Req 12.7)
    transporter = createFallbackTransporter();
    usedFallbackConfig = true;

    if (!transporter) {
      const result: EmailResult = {
        success: false,
        error: 'No email configuration available (tenant config missing and no platform fallback)',
        deliveryStatus: 'failed',
        attempts: 0,
        usedFallbackConfig: true,
      };

      await logEmailAttempt({ tenantId, recipientEmail, templateName, ...result });
      return result;
    }
  }

  // ── 3. Render template ───────────────────────────────────────────────────

const renderedSubject = renderTemplate(subject, templateVariables);
  const renderedHtml = renderTemplate(templateBody, templateVariables);
  const renderedText = textBody ? renderTemplate(textBody, templateVariables) : undefined;
  const from = getSenderAddress(usedFallbackConfig ? null : emailConfig);

  // ── 4. Send with retry logic ─────────────────────────────────────────────

let lastError: string | undefined;
  let messageId: string | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = backoffDelay(attempt - 1);
      logger.info(`[EMAIL] Retrying send (attempt ${attempt + 1}/${MAX_RETRIES}) after ${delay}ms`, {
        tenantId,
        recipientEmail,
        templateName,
      });
      await sleep(delay);
    }

    try {
      const info = await transporter.sendMail({
        from,
        to: recipientEmail,
        subject: renderedSubject,
        html: renderedHtml,
        ...(renderedText ? { text: renderedText } : {}),
      });

      messageId = info.messageId;

      const result: EmailResult = {
        success: true,
        messageId,
        deliveryStatus: 'sent',
        attempts: attempt + 1,
        usedFallbackConfig,
      };

      await logEmailAttempt({ tenantId, recipientEmail, templateName, ...result });

      logger.info('[EMAIL] Message sent successfully', {
        tenantId,
        recipientEmail,
        templateName,
        messageId,
        attempts: attempt + 1,
        usedFallbackConfig,
      });

      return result;
    } catch (sendError: any) {
      lastError = sendError?.message ?? 'Unknown send error';
      logger.warn(`[EMAIL] Send attempt ${attempt + 1} failed`, {
        tenantId,
        recipientEmail,
        templateName,
        error: lastError,
      });
    }
  }

  // ── 5. All attempts exhausted ────────────────────────────────────────────

const failedResult: EmailResult = {
    success: false,
    error: lastError ?? 'All retry attempts failed',
    deliveryStatus: 'failed',
    attempts: MAX_RETRIES,
    usedFallbackConfig,
  };

  await logEmailAttempt({ tenantId, recipientEmail, templateName, ...failedResult });

  logger.error('[EMAIL] All send attempts failed', {
    tenantId,
    recipientEmail,
    templateName,
    error: lastError,
  });

  return failedResult;
}

// ---------------------------------------------------------------------------
// Convenience wrappers for specific notification types
// ---------------------------------------------------------------------------

/**
 * Send enrollment confirmation email (Req 12.1).
 */
export async function sendEnrollmentConfirmationEmail(params: {
  tenantId: string;
  recipientEmail: string;
  traineeName: string;
  programName: string;
  startDate: string;
  lguName?: string;
}): Promise<EmailResult> {
  const tpl = EMAIL_TEMPLATES.enrollment_confirmation;
  return sendEmail({
    tenantId: params.tenantId,
    recipientEmail: params.recipientEmail,
    subject: tpl.subject,
    templateName: 'enrollment_confirmation',
    templateBody: tpl.body,
    templateVariables: {
      traineeName: params.traineeName,
      programName: params.programName,
      startDate: params.startDate,
      lguName: params.lguName ?? 'Training Management System',
    },
  });
}

/**
 * Send schedule change email (Req 12.2).
 */
export async function sendScheduleChangeEmail(params: {
  tenantId: string;
  recipientEmail: string;
  traineeName: string;
  programName: string;
  changeDescription: string;
  lguName?: string;
}): Promise<EmailResult> {
  const tpl = EMAIL_TEMPLATES.schedule_change;
  return sendEmail({
    tenantId: params.tenantId,
    recipientEmail: params.recipientEmail,
    subject: tpl.subject,
    templateName: 'schedule_change',
    templateBody: tpl.body,
    templateVariables: {
      traineeName: params.traineeName,
      programName: params.programName,
      changeDescription: params.changeDescription,
      lguName: params.lguName ?? 'Training Management System',
    },
  });
}

/**
 * Send 24-hour training reminder email (Req 12.3).
 */
export async function sendTrainingReminderEmail(params: {
  tenantId: string;
  recipientEmail: string;
  traineeName: string;
  programName: string;
  sessionDate: string;
  sessionTime: string;
  location?: string;
  lguName?: string;
}): Promise<EmailResult> {
  const tpl = EMAIL_TEMPLATES.training_reminder;
  return sendEmail({
    tenantId: params.tenantId,
    recipientEmail: params.recipientEmail,
    subject: tpl.subject,
    templateName: 'training_reminder',
    templateBody: tpl.body,
    templateVariables: {
      traineeName: params.traineeName,
      programName: params.programName,
      sessionDate: params.sessionDate,
      sessionTime: params.sessionTime,
      location: params.location ?? 'TBA',
      lguName: params.lguName ?? 'Training Management System',
    },
  });
}

/**
 * Send training completion email with certificate link (Req 12.4).
 */
export async function sendCompletionEmail(params: {
  tenantId: string;
  recipientEmail: string;
  traineeName: string;
  programName: string;
  certificateUrl: string;
  lguName?: string;
}): Promise<EmailResult> {
  const tpl = EMAIL_TEMPLATES.training_completion;
  return sendEmail({
    tenantId: params.tenantId,
    recipientEmail: params.recipientEmail,
    subject: tpl.subject,
    templateName: 'training_completion',
    templateBody: tpl.body,
    templateVariables: {
      traineeName: params.traineeName,
      programName: params.programName,
      certificateUrl: params.certificateUrl,
      lguName: params.lguName ?? 'Training Management System',
    },
  });
}
// ---------------------------------------------------------------------------
// 2FA & Authentication Email Wrappers (migration 013)
// ---------------------------------------------------------------------------

/**
 * Send 2FA verification email with OTP code.
 */
export async function send2FAOtpEmail(params: {
  tenantId: string;
  recipientEmail: string;
  traineeName: string;
  otpCode: string;
  lguName?: string;
  supportUrl?: string;
}): Promise<EmailResult> {
  const tpl = EMAIL_TEMPLATES.otp_2fa_verification;
  return sendEmail({
    tenantId: params.tenantId,
    recipientEmail: params.recipientEmail,
    subject: tpl.subject,
    templateName: 'otp_2fa_verification',
    templateBody: tpl.body,
    templateVariables: {
      traineeName: params.traineeName,
      otpCode: params.otpCode,
      lguName: params.lguName ?? 'Training Management System',
      supportUrl: params.supportUrl ?? '#',
    },
  });
}

/**
 * Send password reset OTP email.
 */
export async function sendPasswordResetOtpEmail(params: {
  tenantId: string;
  recipientEmail: string;
  otpCode: string;
  lguName?: string;
  supportUrl?: string;
}): Promise<EmailResult> {
  const tpl = EMAIL_TEMPLATES.password_reset_otp;
  return sendEmail({
    tenantId: params.tenantId,
    recipientEmail: params.recipientEmail,
    subject: tpl.subject,
    templateName: 'password_reset_otp',
    templateBody: tpl.body,
    templateVariables: {
      otpCode: params.otpCode,
      lguName: params.lguName ?? 'Training Management System',
      supportUrl: params.supportUrl ?? '#',
    },
  });
}

/**
 * Send email change verification code.
 */
export async function sendEmailChangeOtpEmail(params: {
  tenantId: string;
  recipientEmail: string;
  otpCode: string;
  lguName?: string;
  supportUrl?: string;
}): Promise<EmailResult> {
  const tpl = EMAIL_TEMPLATES.email_change_verification;
  return sendEmail({
    tenantId: params.tenantId,
    recipientEmail: params.recipientEmail,
    subject: tpl.subject,
    templateName: 'email_change_verification',
    templateBody: tpl.body,
    templateVariables: {
      otpCode: params.otpCode,
      lguName: params.lguName ?? 'Training Management System',
      supportUrl: params.supportUrl ?? '#',
    },
  });
}

/**
 * Send program availability notification to a trainee.
 */
export async function sendProgramNotificationEmail(params: {
  tenantId: string;
  recipientEmail: string;
  programName: string;
  programDescription: string;
  duration: string;
  startDate: string;
  level: string;
  enrollmentUrl: string;
  lguName?: string;
  preferencesUrl?: string;
}): Promise<EmailResult> {
  const tpl = EMAIL_TEMPLATES.program_notification;
  return sendEmail({
    tenantId: params.tenantId,
    recipientEmail: params.recipientEmail,
    subject: tpl.subject,
    templateName: 'program_notification',
    templateBody: tpl.body,
    templateVariables: {
      programName: params.programName,
      programDescription: params.programDescription,
      duration: params.duration,
      startDate: params.startDate,
      level: params.level,
      enrollmentUrl: params.enrollmentUrl,
      lguName: params.lguName ?? 'Training Management System',
      preferencesUrl: params.preferencesUrl ?? '#',
    },
  });
}

/**
 * Send account approval confirmation email after admin approval.
 * Sent to newly approved trainee with account details and login instructions.
 */
export async function sendAccountApprovalConfirmationEmail(params: {
  tenantId: string;
  recipientEmail: string;
  traineeName: string;
  username: string;
  email: string;
  loginUrl: string;
  lguName?: string;
  supportUrl?: string;
}): Promise<EmailResult> {
  const tpl = EMAIL_TEMPLATES.account_approval_confirmation;
  return sendEmail({
    tenantId: params.tenantId,
    recipientEmail: params.recipientEmail,
    subject: tpl.subject,
    templateName: 'account_approval_confirmation',
    templateBody: tpl.body,
    templateVariables: {
      traineeName: params.traineeName,
      username: params.username,
      email: params.email,
      loginUrl: params.loginUrl,
      lguName: params.lguName ?? 'Training Management System',
      supportUrl: params.supportUrl ?? '#',
    },
  });
}

/**
 * Send welcome email after account approval.
 * Provides overview of platform features and next steps.
 */
export async function sendWelcomeEmail(params: {
  tenantId: string;
  recipientEmail: string;
  traineeName: string;
  portalUrl: string;
  supportEmail?: string;
  lguName?: string;
}): Promise<EmailResult> {
  const tpl = EMAIL_TEMPLATES.welcome_email;
  return sendEmail({
    tenantId: params.tenantId,
    recipientEmail: params.recipientEmail,
    subject: tpl.subject,
    templateName: 'welcome_email',
    templateBody: tpl.body,
    templateVariables: {
      traineeName: params.traineeName,
      portalUrl: params.portalUrl,
      supportEmail: params.supportEmail ?? 'support@example.com',
      lguName: params.lguName ?? 'Training Management System',
    },
  });
}

/**
 * Send registration rejection email to trainee.
 * Notifies them that their application was not approved and provides next steps.
 */
export async function sendRegistrationRejectionEmail(params: {
  tenantId: string;
  recipientEmail: string;
  traineeName: string;
  rejectionReason?: string;
  supportEmail?: string;
  lguName?: string;
}): Promise<EmailResult> {
  const tpl = EMAIL_TEMPLATES.registration_rejection;
  
  // Render template body with conditional rejection reason
  let renderedBody = tpl.body;
  if (params.rejectionReason) {
    renderedBody = renderedBody.replace('{{#rejectionReason}}', '').replace('{{/rejectionReason}}', '');
  } else {
    // Remove the conditional block if no reason provided
    renderedBody = renderedBody.replace(/{{#rejectionReason}}[\s\S]*?{{\/rejectionReason}}/g, '');
  }
  
  return sendEmail({
    tenantId: params.tenantId,
    recipientEmail: params.recipientEmail,
    subject: tpl.subject,
    templateName: 'registration_rejection',
    templateBody: renderedBody,
    templateVariables: {
      traineeName: params.traineeName,
      rejectionReason: params.rejectionReason ?? '',
      supportEmail: params.supportEmail ?? 'support@example.com',
      lguName: params.lguName ?? 'Training Management System',
    },
  });
}
