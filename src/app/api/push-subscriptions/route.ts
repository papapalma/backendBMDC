/**
 * POST /api/push-subscriptions  — Register a device push subscription
 * GET  /api/push-subscriptions  — Get all subscriptions for the current user
 *
 * Web Push Notification Subscriptions API
 * 
 * Allows PWA users to register their device push subscription with the backend.
 * The backend stores the subscription endpoint and cryptographic keys needed
 * to send encrypted push notifications to the user's device.
 *
 * Implements Requirement 12.6: Push notification subscriptions are scoped to
 * the requesting user and tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, forbiddenResponse, errorResponse, createdResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';
import { z } from 'zod';

// Validation schemas
const pushSubscriptionSchema = z.object({
  endpoint: z.string().url('Invalid subscription endpoint'),
  keys: z.object({
    auth: z.string().min(1, 'Missing auth key'),
    p256dh: z.string().min(1, 'Missing p256dh key'),
  }),
  deviceIdentifier: z.string().optional(),
  userAgent: z.string().optional(),
});

type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

// OPTIONS /api/push-subscriptions
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// POST /api/push-subscriptions - Register device subscription
export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId } = ctxResult.context;

  if (!userId) {
    return forbiddenResponse('User context required for push subscriptions');
  }

  try {
    const body = await request.json();
    const validated = pushSubscriptionSchema.parse(body);

    // Check if subscription already exists for this endpoint
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('endpoint', validated.endpoint)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      logger.error('[PUSH] Error checking existing subscription', { error: checkError });
      return errorResponse('Failed to check subscription', 500);
    }

    let result;

    if (existing) {
      // Update existing subscription (mark as active again)
      const { data, error } = await supabaseAdmin
        .from('push_subscriptions')
        .update({
          is_active: true,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          user_agent: validated.userAgent || null,
          device_identifier: validated.deviceIdentifier || null,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        logger.error('[PUSH] Error updating subscription', { error, userId });
        return errorResponse('Failed to update subscription', 500);
      }

      result = data;
      logger.info('[PUSH] Updated existing subscription', {
        subscriptionId: existing.id,
        userId,
        tenantId,
      });
    } else {
      // Create new subscription
      const { data, error } = await supabaseAdmin
        .from('push_subscriptions')
        .insert({
          user_id: userId,
          tenant_id: tenantId,
          endpoint: validated.endpoint,
          auth_secret: validated.keys.auth,
          p256dh_key: validated.keys.p256dh,
          device_identifier: validated.deviceIdentifier || null,
          user_agent: validated.userAgent || null,
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        logger.error('[PUSH] Error creating subscription', { error, userId });
        return errorResponse('Failed to register push subscription', 500);
      }

      result = data;
      logger.info('[PUSH] Created new subscription', {
        subscriptionId: data.id,
        userId,
        tenantId,
        deviceIdentifier: validated.deviceIdentifier,
      });
    }

    return createdResponse(result, 'Push subscription registered');
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(`Validation error: ${error.errors[0].message}`, 400);
    }
    throw error;
  }
});

// GET /api/push-subscriptions - Get user's subscriptions
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId } = ctxResult.context;

  if (!userId) {
    return forbiddenResponse('User context required');
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, device_identifier, is_active, last_used_at, created_at')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('[PUSH] Error fetching subscriptions', { error, userId });
      return errorResponse('Failed to fetch subscriptions', 500);
    }

    return successResponse(data, 'Push subscriptions retrieved');
  } catch (error) {
    throw error;
  }
});
