import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { hashPassword } from '@/lib/auth';
import { successResponse, errorResponse, noContentResponse } from '@/utils/responses';
import { requireRoleAsync } from '@/middleware/auth';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { z } from 'zod';

// OPTIONS /api/users/[id] - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

const updateUserSchema = z.object({ email: z.string().email().max(255).toLowerCase().trim().optional(),
  username: z.string().min(3).max(100).trim().optional(),
  password: z.string().min(6).max(100).optional(),
  role: z.enum(['local_admin', 'staff_training_coordinator', 'staff_inventory_manager', 'trainee']).optional(), });

/**
 * GET /api/users/[id]
 * Get a single user by ID (local_admin only - from their tenant)
 */
export const GET = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const authResult = await requireRoleAsync(request, ['local_admin']);
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

const { data: foundUser, error } = await supabaseAdmin
  .from('users')
  .select('id, email, username, role, created_at, updated_at')
  .eq('id', id)
  .single();

  if (error || !foundUser) return errorResponse('User not found', 404);

  return successResponse(foundUser); });

/**
 * PUT /api/users/[id]
 * Update a user (local_admin only - users in their tenant)
 */
export const PUT = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const authResult = await requireRoleAsync(request, ['local_admin']);
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

  // Check if user exists
  const { data: existingUser } = await supabaseAdmin
  .from('users')
  .select('id')
  .eq('id', id)
  .single();

  if (!existingUser) return errorResponse('User not found', 404);

  if (validatedData.email) { const { data: emailUser } = await supabaseAdmin
  .from('users')
  .select('id')
  .eq('email', validatedData.email)
  .neq('id', id)
  .single();

  if (emailUser) return errorResponse('Email already in use', 409); }

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

  return successResponse(updatedUser); });

/**
 * DELETE /api/users/[id]
 * Delete a user (local_admin only - users in their tenant)
 */
export const DELETE = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const authResult = await requireRoleAsync(request, ['local_admin']);
  if ('error' in authResult) return authResult.error as NextResponse;

  const authUser = authResult.user;
  const resolvedParams = await params;
  const { id } = resolvedParams;

  // Local admins can only delete users in their tenant

const { data: userTenant } = await supabaseAdmin
  .from('users_tenants')
  .select('user_id')
  .eq('tenant_id', authUser.tenantId)
  .eq('user_id', id)
  .maybeSingle();

  if (!userTenant) { return errorResponse('User not found', 404); }

const { data: existingUser } = await supabaseAdmin
  .from('users')
  .select('id, email')
  .eq('id', id)
  .single();

  if (!existingUser) return errorResponse('User not found', 404);

  if (existingUser.email === 'admin@bmdc.edu.ph') { return errorResponse('Cannot delete the main admin account', 403); }

const { error } = await supabaseAdmin
  .from('users')
  .delete()
  .eq('id', id);

  if (error) throw error;

  // Also remove from users_tenants junction table

await supabaseAdmin
  .from('users_tenants')
  .delete()
  .eq('user_id', id);

  return noContentResponse(); });
