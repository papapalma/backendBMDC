import { NextRequest } from 'next/server';
import { handleOptionsRequest, corsResponse } from '@/middleware/cors';
import { requireAuthAsync } from '@/middleware/auth';
import { MessengerService } from '@/services/messengerService';
import { logger } from '@/utils/logger';
import { errorResponse, successResponse } from '@/utils/responses';

export function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * GET /api/messages/contacts
 * Get list of available users to start a conversation with
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthAsync(request);
    if ('error' in auth) {
      return corsResponse(auth.error, request);
    }

    const { userId, tenantId, role } = auth.user;
    const contacts = await MessengerService.getAvailableContacts(userId, tenantId, role);

    return corsResponse(successResponse(contacts), request);
  } catch (error: any) {
    logger.error('Error fetching messenger contacts', { error });
    return corsResponse(errorResponse(error.message || 'Failed to fetch contacts', 500), request);
  }
}
