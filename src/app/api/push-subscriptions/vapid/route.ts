/**
 * GET /api/push-subscriptions/vapid  — Get VAPID public key
 *
 * Returns the public VAPID key needed by the frontend to create
 * push subscriptions. This endpoint is public (no authentication required)
 * since VAPID public keys are meant to be publicly available.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getVapidPublicKey } from '@/services/pushService';
import { successResponse, errorResponse } from '@/utils/responses';
import { handleOptionsRequest } from '@/middleware/cors';
import { logger } from '@/utils/logger';

// OPTIONS /api/push-subscriptions/vapid
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/push-subscriptions/vapid - Get VAPID public key
export async function GET(request: NextRequest) {
  try {
    const vapidKey = getVapidPublicKey();

    if (!vapidKey) {
      logger.warn('[PUSH] VAPID public key not configured');
      return errorResponse('Push notifications not configured on server', 503);
    }

    return successResponse(
      { vapidKey },
      'VAPID public key retrieved'
    );
  } catch (error) {
    logger.error('[PUSH] Error retrieving VAPID key', { error });
    return errorResponse('Failed to retrieve VAPID key', 500);
  }
}
