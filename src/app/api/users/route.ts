import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { fetchAllRows } from '@/lib/supabasePagination';
import { hashPassword } from '@/lib/auth';
import { isMissingDeletedAtColumnError } from '@/lib/userSoftDelete';
import { successResponse, createdResponse, errorResponse } from '@/utils/responses';
import { requireRoleAsync } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { z } from 'zod';

// OPTIONS /api/users - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

const createUserSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  username: z.string().min(3).max(100).trim(),
  password: z.string().min(6).max(100),
  role: z.enum(['local_admin', 'staff_training_coordinator', 'staff_inventory_manager']).default('staff_inventory_manager'),
});

/**
 * GET /api/users
 * Get all users in the tenant (local_admin only)
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const user = authResult.user;
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const role = searchParams.get('role');

  // Single-query inner join + pagination avoids PostgREST `.in()` URL overflow on 500+ tenant users
  const buildUsersQuery = (filterSoftDeleted: boolean) => {
    let userQuery = supabaseAdmin
      .from('users')
      .select('id, email, username, role, created_at, updated_at, users_tenants!inner(tenant_id)')
      .eq('users_tenants.tenant_id', user.tenantId)
      .not('role', 'eq', 'super_admin')
      .order('created_at', { ascending: false });

    if (filterSoftDeleted) {
      userQuery = userQuery.is('deleted_at', null);
    }

    if (search) {
      userQuery = userQuery.or(`email.ilike.%${search}%,username.ilike.%${search}%`);
    }

    if (role) {
      userQuery = userQuery.eq('role', role);
    }

    return userQuery;
  };

  let rows: any[];
  try {
    rows = await fetchAllRows<any>(() => buildUsersQuery(true));
  } catch (err) {
    if (isMissingDeletedAtColumnError(err)) {
      rows = await fetchAllRows<any>(() => buildUsersQuery(false));
    } else {
      throw err;
    }
  }

  const seen = new Set<string>();
  const users = rows
    .filter((row) => {
      if (!row?.id || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map(({ users_tenants: _ut, ...rest }) => rest);

  return successResponse(users);
});

/**
 * POST /api/users
 * Create a new user (local_admin only - within their tenant)
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const user = authResult.user;
  const body = await request.json();
  const validatedData = createUserSchema.parse(body);

  // Check if an active user already exists with this email or username
  let { data: existingUser, error: existingEmailErr } = await supabaseAdmin
    .from('users')
    .select('id')
    .ilike('email', validatedData.email)
    .is('deleted_at', null)
    .maybeSingle();

  if (existingEmailErr && isMissingDeletedAtColumnError(existingEmailErr)) {
    const fallback = await supabaseAdmin
      .from('users')
      .select('id')
      .ilike('email', validatedData.email)
      .maybeSingle();
    existingUser = fallback.data;
  }

  if (existingUser) {
    return errorResponse('User with this email already exists', 409);
  }

  let { data: existingUsername, error: existingUsernameErr } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('username', validatedData.username)
    .is('deleted_at', null)
    .maybeSingle();

  if (existingUsernameErr && isMissingDeletedAtColumnError(existingUsernameErr)) {
    const fallback = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('username', validatedData.username)
      .maybeSingle();
    existingUsername = fallback.data;
  }

  if (existingUsername) {
    return errorResponse('Username is already in use', 409);
  }

const passwordHash = await hashPassword(validatedData.password);

  const { data: newUser, error } = await supabaseAdmin
  .from('users')
  .insert({
  email: validatedData.email,
  username: validatedData.username,
  password_hash: passwordHash,
  role: validatedData.role,
  })
  .select('id, email, username, role, created_at, updated_at')
  .single();

  if (error) throw error;

  // Assign user to the local admin's tenant via users_tenants junction table

const { error: tenantLinkError } = await supabaseAdmin
  .from('users_tenants')
  .insert({
  user_id: newUser.id,
  tenant_id: user.tenantId,
  is_primary: false,
  });

  if (tenantLinkError) throw tenantLinkError;

  return createdResponse(newUser);
});

