import { NextRequest } from 'next/server';
import { handleOptionsRequest, corsResponse } from '@/middleware/cors';
import { requireAuthAsync } from '@/middleware/auth';
import { MessengerService, MessengerError } from '@/services/messengerService';
import { logger } from '@/utils/logger';
import { errorResponse, successResponse } from '@/utils/responses';

export function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * GET /api/messages
 * List all active conversations for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthAsync(request);
    if ('error' in auth) {
      return corsResponse(auth.error, request);
    }

    const { userId, tenantId, role } = auth.user;
    const { searchParams } = new URL(request.url);
    const forceSync = searchParams.get('sync') === '1';
    const conversations = await MessengerService.listUserConversations(userId, tenantId, role, {
      forceSync,
    });

    return corsResponse(successResponse(conversations), request);
  } catch (error: any) {
    logger.error('Error fetching conversations', { error });
    return corsResponse(errorResponse(error.message || 'Failed to fetch conversations', 500), request);
  }
}

/**
 * POST /api/messages
 * Create or get direct conversation
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthAsync(request);
    if ('error' in auth) {
      return corsResponse(auth.error, request);
    }

    const { userId, tenantId, role } = auth.user;
    const body = await request.json();
    const { recipientId } = body;

    if (!recipientId) {
      return corsResponse(errorResponse('recipientId is required', 400), request);
    }

    const conversationId = await MessengerService.getOrCreateDirectConversation(
      userId,
      recipientId,
      tenantId,
      role
    );
    const details = await MessengerService.getConversationDetails(conversationId, userId);

    return corsResponse(successResponse({ conversationId, conversation: details }), request);
  } catch (error: any) {
    logger.error('Error creating direct conversation', { error });
    const status = error instanceof MessengerError ? error.statusCode : 500;
    return corsResponse(errorResponse(error.message || 'Failed to create conversation', status), request);
  }
}
