# CMS Authentication Middleware Guide

## Overview

The CMS Authentication Middleware (`cmsAuth.ts`) provides JWT verification and admin role validation for all CMS endpoints. It implements strict tenant isolation for landing page customizations (Requirements 2.1, 2.11, 12.1, 12.2, 12.3).

## Requirements Implemented

- **Requirement 2.1**: Extract tenant_id from authenticated user context
- **Requirement 2.11**: Extract tenant_id from JWT token and pass to data layer queries
- **Requirement 12.1**: Deny access to non-admin users
- **Requirement 12.2**: Display customization interface for authorized admins
- **Requirement 12.3**: Reject unauthorized API calls with 403 Forbidden

## Features

- ✅ JWT extraction from Authorization header or cookies
- ✅ Token verification and expiration checking
- ✅ Tenant context validation (tenant_id presence)
- ✅ Admin ID validation (userId presence)
- ✅ Admin role validation (admin or superadmin only)
- ✅ Comprehensive logging
- ✅ 401 Unauthorized for missing/invalid tokens
- ✅ 403 Forbidden for missing tenant context or insufficient roles
- ✅ Type-safe TypeScript interfaces

## CMSTenantContext

```typescript
interface CMSTenantContext {
  tenantId: string;        // UUID of the tenant
  adminId: string;         // UUID of the authenticated admin
  adminRole: string;       // Role (admin, superadmin, etc.)
  authenticated: boolean;  // Always true when context exists
}
```

## Usage Patterns

### Pattern 1: Using `withCMSAuth` Wrapper (Recommended)

```typescript
import { NextRequest } from 'next/server';
import { withCMSAuth } from '@/middleware/cmsAuth';
import { successResponse } from '@/utils/responses';
import { CMSSettingsService } from '@/services/cms/CMSSettingsService';

const cmsService = new CMSSettingsService();

export const POST = withCMSAuth(async (request, context) => {
  const { tenantId, adminId, adminRole } = context;

  try {
    const customizations = await request.json();

    // Validate and save customizations
    const result = await cmsService.upsertSettings(
      tenantId,
      customizations,
      adminId
    );

    return successResponse(result);
  } catch (error) {
    console.error('[CMS] Error saving settings:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to save settings' }),
      { status: 500 }
    );
  }
});
```

### Pattern 2: Using `requireCMSAuth` Inline

```typescript
import { NextRequest } from 'next/server';
import { requireCMSAuth } from '@/middleware/cmsAuth';
import { successResponse } from '@/utils/responses';

export async function GET(request: NextRequest) {
  const authResult = requireCMSAuth(request);
  if (authResult.error) return authResult.error;

  const { tenantId, adminId, adminRole } = authResult.context!;

  // ... tenant-scoped logic using tenantId
  return successResponse({});
}
```

### Pattern 3: Using `extractCMSAuth` for Advanced Cases

```typescript
import { extractCMSAuth } from '@/middleware/cmsAuth';

export async function POST(request: NextRequest) {
  const result = extractCMSAuth(request);

  if (result.error) {
    return result.error;
  }

  const context = result.context!;

  // ... proceed with CMS operation
}
```

## Token Format

JWT tokens must include the following claims:

```typescript
{
  userId: string;        // Admin's user ID
  tenantId: string;      // Tenant ID
  email: string;         // Admin's email
  role: string;          // Must be 'admin', 'local_admin', 'super_admin', or 'superadmin'
  jti: string;           // JWT ID for revocation tracking
  iat?: number;          // Issued at timestamp
  exp?: number;          // Expiration timestamp
}
```

### Authorized Roles

The following roles are authorized to access CMS endpoints:

- `admin` ✅
- `local_admin` ✅
- `super_admin` ✅
- `superadmin` ✅

Any other role will receive a 403 Forbidden response.

## Error Responses

### 401 Unauthorized

Returned when:
- No token provided (Authorization header or cookie)
- Token is invalid or expired

```json
{
  "error": "No authentication token provided"
}
```

or

```json
{
  "error": "Invalid or expired token"
}
```

### 403 Forbidden

Returned when:
- tenant_id missing from token claims
- userId/adminId missing from token claims
- User role is not admin or superadmin

```json
{
  "error": "Missing tenant context: tenantId not in token"
}
```

or

```json
{
  "error": "Admin access required: insufficient role"
}
```

## Token Extraction Priority

The middleware extracts tokens in the following order:

1. **Authorization Header**: `Authorization: Bearer <token>`
2. **Cookie**: `auth_token=<token>`

The first available token is used; the other sources are ignored.

## Logging

The middleware logs:

- **Success**: DEBUG level logs when context is resolved
  ```
  [CMS_AUTH] Context resolved {tenantId, adminId, adminRole}
  ```

- **Warnings**: WARN level logs for failed authentication
  ```
  [CMS_AUTH] No JWT found in request
  [CMS_AUTH] JWT verification failed (invalid signature or expired)
  [CMS_AUTH] JWT payload missing tenantId
  [CMS_AUTH] Insufficient admin role
  ```

All logs include request URL and method for debugging.

## Tenant Isolation Guarantees

Every CMS endpoint wrapped with this middleware:

1. ✅ Validates tenant_id from JWT token
2. ✅ Rejects requests without valid tenant context
3. ✅ Passes tenant context to service/data layers
4. ✅ Prevents cross-tenant data access
5. ✅ Logs all access attempts (successful and failed)

**Data layer services MUST filter all queries by tenant_id**:

```typescript
// ✅ CORRECT - includes tenant_id filter
const settings = await db
  .from('cms_settings')
  .select('*')
  .eq('tenant_id', tenantId);

// ❌ WRONG - missing tenant_id filter
const settings = await db
  .from('cms_settings')
  .select('*');
```

## Examples

### Complete CMS Endpoint Example

```typescript
// app/api/cms-settings/route.ts
import { NextRequest } from 'next/server';
import { withCMSAuth } from '@/middleware/cmsAuth';
import { successResponse } from '@/utils/responses';
import { CMSSettingsService } from '@/services/cms/CMSSettingsService';
import { AuditLogService } from '@/services/cms/AuditLogService';

const cmsService = new CMSSettingsService();
const auditService = new AuditLogService();

export const POST = withCMSAuth(async (request, context) => {
  const { tenantId, adminId, adminRole } = context;

  try {
    const body = await request.json();

    // Validate input
    const validationErrors = cmsService.validateSettings(body);
    if (validationErrors.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Validation failed', details: validationErrors }),
        { status: 400 }
      );
    }

    // Save with tenant isolation
    const result = await cmsService.upsertSettings(
      tenantId,  // ← Tenant context from middleware
      body,
      adminId    // ← Admin context from middleware
    );

    // Audit log
    await auditService.logAction(
      tenantId,
      adminId,
      'update',
      'cms_settings',
      null,
      { action: 'customization_saved' }
    );

    return successResponse(result);
  } catch (error) {
    console.error('[CMS POST] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to save settings' }),
      { status: 500 }
    );
  }
});
```

### Testing CMS Endpoints

```typescript
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

function createMockRequest(token?: string): NextRequest {
  const headers = new Map<string, string>();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  return {
    headers,
    url: 'http://localhost:3000/api/cms-settings',
    method: 'POST',
  } as unknown as NextRequest;
}

function generateTestToken(payload: any): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
}

// Test: Valid admin request
const validToken = generateTestToken({
  userId: 'admin-123',
  tenantId: 'tenant-456',
  email: 'admin@example.com',
  role: 'local_admin',
  jti: 'test-jti-1',
});

const request = createMockRequest(validToken);
// Request will pass auth checks ✅

// Test: Non-admin request
const traineeToken = generateTestToken({
  userId: 'trainee-789',
  tenantId: 'tenant-456',
  email: 'trainee@example.com',
  role: 'trainee',
  jti: 'test-jti-2',
});

const traineeRequest = createMockRequest(traineeToken);
// Request will be rejected with 403 ❌
```

## Integration with Services

When passing context to services, always pass both `tenantId` and `adminId`:

```typescript
// Services should always accept tenantId as first parameter
class CMSSettingsService {
  async upsertSettings(
    tenantId: string,  // ← From middleware
    settings: any,
    adminId: string    // ← From middleware
  ): Promise<CMSSettings> {
    // Query includes tenant_id filter
    return await db
      .from('cms_settings')
      .upsert({ tenant_id: tenantId, settings_data: settings, updated_by_admin_id: adminId })
      .eq('tenant_id', tenantId);
  }
}
```

## Troubleshooting

### "No authentication token provided" (401)

**Cause**: No JWT found in Authorization header or cookie

**Solution**:
- Add Authorization header: `Authorization: Bearer <token>`
- Or set httpOnly cookie: `auth_token=<token>`
- Verify token is not malformed

### "Invalid or expired token" (401)

**Cause**: Token verification failed (invalid signature or expired)

**Solution**:
- Regenerate token with correct JWT_SECRET
- Check JWT expiration time
- Verify JWT_SECRET environment variable is correct

### "Missing tenant context: tenantId not in token" (403)

**Cause**: JWT token missing tenantId claim

**Solution**:
- Ensure JWT payload includes tenantId
- Example: `{ userId, tenantId, email, role, jti }`

### "Admin access required: insufficient role" (403)

**Cause**: User role is not admin or superadmin

**Solution**:
- Verify user has admin role in database
- Check JWT payload includes correct role
- Authorized roles: `admin`, `local_admin`, `super_admin`, `superadmin`

## API Endpoints Using This Middleware

All CMS endpoints should use this middleware:

- `POST /api/cms-settings` - Save customizations
- `GET /api/cms-settings/versions` - Get version history
- `POST /api/cms-settings/versions/:id/rollback` - Rollback to version
- `POST /api/cms-settings/export` - Export settings
- `POST /api/cms-settings/import` - Import settings
- `GET /api/cms-settings/audit-log` - Get audit trail
- `GET /api/theme-presets` - List presets
- `POST /api/theme-presets/:id/apply` - Apply preset

## Testing Checklist

- [ ] Valid JWT with admin role → 200 OK
- [ ] Valid JWT with superadmin role → 200 OK
- [ ] Valid JWT with trainee role → 403 Forbidden
- [ ] Missing token → 401 Unauthorized
- [ ] Invalid token → 401 Unauthorized
- [ ] Expired token → 401 Unauthorized
- [ ] Missing tenantId in token → 403 Forbidden
- [ ] Missing userId in token → 403 Forbidden
- [ ] Token from Authorization header used first → ✅
- [ ] Token from cookie used as fallback → ✅
- [ ] All debug logs include correct metadata → ✅
- [ ] All warning logs include context → ✅
