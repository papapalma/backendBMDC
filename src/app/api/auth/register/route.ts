import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { hashPassword, generateToken } from '@/lib/auth';
import { registerSchema } from '@/utils/validators';
import { requireRoleAsync } from '@/middleware/auth';
import { createdResponse, errorResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';
import { checkRateLimit, getRateLimitKey } from '@/utils/rateLimit';

// OPTIONS /api/auth/register - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  // Rate limit: 20 registrations per IP per hour (SEC-6)

const rlResponse = checkRateLimit(getRateLimitKey(request, 'register'), { limit: 20, windowMs: 60 * 60 * 1000 });
  if (rlResponse) return rlResponse as NextResponse;

  // Only admins can create new staff/admin accounts

const authResult = await requireRoleAsync(request, ['local_admin', 'super_admin']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const body = await request.json();
  const validatedData = registerSchema.parse(body);
  
  // Property 3.3: Enforce tenant authorization - admin can only register users in their own tenant
  const adminTenantId = authResult.user.tenantId;
  const requestedTenantId = (validatedData as any).tenantId || adminTenantId;
  if (requestedTenantId && adminTenantId && requestedTenantId !== adminTenantId) {
    return forbiddenResponse('You are not authorized to register users in other tenants');
  }
  
  // Check if an active user already exists
  const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', validatedData.email)
    .is('deleted_at', null)
    .maybeSingle();
  
  if (existingUser) {
    return errorResponse('User with this email already exists', 409);
  }
  
  // Hash password

const passwordHash = await hashPassword(validatedData.password);
  
  // Create user

const { data: user, error } = await supabaseAdmin
    .from('users')
    .insert({
      email: validatedData.email,
      username: validatedData.username,
      password_hash: passwordHash,
      role: validatedData.role ?? 'staff_inventory_manager',
      tenant_id: adminTenantId, // Property 3.5: Assign to admin's tenant
    })
    .select()
    .single();
  
  if (error) {
    throw error;
  }
  
  // Generate token

const token = generateToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });
  
  // Log activity

await activityLogService.logAction(
    user.id,
    'register',
    'user',
    user.id
  );
  
  return createdResponse({
    token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tenantId: user.tenant_id, // Property 3.5: Include tenantId in response
    },
  }, 'User registered successfully');
});
