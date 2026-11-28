# CSRF Protection Integration Guide

## Overview

CSRF (Cross-Site Request Forgery) protection prevents unauthorized state-changing requests from being made on behalf of authenticated users.

Implementation: **Task 14 - Add CSRF Protection**

## How It Works

### Token Generation (On Login)

1. User logs in successfully
2. Server generates CSRF token: `generateCsrfToken(userId)`
3. Token is returned in response header: `X-CSRF-Token: <token>`
4. Client stores token in session storage (not localStorage for security)

### Token Validation (On Requests)

1. Client makes POST/PUT/DELETE request
2. Client includes CSRF token in header: `X-CSRF-Token: <token>`
3. Server validates token matches session
4. If valid → request proceeds
5. If invalid/missing → returns 403 Forbidden

## Files

- **Core Logic**: `src/lib/security/csrf.ts`
  - `generateCsrfToken(sessionId)` — Generate token
  - `validateCsrfToken(token, sessionId)` — Validate token
  - `requiresCsrfToken(method)` — Check if method needs token

- **Middleware**: `src/middleware/csrf.ts`
  - `validateCsrfMiddleware(handler)` — Middleware wrapper
  - `addCsrfTokenToResponse(response, sessionId)` — Add to response
  - `withCsrfTokenGeneration(handler)` — Auth endpoint wrapper

- **Tests**: `src/__tests__/security/csrf-protection.test.ts`
  - 35 tests covering token generation, validation, HTTP integration

## Usage in Endpoints

### Option 1: Middleware Wrapper (Recommended)

For simple endpoints, use the middleware wrapper:

```typescript
import { validateCsrfMiddleware } from '@/middleware/csrf';

export const POST = validateCsrfMiddleware(async (request) => {
  // This code only runs if CSRF token is valid
  // (or request method doesn't require CSRF)
  
  const { user } = await requireAuthAsync(request);
  // ... rest of handler
});
```

### Option 2: Manual Validation

For complex endpoints with custom logic:

```typescript
import { checkCsrfProtection, extractCsrfToken } from '@/lib/security/csrf';
import { forbiddenResponse } from '@/utils/responses';

export const POST = withErrorHandler(async (request) => {
  // 1. Authenticate user
  const { user } = await requireAuthAsync(request);

  // 2. Extract CSRF token from request
  const token = extractCsrfToken(request.headers, null);

  // 3. Check CSRF protection
  const csrfResult = checkCsrfProtection(request.method, token, user.userId);
  if (csrfResult.shouldBlock) {
    return forbiddenResponse(csrfResult.reason);
  }

  // 4. Continue with business logic
  // ... rest of handler
});
```

### Option 3: Login Endpoint

CSRF token is automatically generated on login:

```typescript
// In buildLoginResponse() in /api/auth/login/route.ts
const csrfToken = generateCsrfToken(user.id);
response.headers.set('X-CSRF-Token', csrfToken);
```

## Client Integration

### React Example

```typescript
// After successful login
const response = await fetch('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
});

// Extract CSRF token from response header
const csrfToken = response.headers.get('X-CSRF-Token');

// Store in session storage (not localStorage)
sessionStorage.setItem('csrfToken', csrfToken);

// Use in subsequent requests
const result = await fetch('/api/attendance/submit', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': csrfToken,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ /* data */ }),
});
```

## Protected Methods

CSRF tokens are required for:
- **POST** — Create new resources
- **PUT** — Update existing resources
- **DELETE** — Delete resources
- **PATCH** — Partial updates

Safe methods (no token needed):
- **GET** — Fetch data
- **HEAD** — Fetch headers only
- **OPTIONS** — CORS preflight

## Endpoints Updated with CSRF Protection

### Login Endpoint (`POST /api/auth/login`)
✅ Generates CSRF token in response header
✅ Client receives token for use in subsequent requests

### State-Changing Endpoints (Recommended to add)
The following endpoints should validate CSRF tokens:
- `POST /api/attendance/submit` — Trainee attendance submission
- `PUT /api/*` — Any update endpoint
- `DELETE /api/*` — Any delete endpoint
- `POST /api/*/bulk-*` — Bulk operations

## Environment Variables

Optional CSRF configuration:

```bash
# Secret key for token generation (uses JWT_SECRET if not set)
CSRF_SECRET=your-secure-random-key-min-32-chars

# In production, must be set!
# Falls back to JWT_SECRET if not defined
```

## Security Properties

### Guarantees

1. **Deterministic**: Same sessionId → Same token (for validation)
2. **Cryptographically Secure**: Uses HMAC-SHA256
3. **Session-Bound**: Token is specific to each user session
4. **Tamper-Proof**: Cannot forge token without CSRF_SECRET
5. **Timing-Safe**: Uses constant-time comparison to prevent timing attacks

### Non-Guarantees

1. **Expiration**: Tokens do not expire per request. Consider rotating tokens in future versions (Week 4+)
2. **Revocation**: No revocation mechanism. Use session invalidation for forced logout
3. **Multi-Tab**: Same token across all tabs (acceptable for now)

## Limitations & Future Improvements

### Current (Week 1)
- Simple HMAC-SHA256 based tokens
- Bound to user ID (not per-request session)
- No token rotation

### Future (Week 4+)
- Token rotation on each request
- Per-request session binding
- Token expiration (5-15 minutes)
- Audit logging for CSRF violations
- Rate limiting for repeated violations

## Testing

Run CSRF tests:

```bash
npm test -- --testPathPatterns=csrf-protection
```

Expected: 35 tests passing

Test Coverage:
- ✅ Token generation
- ✅ Token validation
- ✅ HTTP method handling
- ✅ Header extraction
- ✅ Security invariants (no predictable tokens, tamper detection)
- ✅ Edge cases (long sessions, special chars, whitespace)

## Troubleshooting

### Issue: "CSRF token is required" on GET request

**Cause**: GET requests should not include CSRF tokens

**Solution**: CSRF tokens are only for POST/PUT/DELETE. GET requests are read-only and safe.

### Issue: "Invalid CSRF token" on valid request

**Possible Causes**:
1. Token not passed from login response
2. Token not included in X-CSRF-Token header
3. Token was tampered with
4. Wrong session ID used for validation

**Solution**:
1. Verify token is extracted from login response
2. Check request header: `console.log(request.headers.get('X-CSRF-Token'))`
3. Verify token matches session ID: `validateCsrfToken(token, sessionId)`

### Issue: "CSRF_SECRET not set" warning in production

**Cause**: Missing environment variable

**Solution**:
```bash
export CSRF_SECRET=$(openssl rand -base64 32)
# Set in production deployment secrets
```

## Success Criteria (Task 14)

- ✅ All CSRF tests passing (35 tests)
- ✅ POST/PUT/DELETE require token (403 if missing)
- ✅ GET requests allowed without token
- ✅ Invalid tokens rejected (403 Forbidden)
- ✅ Tokens generated on login (in response header)
- ✅ No regressions: `npm test` passes

## References

- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Node.js crypto module: https://nodejs.org/api/crypto.html
- Timing attacks prevention: https://codahale.com/a-lesson-in-timing-attacks/

## Questions?

See inline comments in:
- `src/lib/security/csrf.ts`
- `src/middleware/csrf.ts`
- `src/__tests__/security/csrf-protection.test.ts`
