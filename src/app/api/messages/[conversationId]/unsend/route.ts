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
 * POST /api/messages/[conversationId]/unsend
 * Soft unsend a message within 15 minutes
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
    const { messageId } = body;

    if (!messageId) {
      return corsResponse(errorResponse('messageId is required', 400), request);
    }

    const result = await MessengerService.unsendMessage(conversationId, messageId, userId);
    return corsResponse(successResponse(result), request);
  } catch (error: any) {
    logger.error('Error unsending message', { error });
    const status = error instanceof MessengerError ? error.statusCode : 400;
    return corsResponse(errorResponse(error.message || 'Failed to unsend message', status), request);
  }
}
