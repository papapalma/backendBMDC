/**
 * POST /api/push-subscriptions  — Register a device push subscription
 * GET  /api/push-subscriptions  — Get all subscriptions for the current user
 *
 * Aligned to the live Supabase `push_subscriptions` JSONB schema:
 *   id, tenant_id, trainee_id, user_id, subscription (jsonb), created_at, updated_at
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, forbiddenResponse, errorResponse, createdResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { resolveTraineeForUser } from '@/lib/resolveTraineeId';
import { parseStoredSubscription } from '@/services/pushService';
import { logger } from '@/utils/logger';
import { z } from 'zod';

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url('Invalid subscription endpoint'),
  keys: z.object({
    auth: z.string().min(1, 'Missing auth key'),
    p256dh: z.string().min(1, 'Missing p256dh key'),
  }),
  deviceIdentifier: z.string().optional(),
  userAgent: z.string().optional(),
});

function formatSubscriptionResponse(row: any) {
  const parsed = parseStoredSubscription(row?.subscription);
  return {
    id: row.id,
    endpoint: parsed?.endpoint || '',
    deviceIdentifier: parsed?.deviceIdentifier || undefined,
    isActive: parsed ? parsed.isActive !== false : false,
    lastUsedAt: parsed?.lastUsedAt || row.updated_at || undefined,
    createdAt: row.created_at,
  };
}

// OPTIONS /api/push-subscriptions
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// POST /api/push-subscriptions - Register or reactivate device subscription
export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role } = ctxResult.context;

  if (!userId) {
    return forbiddenResponse('User context required for push subscriptions');
  }

  try {
    const body = await request.json();
    const validated = pushSubscriptionSchema.parse(body);

    const resolvedTrainee =
      role === 'trainee' ? await resolveTraineeForUser(userId, role) : null;
    const traineeId = resolvedTrainee?.id ?? null;

    // Load user's existing subscriptions to match endpoint idempotently
    const { data: existingRows, error: checkError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, subscription, trainee_id, created_at, updated_at')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId);

    if (checkError) {
      logger.error('[PUSH] Error checking existing subscriptions', { error: checkError, userId });
      return errorResponse('Failed to check subscription', 500);
    }

    const existing = (existingRows || []).find(
      (row: any) => row.subscription?.endpoint === validated.endpoint
    );

    const nowIso = new Date().toISOString();
    const subscriptionJson = {
      endpoint: validated.endpoint,
      keys: {
        auth: validated.keys.auth,
        p256dh: validated.keys.p256dh,
      },
      deviceIdentifier: validated.deviceIdentifier || null,
      userAgent: validated.userAgent || null,
      isActive: true,
      lastUsedAt: nowIso,
    };

    let resultRow;

    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('push_subscriptions')
        .update({
          trainee_id: traineeId ?? existing.trainee_id ?? null,
          subscription: subscriptionJson,
          updated_at: nowIso,
        })
        .eq('id', existing.id)
        .select('id, subscription, created_at, updated_at')
        .single();

      if (error) {
        logger.error('[PUSH] Error updating subscription', { error, userId });
        return errorResponse('Failed to update subscription', 500);
      }

      resultRow = data;
      logger.info('[PUSH] Updated existing subscription', {
        subscriptionId: existing.id,
        userId,
        traineeId,
        tenantId,
      });
    } else {
      const { data, error } = await supabaseAdmin
        .from('push_subscriptions')
        .insert({
          user_id: userId,
          trainee_id: traineeId,
          tenant_id: tenantId,
          subscription: subscriptionJson,
          updated_at: nowIso,
        })
        .select('id, subscription, created_at, updated_at')
        .single();

      if (error) {
        logger.error('[PUSH] Error creating subscription', { error, userId });
        return errorResponse('Failed to register push subscription', 500);
      }

      resultRow = data;
      logger.info('[PUSH] Created new subscription', {
        subscriptionId: data.id,
        userId,
        traineeId,
        tenantId,
        deviceIdentifier: validated.deviceIdentifier,
      });
    }

    return createdResponse(formatSubscriptionResponse(resultRow), 'Push subscription registered');
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues || (error as any).errors || [];
      return errorResponse(`Validation error: ${issues[0]?.message || 'Validation failed'}`, 400);
    }
    throw error;
  }
});

// GET /api/push-subscriptions - Get current user's subscriptions
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId } = ctxResult.context;

  if (!userId) {
    return forbiddenResponse('User context required');
  }

  const { data, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, subscription, created_at, updated_at')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('[PUSH] Error fetching subscriptions', { error, userId });
    return errorResponse('Failed to fetch subscriptions', 500);
  }

  const formatted = (data || []).map(formatSubscriptionResponse);
  return successResponse(formatted, 'Push subscriptions retrieved');
});
