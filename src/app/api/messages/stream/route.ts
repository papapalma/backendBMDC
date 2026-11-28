import { NextRequest, NextResponse } from 'next/server';
import { handleOptionsRequest, addCorsHeaders } from '@/middleware/cors';
import { verifyToken } from '@/lib/auth';
import { verifySupabaseAccessToken, resolveAppUserFromSupabaseIdentity } from '@/lib/supabase-auth';
import { getAuthConfigCached } from '@/lib/config';
import { messengerEvents } from '@/services/messengerService';

export function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * GET /api/messages/stream
 * Server-Sent Events (SSE) real-time feed for active user
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenFromQuery = searchParams.get('token');
  const authHeader = request.headers.get('authorization');
  const token = tokenFromQuery || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

  if (!token) {
    return new Response('Unauthorized: Token missing', { status: 401 });
  }

  let userId: string | null = null;
  const config = getAuthConfigCached();

  if (config.supabaseJwtVerification) {
    const identity = await verifySupabaseAccessToken(token);
    if (identity) {
      const appUser = await resolveAppUserFromSupabaseIdentity(identity);
      if (appUser) userId = appUser.id;
    }
  }

  if (!userId) {
    const payload = verifyToken(token);
    if (payload) userId = payload.userId;
  }

  if (!userId) {
    return new Response('Unauthorized: Invalid token', { status: 401 });
  }

  const encoder = new TextEncoder();
  const currentUserId = userId;
  let cleanupRef: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        messengerEvents.off('new_message', onNewMessage);
        messengerEvents.off('message_unsend', onMessageUnsend);
      };
      cleanupRef = cleanup;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      // Send initial connection event
      safeEnqueue(`event: connected\ndata: {"userId": "${currentUserId}"}\n\n`);

      // Handle new message event scoped to conversation recipients
      const onNewMessage = (data: { conversationId: string; message: any; recipients: string[] }) => {
        if (Array.isArray(data.recipients) && data.recipients.includes(currentUserId)) {
          safeEnqueue(`event: new_message\ndata: ${JSON.stringify(data)}\n\n`);
        }
      };

      // Handle unsend event scoped strictly to conversation recipients
      const onMessageUnsend = (data: { conversationId: string; messageId: string; recipients?: string[] }) => {
        if (Array.isArray(data.recipients) && data.recipients.includes(currentUserId)) {
          safeEnqueue(
            `event: message_unsend\ndata: ${JSON.stringify({
              conversationId: data.conversationId,
              messageId: data.messageId,
            })}\n\n`
          );
        }
      };

      messengerEvents.on('new_message', onNewMessage);
      messengerEvents.on('message_unsend', onMessageUnsend);

      // Keep-alive heartbeat every 20 seconds
      heartbeatInterval = setInterval(() => {
        safeEnqueue(': heartbeat\n\n');
      }, 20000);

      // Cleanup when client disconnects
      request.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      cleanupRef?.();
    },
  });

  const origin = request.headers.get('origin');
  const response = new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });

  return origin ? addCorsHeaders(response, origin) : response;
}
