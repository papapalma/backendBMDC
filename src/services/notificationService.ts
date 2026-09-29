/**
 * Notification Orchestration Service
 *
 * Implements Requirement 12.5:
 *   - 12.5  Notifications are sent only to trainees within the same tenant
 *           as the training program (no cross-tenant notifications)
 *
 * This service is the single entry point for all notification triggers.
 * It coordinates WhatsApp and email delivery, enforces tenant boundaries,
 * and respects trainee notification preferences (Req 12.11).
 *
 * Notification triggers:
 *   - Enrollment confirmation  (WhatsApp + email, Req 12.1)
 *   - Schedule change          (WhatsApp + email, Req 12.2)
 *   - Training reminder        (WhatsApp + email, Req 12.3, 24h before start)
 *   - Training completion      (WhatsApp + email, Req 12.4)
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import {
  sendEnrollmentConfirmation,
  sendScheduleChangeNotification,
  sendTrainingReminder,
  sendCompletionNotification,
} from './whatsappService';
import {
  sendEnrollmentConfirmationEmail,
  sendScheduleChangeEmail,
  sendTrainingReminderEmail,
  sendCompletionEmail,
} from './emailService';
import { sendPushNotificationToUser } from './pushService';
import type { NotificationResult } from './whatsappService';
import type { EmailResult } from './emailService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationOutcome {
  whatsapp?: NotificationResult;
  email?: EmailResult;
  push?: { success: boolean; sent: number; failed: number };
  skippedWhatsApp?: string;
  skippedEmail?: string;
  skippedPush?: string;
}

/**
 * Trainee notification preferences (3NF normalized).
 * Stored in the `trainee_notification_preferences` table (Req 12.11).
 * Replaces old JSONB column on trainees table.
 */
export interface TraineeNotificationPreferences {
  /** Email notifications enabled */
  emailEnabled: boolean;
  /** SMS notifications enabled */
  smsEnabled: boolean;
  /** Push notifications enabled */
  pushEnabled: boolean;
  /** In-app notifications enabled */
  inAppEnabled: boolean;
  /** Weekly digest enabled */
  weeklyDigest: boolean;
  /** Event reminders enabled */
  eventReminders: boolean;
  /** Enrollment updates enabled */
  enrollmentUpdates: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a trainee's contact details and notification preferences.
 * Returns null if the trainee is not found or belongs to a different tenant.
 *
 * Enforces tenant boundary: trainee must belong to the same tenant as the
 * program (Req 12.5).
 *
 * Now reads notification preferences from normalized trainee_notification_preferences table.
 */
async function getTraineeContactInfo(
  traineeId: string,
  tenantId: string
): Promise<{
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  notificationPreferences: TraineeNotificationPreferences;
} | null> {
  // Fetch trainee contact info
  const { data: traineeData, error: traineeError } = await supabaseAdmin
    .from('trainees')
    .select('id, first_name, last_name, phone, email, tenant_id')
    .eq('id', traineeId)
    .eq('tenant_id', tenantId) // Enforce tenant boundary (Req 12.5)
    .maybeSingle();

  if (traineeError) {
    logger.error('[NOTIFICATION] Failed to fetch trainee contact info', { error: traineeError, traineeId });
    return null;
  }

  if (!traineeData) return null;

  // Fetch notification preferences from normalized table
  const { data: prefsData, error: prefsError } = await supabaseAdmin
    .from('trainee_notification_preferences')
    .select('email_enabled, sms_enabled, push_enabled, in_app_enabled, weekly_digest, event_reminders, enrollment_updates')
    .eq('trainee_id', traineeId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (prefsError) {
    logger.error('[NOTIFICATION] Failed to fetch notification preferences', { error: prefsError, traineeId });
  }

  // Use default preferences if not found
  const notificationPreferences: TraineeNotificationPreferences = prefsData ? {
    emailEnabled: prefsData.email_enabled ?? true,
    smsEnabled: prefsData.sms_enabled ?? true,
    pushEnabled: prefsData.push_enabled ?? true,
    inAppEnabled: prefsData.in_app_enabled ?? true,
    weeklyDigest: prefsData.weekly_digest ?? true,
    eventReminders: prefsData.event_reminders ?? true,
    enrollmentUpdates: prefsData.enrollment_updates ?? true,
  } : {
    emailEnabled: true,
    smsEnabled: true,
    pushEnabled: true,
    inAppEnabled: true,
    weeklyDigest: true,
    eventReminders: true,
    enrollmentUpdates: true,
  };

  return {
    phone: traineeData.phone,
    email: traineeData.email,
    firstName: traineeData.first_name,
    lastName: traineeData.last_name,
    tenantId: traineeData.tenant_id,
    notificationPreferences,
  };
}

/**
 * Fetch the LGU name for a tenant (used in email templates).
 */
async function getTenantName(tenantId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();
  return data?.name ?? 'Training Management System';
}

// ---------------------------------------------------------------------------
// Notification triggers
// ---------------------------------------------------------------------------

/**
 * Send enrollment confirmation to a trainee via WhatsApp and email (Req 12.1).
 *
 * Respects opt-out preferences (Req 12.11).
 * Enforces tenant boundary — trainee must belong to the same tenant as the
 * program (Req 12.5).
 */
export async function notifyEnrollmentConfirmation(params: {
  tenantId: string;
  traineeId: string;
  programName: string;
  startDate: string;
}): Promise<NotificationOutcome> {
  const trainee = await getTraineeContactInfo(params.traineeId, params.tenantId);
  if (!trainee) {
    logger.warn('[NOTIFICATION] Trainee not found or cross-tenant access blocked', {
      traineeId: params.traineeId,
      tenantId: params.tenantId,
    });
    return {
      skippedWhatsApp: 'Trainee not found in tenant',
      skippedEmail: 'Trainee not found in tenant',
    };
  }

  const prefs = trainee.notificationPreferences;
  const traineeName = `${trainee.firstName} ${trainee.lastName}`;
  const lguName = await getTenantName(params.tenantId);
  const outcome: NotificationOutcome = {};

  // WhatsApp
  if (!prefs.enrollmentUpdates || !prefs.smsEnabled) {
    outcome.skippedWhatsApp = 'Trainee opted out of enrollment notifications';
  } else if (trainee.phone) {
    outcome.whatsapp = await sendEnrollmentConfirmation({
      tenantId: params.tenantId,
      recipientPhone: trainee.phone,
      traineeName,
      programName: params.programName,
      startDate: params.startDate,
    });
  } else {
    outcome.skippedWhatsApp = 'No phone number on record';
  }

  // Email
  if (!prefs.enrollmentUpdates || !prefs.emailEnabled) {
    outcome.skippedEmail = 'Trainee opted out of enrollment notifications';
  } else if (trainee.email) {
    outcome.email = await sendEnrollmentConfirmationEmail({
      tenantId: params.tenantId,
      recipientEmail: trainee.email,
      traineeName,
      programName: params.programName,
      startDate: params.startDate,
      lguName,
    });
  } else {
    outcome.skippedEmail = 'No email address on record';
  }

  // Push Notification
  if (!prefs.enrollmentUpdates || !prefs.pushEnabled) {
    outcome.skippedPush = 'Trainee opted out of enrollment notifications';
  } else {
    const pushResult = await sendPushNotificationToUser(
      params.traineeId,
      params.tenantId,
      {
        title: 'Enrollment Confirmed',
        body: `You have been enrolled in ${params.programName} starting ${params.startDate}`,
        tag: 'enrollment',
        url: '/trainee-dashboard',
        data: {
          type: 'enrollment',
          programName: params.programName,
          startDate: params.startDate,
        },
      }
    );
    outcome.push = {
      success: pushResult.sent > 0,
      sent: pushResult.sent,
      failed: pushResult.failed,
    };
  }

  return outcome;
}

/**
 * Send training schedule change notification (Req 12.2).
 *
 * Sends to all active trainees enrolled in the program within the same tenant.
 * Respects opt-out preferences (Req 12.11).
 */
export async function notifyScheduleChange(params: {
  tenantId: string;
  programId: string;
  programName: string;
  changeDescription: string;
}): Promise<NotificationOutcome[]> {
  // Fetch all active enrollments for this program within the tenant (Req 12.5)
  const { data: enrollments, error } = await supabaseAdmin
    .from('enrollments')
    .select('trainee_id')
    .eq('program_id', params.programId)
    .eq('tenant_id', params.tenantId)
    .in('status', ['enrolled', 'active']);

  if (error) {
    logger.error('[NOTIFICATION] Failed to fetch enrollments for schedule change', { error });
    return [];
  }

  const lguName = await getTenantName(params.tenantId);
  const outcomes: NotificationOutcome[] = [];

  for (const enrollment of enrollments ?? []) {
    const trainee = await getTraineeContactInfo(enrollment.trainee_id, params.tenantId);
    if (!trainee) continue;

    const prefs = trainee.notificationPreferences;
    const traineeName = `${trainee.firstName} ${trainee.lastName}`;
    const outcome: NotificationOutcome = {};

    // WhatsApp
    if (!prefs.eventReminders || !prefs.smsEnabled) {
      outcome.skippedWhatsApp = 'Trainee opted out';
    } else if (trainee.phone) {
      outcome.whatsapp = await sendScheduleChangeNotification({
        tenantId: params.tenantId,
        recipientPhone: trainee.phone,
        traineeName,
        programName: params.programName,
        changeDescription: params.changeDescription,
      });
    }

    // Email
    if (!prefs.eventReminders || !prefs.emailEnabled) {
      outcome.skippedEmail = 'Trainee opted out';
    } else if (trainee.email) {
      outcome.email = await sendScheduleChangeEmail({
        tenantId: params.tenantId,
        recipientEmail: trainee.email,
        traineeName,
        programName: params.programName,
        changeDescription: params.changeDescription,
        lguName,
      });
    }

    // Push Notification
    if (!prefs.eventReminders || !prefs.pushEnabled) {
      outcome.skippedPush = 'Trainee opted out';
    } else {
      const pushResult = await sendPushNotificationToUser(
        enrollment.trainee_id,
        params.tenantId,
        {
          title: 'Schedule Change',
          body: `${params.programName}: ${params.changeDescription}`,
          tag: 'schedule-change',
          url: '/trainee-dashboard',
          data: {
            type: 'schedule-change',
            programName: params.programName,
            changeDescription: params.changeDescription,
          },
        }
      );
      outcome.push = {
        success: pushResult.sent > 0,
        sent: pushResult.sent,
        failed: pushResult.failed,
      };
    }

    outcomes.push(outcome);
  }

  return outcomes;
}

/**
 * Send 24-hour training reminder to a trainee (Req 12.3).
 *
 * Respects opt-out preferences (Req 12.11).
 */
export async function notifyTrainingReminder(params: {
  tenantId: string;
  traineeId: string;
  programName: string;
  sessionDate: string;
  sessionTime: string;
  location?: string;
}): Promise<NotificationOutcome> {
  const trainee = await getTraineeContactInfo(params.traineeId, params.tenantId);
  if (!trainee) {
    return {
      skippedWhatsApp: 'Trainee not found in tenant',
      skippedEmail: 'Trainee not found in tenant',
    };
  }

  const prefs = trainee.notificationPreferences;
  const traineeName = `${trainee.firstName} ${trainee.lastName}`;
  const lguName = await getTenantName(params.tenantId);
  const outcome: NotificationOutcome = {};

  // WhatsApp
  if (!prefs.eventReminders || !prefs.smsEnabled) {
    outcome.skippedWhatsApp = 'Trainee opted out of reminders';
  } else if (trainee.phone) {
    outcome.whatsapp = await sendTrainingReminder({
      tenantId: params.tenantId,
      recipientPhone: trainee.phone,
      traineeName,
      programName: params.programName,
      sessionDate: params.sessionDate,
      sessionTime: params.sessionTime,
      location: params.location,
    });
  }

  // Email
  if (!prefs.eventReminders || !prefs.emailEnabled) {
    outcome.skippedEmail = 'Trainee opted out of reminders';
  } else if (trainee.email) {
    outcome.email = await sendTrainingReminderEmail({
      tenantId: params.tenantId,
      recipientEmail: trainee.email,
      traineeName,
      programName: params.programName,
      sessionDate: params.sessionDate,
      sessionTime: params.sessionTime,
      location: params.location,
      lguName,
    });
  }

  // Push Notification
  if (!prefs.eventReminders || !prefs.pushEnabled) {
    outcome.skippedPush = 'Trainee opted out of reminders';
  } else {
    const pushResult = await sendPushNotificationToUser(
      params.traineeId,
      params.tenantId,
      {
        title: 'Training Reminder',
        body: `${params.programName} starts ${params.sessionDate} at ${params.sessionTime}${params.location ? ` at ${params.location}` : ''}`,
        tag: 'training-reminder',
        url: '/trainee-dashboard',
        data: {
          type: 'training-reminder',
          programName: params.programName,
          sessionDate: params.sessionDate,
          sessionTime: params.sessionTime,
          location: params.location,
        },
      }
    );
    outcome.push = {
      success: pushResult.sent > 0,
      sent: pushResult.sent,
      failed: pushResult.failed,
    };
  }

  return outcome;
}

/**
 * Send training completion notification with certificate access (Req 12.4).
 *
 * Respects opt-out preferences (Req 12.11).
 */
export async function notifyTrainingCompletion(params: {
  tenantId: string;
  traineeId: string;
  programName: string;
  certificateUrl: string;
}): Promise<NotificationOutcome> {
  const trainee = await getTraineeContactInfo(params.traineeId, params.tenantId);
  if (!trainee) {
    return {
      skippedWhatsApp: 'Trainee not found in tenant',
      skippedEmail: 'Trainee not found in tenant',
    };
  }

  const prefs = trainee.notificationPreferences;
  const traineeName = `${trainee.firstName} ${trainee.lastName}`;
  const lguName = await getTenantName(params.tenantId);
  const outcome: NotificationOutcome = {};

  // WhatsApp
  if (!prefs.enrollmentUpdates || !prefs.smsEnabled) {
    outcome.skippedWhatsApp = 'Trainee opted out of completion notifications';
  } else if (trainee.phone) {
    outcome.whatsapp = await sendCompletionNotification({
      tenantId: params.tenantId,
      recipientPhone: trainee.phone,
      traineeName,
      programName: params.programName,
      certificateUrl: params.certificateUrl,
    });
  }

  // Email
  if (!prefs.enrollmentUpdates || !prefs.emailEnabled) {
    outcome.skippedEmail = 'Trainee opted out of completion notifications';
  } else if (trainee.email) {
    outcome.email = await sendCompletionEmail({
      tenantId: params.tenantId,
      recipientEmail: trainee.email,
      traineeName,
      programName: params.programName,
      certificateUrl: params.certificateUrl,
      lguName,
    });
  }

  // Push Notification
  if (!prefs.enrollmentUpdates || !prefs.pushEnabled) {
    outcome.skippedPush = 'Trainee opted out of completion notifications';
  } else {
    const pushResult = await sendPushNotificationToUser(
      params.traineeId,
      params.tenantId,
      {
        title: 'Training Completed',
        body: `Congratulations! You have completed ${params.programName}. Your certificate is ready.`,
        tag: 'training-completion',
        url: params.certificateUrl,
        data: {
          type: 'training-completion',
          programName: params.programName,
          certificateUrl: params.certificateUrl,
        },
      }
    );
    outcome.push = {
      success: pushResult.sent > 0,
      sent: pushResult.sent,
      failed: pushResult.failed,
    };
  }

  return outcome;
}
