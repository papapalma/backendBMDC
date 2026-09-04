/**
 * GET  /api/items/:id  — get item by ID (tenant-scoped, Req 8.2, 8.3, 8.8)
 * PUT  /api/items/:id  — update item (tenant-scoped, Req 8.4)
 * DELETE /api/items/:id  — delete item (tenant-scoped, Req 8.8)
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 17.5, 17.6
 */
import { NextRequest, NextResponse } from 'next/server';
import { itemService } from '@/services/itemService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { updateItemSchema } from '@/utils/validators';
import { successResponse, notFoundResponse, noContentResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { activityLogService } from '@/services/activityLogService';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/items/:id - Handle CORS preflight

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/items/:id - Get item by ID (tenant-scoped, Req 8.2, 8.3, 8.8)

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role, isSuperAdmin } = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_inventory_manager', 'staff_training_coordinator'];
  if (!allowedRoles.includes(role)) { return forbiddenResponse('Insufficient permissions'); }

const { id } = await params;
  const context = isSuperAdmin ? null : { tenantId, isSuperAdmin, userId: '', role };
  const item = await itemService.getItemById(context, id);

  if (!item) { return notFoundResponse('Item not found'); }

  return successResponse(item); }
);

// PUT /api/items/:id - Update item (tenant-scoped, Req 8.4)

export const PUT = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_inventory_manager'];
  if (!allowedRoles.includes(role)) { return forbiddenResponse('Insufficient permissions to update items'); }

const { id } = await params;

  // Verify the item belongs to this tenant before updating (Req 8.8)

const context = isSuperAdmin ? null : { tenantId, isSuperAdmin, userId, role };
  const existing = await itemService.getItemById(context, id);
  if (!existing) { return notFoundResponse('Item not found'); }

const body = await request.json();
  const validatedData = updateItemSchema.parse(body);

  const item = await itemService.updateItem(id, validatedData);

  await activityLogService.logAction(userId, 'update', 'item', id, { name: validatedData.name }, undefined, tenantId);

  return successResponse(item, 'Item updated successfully'); }
);

// DELETE /api/items/:id - Delete item (tenant-scoped, Req 8.8)

export const DELETE = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  const adminRoles = ['local_admin', 'super_admin'];
  if (!adminRoles.includes(role)) { return forbiddenResponse('Insufficient permissions to delete items'); }

const { id } = await params;

  // Verify the item belongs to this tenant before deleting (Req 8.8)

const context = isSuperAdmin ? null : { tenantId, isSuperAdmin, userId, role };
  const existing = await itemService.getItemById(context, id);
  if (!existing) { return notFoundResponse('Item not found'); }

  await itemService.deleteItem(id);

  await activityLogService.logAction(userId, 'delete', 'item', id, undefined, undefined, tenantId);

  return noContentResponse(); }
);
