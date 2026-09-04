/**
 * Middleware Wrapper: withTenantContext
 *
 * Implements Requirements 14.6 and 14.8:
 *   - 14.6  Middleware wrapper applying tenant context to all authenticated routes
 *   - 14.8  Request logging capturing tenant_id, user_id, endpoint, timestamp
 *
 * This higher-order function wraps a Next.js API route handler and:
 *   1. Extracts and validates the tenant context from the incoming JWT.
 *   2. Logs the request with tenant_id, user_id, endpoint, and timestamp.
 *   3. Injects the resolved TenantContext into the handler so it never needs
 *      to repeat the extraction boilerplate.
 *
 * Usage:
 * ```ts
 * // app/api/programs/route.ts
 * import { withTenantContext } from '@/middleware/withTenantContext';
 *
 * export const GET = withTenantContext(async (request, context) => {
 *   const { tenantId, userId, isSuperAdmin } = context;
 *   // ... tenant-scoped logic
 *   return successResponse(data);
 * });
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractTenantContext, TenantContext } from './tenantContext';
import { logTenantRequest } from '@/lib/tenantUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A Next.js route handler that receives the resolved TenantContext as its
 * second argument.
 */
export type TenantAwareHandler = (
  request: NextRequest,
  context: TenantContext,
  /** Dynamic route params (e.g. { id: '...' } for /api/programs/[id]) */
  params?: Record<string, string>
) => Promise<NextResponse> | NextResponse;

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a route handler with tenant context extraction and request logging.
 *
 * Returns a standard Next.js route handler compatible with the App Router.
 * If the request lacks a valid tenant context the wrapper returns 403
 * immediately without invoking the inner handler.
 *
 * @param handler - The route handler to protect.
 *
 * @example
 * ```ts
 * export const GET = withTenantContext(async (req, ctx) => {
 *   return successResponse({ tenantId: ctx.tenantId });
 * });
 *
 * // With dynamic route params:
 * export const GET = withTenantContext(async (req, ctx, params) => {
 *   const { id } = params!;
 *   return successResponse({ id, tenantId: ctx.tenantId });
 * }, { params: Promise<{ id: string }> });
 * ```
 */
export function withTenantContext(handler: TenantAwareHandler) {
  return async function tenantContextWrapper(
    request: NextRequest,
    routeContext?: { params?: Record<string, string> | Promise<Record<string, string>> }
  ): Promise<NextResponse> {
    // ── 1. Extract tenant context ──────────────────────────────────────────

const result = extractTenantContext(request);

    if (result.error) {
      // 403 already constructed by extractTenantContext

return result.error as NextResponse;
    }

const tenantContext = result.context!;

    // ── 2. Log the request (Req 14.8) ─────────────────────────────────────

const endpoint = request.nextUrl?.pathname ?? request.url;
    logTenantRequest(tenantContext, request.method, endpoint);

    // ── 3. Resolve dynamic route params if present ────────────────────────

let params: Record<string, string> | undefined;
    if (routeContext?.params) {
      // Next.js 15 makes params a Promise; support both sync and async forms.
      params =
        routeContext.params instanceof Promise
          ? await routeContext.params
          : routeContext.params;
    }

    // ── 4. Delegate to the inner handler ──────────────────────────────────

return handler(request, tenantContext, params);
  };
}
