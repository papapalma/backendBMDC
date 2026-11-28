/**
 * GET /api/notifications/stream
 *
 * Authenticated Server-Sent Events (SSE) stream delivering real-time
 * `review_alert` and `review_resolved` events scoped strictly to the
 * requesting staff/admin's tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleOptionsRequest, addCorsHeaders } from '@/middleware/cors';
import { verifyToken, extractTokenFromCookie } from '@/lib/auth/jwt';
import { verifySupabaseAccessToken, resolveAppUserFromSupabaseIdentity } from '@/lib/supabase-auth';
import { getAuthConfigCached } from '@/lib/config';
import {
  reviewAlertEvents,
  REVIEW_ALERT_ALLOWED_ROLES,
  type ReviewAlertStreamEvent,
  type ReviewResolvedStreamEvent,
} from '@/services/reviewAlertService';

export function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenFromQuery = searchParams.get('token');
  const authHeader = request.headers.get('authorization');
  const cookieToken = extractTokenFromCookie(request.headers.get('cookie'));
  const token =
    tokenFromQuery ||
    (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null) ||
    cookieToken;

  if (!token) {
    return new Response('Unauthorized: Token missing', { status: 401 });
  }

  let userId: string | null = null;
  let role: string | null = null;
  let tenantId: string | null = null;
  const config = getAuthConfigCached();

  if (config.supabaseJwtVerification) {
    const identity = await verifySupabaseAccessToken(token);
    if (identity) {
      const appUser = await resolveAppUserFromSupabaseIdentity(identity);
      if (appUser) {
        userId = appUser.id;
        role = appUser.role;
        tenantId = appUser.tenantId ?? null;
      }
    }
  }

  if (!userId) {
    const payload = verifyToken(token);
    if (payload) {
      userId = payload.userId;
      role = payload.role;
      tenantId = payload.tenantId ?? null;
    }
  }

  if (!userId || !role) {
    return new Response('Unauthorized: Invalid token', { status: 401 });
  }

  if (!(REVIEW_ALERT_ALLOWED_ROLES as readonly string[]).includes(role)) {
    return new Response('Forbidden: Staff review role required', { status: 403 });
  }

  const isSuperAdmin = role === 'super_admin';
  const currentTenantId = tenantId;
  const encoder = new TextEncoder();
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
        reviewAlertEvents.off('review_alert', onReviewAlert);
        reviewAlertEvents.off('review_resolved', onReviewResolved);
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

      const matchesTenant = (eventTenantId: string) =>
        isSuperAdmin || (Boolean(currentTenantId) && eventTenantId === currentTenantId);

      const onReviewAlert = (evt: ReviewAlertStreamEvent) => {
        if (!matchesTenant(evt.tenantId)) return;
        safeEnqueue(`event: review_alert\ndata: ${JSON.stringify(evt.alert)}\n\n`);
      };

      const onReviewResolved = (evt: ReviewResolvedStreamEvent) => {
        if (!matchesTenant(evt.tenantId)) return;
        safeEnqueue(`event: review_resolved\ndata: ${JSON.stringify(evt)}\n\n`);
      };

      safeEnqueue(`event: connected\ndata: ${JSON.stringify({ userId, tenantId: currentTenantId })}\n\n`);

      reviewAlertEvents.on('review_alert', onReviewAlert);
      reviewAlertEvents.on('review_resolved', onReviewResolved);

      heartbeatInterval = setInterval(() => {
        safeEnqueue(': heartbeat\n\n');
      }, 20000);

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
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });

  return origin ? addCorsHeaders(response, origin) : response;
}
