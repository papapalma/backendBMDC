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
 * GET /api/messages/[conversationId]
 * Get messages and details for a specific conversation
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const auth = await requireAuthAsync(request);
    if ('error' in auth) {
      return corsResponse(auth.error, request);
    }

    const { conversationId } = await params;
    const { userId } = auth.user;

    const { conversation, messages } = await MessengerService.getConversationWithMessages(
      conversationId,
      userId
    );

    return corsResponse(
      successResponse({
        conversation,
        messages,
      }),
      request
    );
  } catch (error: any) {
    logger.error('Error fetching conversation messages', { error });
    const status = error instanceof MessengerError ? error.statusCode : 500;
    return corsResponse(errorResponse(error.message || 'Failed to fetch messages', status), request);
  }
}

/**
 * POST /api/messages/[conversationId]
 * Send a new message into this conversation
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const auth = await requireAuthAsync(request);
    if ('error' in auth) {
      return corsResponse(auth.error, request);
    }

    const { conversationId } = await params;
    const { userId } = auth.user;
    const body = await request.json();
    const { content, attachment } = body;

    if (!content && !attachment) {
      return corsResponse(errorResponse('Message content or attachment is required', 400), request);
    }

    const message = await MessengerService.sendMessage(
      conversationId,
      userId,
      content || '',
      attachment
    );

    return corsResponse(successResponse(message), request);
  } catch (error: any) {
    logger.error('Error sending message', { error });
    const status = error instanceof MessengerError ? error.statusCode : 500;
    return corsResponse(errorResponse(error.message || 'Failed to send message', status), request);
  }
}
