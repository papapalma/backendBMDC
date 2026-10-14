/**
 * GET/PATCH /api/trainees/[id]/notification-preferences
 *
 * Get or update a trainee's comprehensive notification preferences.
 *
 * FIX: Now supports all 7 notification channel preferences from trainee_notification_preferences table:
 * - email_enabled, sms_enabled, push_enabled, in_app_enabled
 * - weekly_digest, event_reminders, enrollment_updates
 * - notify_on_program_posting (legacy, kept for backward compatibility)
 *
 * Request body (PATCH):
 * {
 *   "email_enabled": true,
 *   "sms_enabled": false,
 *   "push_enabled": true,
 *   ...
 *   "notify_on_program_posting": true  // legacy field
 * }
 *
 * Response:
 * {
 *   "email_enabled": true,
 *   "sms_enabled": false,
 *   ...
 *   "notify_on_program_posting": true
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { requireTenantContext } from '@/middleware/tenantContext';
import { withErrorHandler } from '@/middleware/errorHandler';
import { successResponse, notFoundResponse } from '@/utils/responses';
import { handleOptionsRequest } from '@/middleware/cors';

// Validation schema for comprehensive preferences
const preferencesSchema = z.object({
  email_enabled: z.boolean().optional(),
  sms_enabled: z.boolean().optional(),
  push_enabled: z.boolean().optional(),
  in_app_enabled: z.boolean().optional(),
  weekly_digest: z.boolean().optional(),
  event_reminders: z.boolean().optional(),
  enrollment_updates: z.boolean().optional(),
  notify_on_program_posting: z.boolean().optional(),  // legacy field
});

type NotificationPreferences = z.infer<typeof preferencesSchema>;

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

export const PATCH = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const traineeId = id;
    
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const context = ctxResult.context;
    const body = await request.json();
    const validated = preferencesSchema.parse(body);

    logger.info('[NOTIFICATION_PREFS] Updating preferences', { traineeId,
      preferences: validated, });

    // Verify trainee exists and belongs to tenant
    const { data: trainee, error: traineeError } = await supabaseAdmin
      .from('trainees')
      .select('id, tenant_id')
      .eq('id', traineeId)
      .eq('tenant_id', context.tenantId)
      .single();

    if (traineeError || !trainee) { logger.warn('[NOTIFICATION_PREFS] Trainee not found', { traineeId });
      return notFoundResponse('Trainee not found'); }

    // FIX: Update comprehensive preferences table
    const preferencesUpdate: any = {};

    // Add only provided fields
    if (validated.email_enabled !== undefined) preferencesUpdate.email_enabled = validated.email_enabled;
    if (validated.sms_enabled !== undefined) preferencesUpdate.sms_enabled = validated.sms_enabled;
    if (validated.push_enabled !== undefined) preferencesUpdate.push_enabled = validated.push_enabled;
    if (validated.in_app_enabled !== undefined) preferencesUpdate.in_app_enabled = validated.in_app_enabled;
    if (validated.weekly_digest !== undefined) preferencesUpdate.weekly_digest = validated.weekly_digest;
    if (validated.event_reminders !== undefined) preferencesUpdate.event_reminders = validated.event_reminders;
    if (validated.enrollment_updates !== undefined) preferencesUpdate.enrollment_updates = validated.enrollment_updates;

    // Upsert preferences in dedicated table
    if (Object.keys(preferencesUpdate).length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from('trainee_notification_preferences')
        .upsert(
          {
            trainee_id: traineeId,
            tenant_id: context.tenantId,
            ...preferencesUpdate,
          },
          { onConflict: 'trainee_id, tenant_id' }
        );

      if (updateError) { logger.error('[NOTIFICATION_PREFS] Failed to update preferences', { traineeId,
          error: updateError, });
        throw updateError; }
    }

    // Update legacy field for backward compatibility
    if (validated.notify_on_program_posting !== undefined) {
      const { error: legacyError } = await supabaseAdmin
        .from('trainees')
        .update({ notify_on_program_posting: validated.notify_on_program_posting })
        .eq('id', traineeId);

      if (legacyError) { logger.error('[NOTIFICATION_PREFS] Failed to update legacy field', { traineeId,
          error: legacyError, });
        throw legacyError; }
    }

    logger.info('[NOTIFICATION_PREFS] Preferences updated successfully', { traineeId,
      preferences: validated, });

    // Log to audit_logs
    await supabaseAdmin.from('audit_logs').insert({ tenant_id: context.tenantId,
      user_id: context.userId,
      action: 'notification_preferences.updated',
      entity_type: 'trainee',
      entity_id: traineeId,
      details: { changes: validated, }, });

    // Return updated preferences
    const { data: updated } = await supabaseAdmin
      .from('trainee_notification_preferences')
      .select('*')
      .eq('trainee_id', traineeId)
      .maybeSingle();

    return successResponse(
      {
        ...updated,
        notify_on_program_posting: validated.notify_on_program_posting,
      },
      'Preferences updated successfully'
    );
  }
);

/**
 * GET /api/trainees/[id]/notification-preferences
 *
 * Get a trainee's current comprehensive notification preferences.
 * FIX: Now returns all 7 channel preferences from trainee_notification_preferences table
 */
export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const { id } = await params;
    const traineeId = id;
    
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const context = ctxResult.context;

    logger.info('[NOTIFICATION_PREFS] Fetching preferences', { traineeId });

    // Verify trainee exists
    const { data: trainee, error: traineeError } = await supabaseAdmin
      .from('trainees')
      .select('id, notify_on_program_posting')
      .eq('id', traineeId)
      .eq('tenant_id', context.tenantId)
      .single();

    if (traineeError || !trainee) { logger.warn('[NOTIFICATION_PREFS] Trainee not found', { traineeId });
      return notFoundResponse('Trainee not found'); }

    // FIX: Get all 7 channel preferences from dedicated table
    const { data: preferences, error: preferencesError } = await supabaseAdmin
      .from('trainee_notification_preferences')
      .select('*')
      .eq('trainee_id', traineeId)
      .eq('tenant_id', context.tenantId)
      .maybeSingle();

    if (preferencesError) { logger.error('[NOTIFICATION_PREFS] Failed to fetch preferences', { traineeId,
        error: preferencesError, });
      throw preferencesError; }

    // Return merged preferences (channel prefs + legacy field)
    return successResponse(
      {
        ...preferences,
        notify_on_program_posting: trainee.notify_on_program_posting,
      }
    );
  }
);
