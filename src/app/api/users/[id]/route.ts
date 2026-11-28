import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { hashPassword } from '@/lib/auth';
import { isMissingDeletedAtColumnError, markUserSoftDeleted } from '@/lib/userSoftDelete';
import { authRecoveryService } from '@/services/authRecoveryService';
import { activityLogService } from '@/services/activityLogService';
import { successResponse, errorResponse, noContentResponse } from '@/utils/responses';
import { requireRoleAsync } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { logger } from '@/utils/logger';
import { z } from 'zod';

// OPTIONS /api/users/[id] - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

const updateUserSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim().optional(),
  username: z.string().min(3).max(100).trim().optional(),
  password: z.string().min(6).max(100).optional(),
  role: z.enum(['local_admin', 'staff_training_coordinator', 'staff_inventory_manager', 'trainee']).optional(),
});

/**
 * GET /api/users/[id]
 * Get a single user by ID (local_admin only - from their tenant)
 */
export const GET = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const authResult = await requireRoleAsync(request, ['local_admin']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const user = authResult.user;
  const resolvedParams = await params;
  const { id } = resolvedParams;

  // Local admins can only access users in their tenant

  const { data: userTenant } = await supabaseAdmin
    .from('users_tenants')
    .select('user_id')
    .eq('tenant_id', user.tenantId)
    .eq('user_id', id)
    .maybeSingle();

  if (!userTenant) { return errorResponse('User not found', 404); }

  let { data: foundUser, error } = await supabaseAdmin
    .from('users')
    .select('id, email, username, role, created_at, updated_at')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error && isMissingDeletedAtColumnError(error)) {
    const fallback = await supabaseAdmin
      .from('users')
      .select('id, email, username, role, created_at, updated_at')
      .eq('id', id)
      .single();
    foundUser = fallback.data;
    error = fallback.error;
  }

  if (error || !foundUser) return errorResponse('User not found', 404);

  return successResponse(foundUser);
});

/**
 * PUT /api/users/[id]
 * Update a user (local_admin only - users in their tenant)
 */
export const PUT = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const authResult = await requireRoleAsync(request, ['local_admin']);
  if ('error' in authResult) return authResult.error as NextResponse;


  const authUser = authResult.user;
  const resolvedParams = await params;
  const { id } = resolvedParams;
  const body = await request.json();
  const validatedData = updateUserSchema.parse(body);

  // Local admins can only update users in their tenant

  const { data: userTenant } = await supabaseAdmin
    .from('users_tenants')
    .select('user_id')
    .eq('tenant_id', authUser.tenantId)
    .eq('user_id', id)
    .maybeSingle();

  if (!userTenant) { return errorResponse('User not found', 404); }

  // Check if active user exists
  let { data: existingUser, error: existingErr } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (existingErr && isMissingDeletedAtColumnError(existingErr)) {
    const fallback = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', id)
      .single();
    existingUser = fallback.data;
  }

  if (!existingUser) return errorResponse('User not found', 404);

  if (validatedData.email) {
    let { data: emailUser, error: emailErr } = await supabaseAdmin
      .from('users')
      .select('id')
      .ilike('email', validatedData.email)
      .neq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (emailErr && isMissingDeletedAtColumnError(emailErr)) {
      const fallback = await supabaseAdmin
        .from('users')
        .select('id')
        .ilike('email', validatedData.email)
        .neq('id', id)
        .maybeSingle();
      emailUser = fallback.data;
    }

    if (emailUser) return errorResponse('Email already in use', 409);
  }

  if (validatedData.username) {
    let { data: usernameUser, error: usernameErr } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('username', validatedData.username)
      .neq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (usernameErr && isMissingDeletedAtColumnError(usernameErr)) {
      const fallback = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('username', validatedData.username)
        .neq('id', id)
        .maybeSingle();
      usernameUser = fallback.data;
    }

    if (usernameUser) return errorResponse('Username already in use', 409);
  }

  const updateData: any = {};
  if (validatedData.email) updateData.email = validatedData.email;
  if (validatedData.username) updateData.username = validatedData.username;
  if (validatedData.role) updateData.role = validatedData.role;
  if (validatedData.password) { updateData.password_hash = await hashPassword(validatedData.password); }

  const { data: updatedUser, error } = await supabaseAdmin
    .from('users')
    .update(updateData)
    .eq('id', id)
    .select('id, email, username, role, created_at, updated_at')
    .single();

  if (error) throw error;

  return successResponse(updatedUser);
});

/**
 * DELETE /api/users/[id]
 * Soft-delete (archive) a user (local_admin only - users in their tenant)
 */
export const DELETE = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const authResult = await requireRoleAsync(request, ['local_admin']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const authUser = authResult.user;
  const resolvedParams = await params;
  const { id } = resolvedParams;

  if (id === authUser.userId) {
    return errorResponse('Cannot delete your own account', 403);
  }

  // Local admins can only archive users in their tenant
  const { data: userTenant } = await supabaseAdmin
    .from('users_tenants')
    .select('user_id')
    .eq('tenant_id', authUser.tenantId)
    .eq('user_id', id)
    .maybeSingle();

  if (!userTenant) {
    return errorResponse('User not found', 404);
  }

  const { data: existingUser, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('id, email, username, role, deleted_at')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    if (isMissingDeletedAtColumnError(fetchError)) {
      return errorResponse(
        'User soft-delete migration (017-user-soft-delete) has not been applied yet. Run the SQL migration in Supabase before archiving users.',
        503
      );
    }
    throw fetchError;
  }

  if (!existingUser || existingUser.deleted_at) {
    return errorResponse('User not found', 404);
  }

  if (existingUser.email === 'admin@bmdc.edu.ph' || existingUser.role === 'super_admin') {
    return errorResponse('Cannot delete the main admin account', 403);
  }

  const deletedAt = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ deleted_at: deletedAt })
    .eq('id', id)
    .is('deleted_at', null);

  if (updateError) {
    if (isMissingDeletedAtColumnError(updateError)) {
      return errorResponse(
        'User soft-delete migration (017-user-soft-delete) has not been applied yet. Run the SQL migration in Supabase before archiving users.',
        503
      );
    }
    throw updateError;
  }

  // Instant session cutoff: mark inactive in memory and revoke all refresh tokens
  markUserSoftDeleted(id);
  try {
    await authRecoveryService.revokeAllRefreshTokensForUser(id);
  } catch (revokeErr) {
    logger.warn('[USERS_DELETE] Failed to revoke refresh tokens after soft-delete', {
      userId: id,
      error: revokeErr instanceof Error ? revokeErr.message : String(revokeErr),
    });
  }

  try {
    await activityLogService.logAction(
      authUser.userId,
      'delete',
      'user',
      id,
      {
        softDelete: true,
        targetEmail: existingUser.email,
        targetUsername: existingUser.username,
        targetRole: existingUser.role,
      },
      request,
      authUser.tenantId
    );
  } catch (logErr) {
    logger.warn('[USERS_DELETE] Failed to log user soft-delete action', {
      userId: id,
      error: logErr instanceof Error ? logErr.message : String(logErr),
    });
  }

  return noContentResponse();
});
