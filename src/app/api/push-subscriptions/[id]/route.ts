/**
 * DELETE /api/push-subscriptions/[id]  — Unregister a push subscription
 *
 * Allows users to unsubscribe a device from push notifications.
 * Can be called when user revokes notification permissions or uninstalls the PWA.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, forbiddenResponse, errorResponse, notFoundResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

// OPTIONS /api/push-subscriptions/[id]
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// DELETE /api/push-subscriptions/[id] - Unsubscribe
export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { userId, tenantId } = ctxResult.context;
  const { id } = await params;

  if (!userId) {
    return forbiddenResponse('User context required');
  }

  try {
    // Verify subscription belongs to current user before deleting
    const { data: subscription, error: checkError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      logger.error('[PUSH] Error checking subscription ownership', { error: checkError, id });
      return errorResponse('Failed to verify subscription', 500);
    }

    if (!subscription) {
      return notFoundResponse('Subscription not found or does not belong to you');
    }

    // Delete the subscription
    const { error: deleteError } = await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('id', id);

    if (deleteError) {
      logger.error('[PUSH] Error deleting subscription', { error: deleteError, id });
      return errorResponse('Failed to delete subscription', 500);
    }

    logger.info('[PUSH] Subscription deleted', {
      subscriptionId: id,
      userId,
      tenantId,
    });

    return successResponse({ id }, 'Push subscription unregistered');
  } catch (error) {
    throw error;
  }
});
