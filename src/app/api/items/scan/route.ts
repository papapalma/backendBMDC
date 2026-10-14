/**
 * POST /api/items/scan — Scan item by QR code value
 * 
 * Used by the QR scanner to look up items by their generated qr_code value
 * Returns the item if found and user has permission
 */
import { NextRequest, NextResponse } from 'next/server';
import { itemService } from '@/services/itemService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, notFoundResponse, forbiddenResponse, errorResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

export const POST = withErrorHandler(
  async (request: NextRequest) => {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, role, isSuperAdmin } = ctxResult.context;

    const allowedRoles = ['local_admin', 'staff_inventory_manager', 'staff_training_coordinator'];
    if (!allowedRoles.includes(role)) {
      return forbiddenResponse('Insufficient permissions');
    }

    const body = await request.json();
    const { qrCode } = body;

    if (!qrCode || typeof qrCode !== 'string') {
      return errorResponse('qrCode is required and must be a string', 400);
    }

    const context = isSuperAdmin ? null : { tenantId, isSuperAdmin, userId: '', role };
    const item = await itemService.getItemByQRCode(context, qrCode);

    if (!item) {
      return notFoundResponse('Item not found');
    }

    return successResponse(item);
  }
);
