/**
 * POST /api/auth/login
 *
 * Multi-tenant login endpoint.
 *
 * Implements Requirements 6.1, 6.2, 6.6, 6.7:
 *   - 6.1  Verify credentials against the users table
 *   - 6.2  Determine the user's tenant association after authentication
 *   - 6.6  Support multi-tenant login (users belonging to multiple tenants)
 *   - 6.7  Prompt for tenant selection when user belongs to multiple tenants
 *
 * Flow:
 *   1. Validate request body (email + password).
 *   2. Look up user by email in the users table.
 *   3. Verify password hash.
 *   4. Query users_tenants junction table for tenant associations.
 *   5a. Single tenant  → generate tenant-scoped JWT, set cookie, return user data.
 *   5b. Multiple tenants → issue a short-lived selection token, return tenant list
 *       so the client can display a tenant picker (no cookie set yet).
 *   5c. No tenants → return 403 (account not associated with any active tenant).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { comparePassword, generateToken } from '@/lib/auth';
import { loginSchema } from '@/utils/validators';
import { unauthorizedResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';
import { checkRateLimit, getRateLimitKey } from '@/utils/rateLimit';
import { authRecoveryService } from '@/services/authRecoveryService';
import { generateCsrfToken } from '@/lib/security/csrf';
import {
  getUserTenants,
  issueTenantSelectionToken,
  generateTenantScopedToken,
} from '@/services/multiTenantAuthService';

// OPTIONS /api/auth/login — Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  // ────────────────────────────────────────────────────────────────────────
  // Rate limiting: Stricter limits to prevent brute force attacks
  // - Overall limit: 5 failed attempts per IP per 15 minutes
  // - Per-email limit: 3 attempts per email per 15 minutes  
  // ────────────────────────────────────────────────────────────────────────
  
  const ipKey = getRateLimitKey(request, 'login_ip');
  const rlResponse = checkRateLimit(ipKey, {
    limit: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
  });
  if (rlResponse) return rlResponse as NextResponse;

  const body = await request.json();
  const validatedData = loginSchema.parse(body);

  // Per-email rate limiting to prevent user enumeration
  const emailKey = `login_email:${validatedData.email}`;
  const emailRlResponse = checkRateLimit(emailKey, {
    limit: 3,
    windowMs: 15 * 60 * 1000, // 15 minutes
  });
  if (emailRlResponse) return emailRlResponse as NextResponse;

  // ── Step 1: Find user by email ──────────────────────────────────────────

const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, email, username, role, password_hash')
    .eq('email', validatedData.email)
    .single();

  if (error || !user) {
    // Generic message — do not reveal whether email exists (Req 6.9)
    // Rate limit already applied above

return unauthorizedResponse('Invalid email or password');
  }

  // ── Step 1.5: Check if account is locked (Task 16) ─────────────────────

  const isLocked = await authRecoveryService.isAccountLocked(user.id);
  if (isLocked) {
    const lockedUntil = await authRecoveryService.getLockedUntil(user.id);
    const retryAfterSeconds = lockedUntil 
      ? Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)
      : 0;
    
    const response = new NextResponse(
      JSON.stringify({
        success: false,
        error: 'Account temporarily locked due to too many failed login attempts. Please try again later.',
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSeconds),
        },
      }
    );
    
    // Log the lockout attempt
    await activityLogService.logAction(user.id, 'login_failed_account_locked', 'user', user.id, undefined, undefined, undefined);
    
    return response;
  }

  // ── Step 2: Verify password ─────────────────────────────────────────────

const isPasswordValid = await comparePassword(
    validatedData.password,
    user.password_hash
  );

  if (!isPasswordValid) {
    // Track failed attempt
    await authRecoveryService.trackFailedLoginAttempt(user.id);
    
    // Task 20.1: Log the failed login with context (IP, user agent, timestamp)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('x-real-ip') || undefined;
    const userAgent = request.headers.get('user-agent') || undefined;
    
    await activityLogService.logAction(
      user.id,
      'login_failed',
      'user',
      user.id,
      {
        reason: 'invalid_credentials',
        email: validatedData.email,
        timestamp: new Date().toISOString(),
        ip,
        userAgent,
      },
      request,
      undefined // No tenant association yet on failed login
    );

    return unauthorizedResponse('Invalid email or password');
  }

  // Password is valid — reset failed attempts
  await authRecoveryService.resetFailedLoginAttempts(user.id);

  // ── Step 3: Determine tenant associations (Req 6.2) ─────────────────────

const tenants = await getUserTenants(user.id);

  // ── Step 4: Handle no-tenant case ───────────────────────────────────────

if (tenants.length === 0) {
    // Super admins may not have a tenant association — handle separately.
    // For all other roles, deny access if no active tenant is found.

if (user.role === 'super_admin') {
      // Super admins use a platform-wide sentinel tenant ID so the JWT
      // payload always carries a tenantId field (design requirement).

const SUPER_ADMIN_TENANT_ID = 'platform';
      const token = generateTenantScopedToken(
        user.id,
        user.email,
        user.role,
        SUPER_ADMIN_TENANT_ID
      );

      return buildLoginResponse(request, user, token, SUPER_ADMIN_TENANT_ID, null);
    }

    return forbiddenResponse(
      'Your account is not associated with any active tenant. Please contact your administrator.'
    );
  }

  // ── Step 5a: Single tenant — complete login immediately (Req 6.2) ───────

if (tenants.length === 1) {
    const tenant = tenants[0];
    const token = generateTenantScopedToken(
      user.id,
      user.email,
      user.role,
      tenant.id
    );

    return buildLoginResponse(request, user, token, tenant.id, tenant.name);
  }

  // ── Step 5b: Multiple tenants — prompt for selection (Req 6.6, 6.7) ────

const selectionToken = issueTenantSelectionToken(
    user.id,
    user.email,
    user.role,
    tenants
  );

  // Generate CSRF token for this user session (Task 14.3)
  const csrfToken = generateCsrfToken(user.id);

  // Log the partial authentication event
  // For tenant selection, use null/undefined as tenantId since no specific tenant is selected yet

await activityLogService.logAction(user.id, 'login_tenant_selection_required', 'user', user.id, undefined, undefined, undefined);

  const response = NextResponse.json({
    success: true,
    data: {
      requires_tenant_selection: true,
      selection_token: selectionToken,
      tenants: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        is_primary: t.is_primary,
      })),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    },
    message: 'Please select a tenant to continue',
  });

  // Set CSRF token in response header (Task 14.3)
  response.headers.set('X-CSRF-Token', csrfToken);

  return response;
});

// ---------------------------------------------------------------------------
// Helper: build the final authenticated response (tokens in session storage only)
// ---------------------------------------------------------------------------

async function buildLoginResponse(
  request: NextRequest,
  user: { id: string; email: string; username: string; role: string },
  token: string,
  tenantId: string,
  tenantName: string | null
): Promise<NextResponse> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    undefined;
  const userAgent = request.headers.get('user-agent') || undefined;

  // Issue refresh token (returned in response body, stored in session storage on frontend)
  const refresh = await authRecoveryService.issueRefreshToken(user.id, { ip, userAgent });

  // Generate CSRF token for this user session (Task 14.3)
  const csrfToken = generateCsrfToken(user.id);

  // Task 20.1: Log successful login with full context
  await activityLogService.logAction(
    user.id,
    'login',
    'user',
    user.id,
    {
      email: user.email,
      role: user.role,
      tenantId: tenantId === 'platform' ? 'platform' : tenantId,
      timestamp: new Date().toISOString(),
      ip,
      userAgent,
      status: 'success',
    },
    request,
    tenantId === 'platform' ? undefined : tenantId
  );

  const response = NextResponse.json({
    success: true,
    data: {
      token,
      refreshToken: refresh.token,  // Return refresh token in body for session storage
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tenantId,
        ...(tenantName ? { tenantName } : {}),
      },
    },
    message: 'Login successful',
  });

  // Set CSRF token in response header (Task 14.3)
  response.headers.set('X-CSRF-Token', csrfToken);

  // NOTE: NO COOKIES SET - All tokens are returned in response body for session storage
  // Frontend should store token and refreshToken in sessionStorage, not cookies

  return response;
}
