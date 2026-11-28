import { NextRequest, NextResponse } from 'next/server';
import { borrowingSlipService } from '@/services/borrowingSlipService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, forbiddenResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';

// GET /api/borrowing-slips/:id - Get specific borrowing slip
export const GET = withErrorHandler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;
  const slip = await borrowingSlipService.getBorrowingSlipById(context, params.id);

  if (!slip) {
    return new NextResponse(
      JSON.stringify({ success: false, error: 'Borrowing slip not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return successResponse(slip);
});

// PUT /api/borrowing-slips/:id/return - Mark borrowing slip as returned
export const PUT = withErrorHandler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { role } = ctxResult.context;

  // Only staff_inventory_manager and local_admin can mark items as returned
  const allowedRoles = ['local_admin', 'staff_inventory_manager'];
  if (!allowedRoles.includes(role)) {
    return forbiddenResponse('Insufficient permissions to return borrowing slips');
  }

  const body = await request.json();
  const slip = await borrowingSlipService.markAsReturned(ctxResult.context, params.id, body.notes);

  return successResponse(slip, 'Borrowing slip marked as returned');
});

// DELETE /api/borrowing-slips/:id - Delete borrowing slip
export const DELETE = withErrorHandler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { role } = ctxResult.context;

  // Only local_admin can delete slips
  if (role !== 'local_admin') {
    return forbiddenResponse('Insufficient permissions to delete borrowing slips');
  }

  await borrowingSlipService.deleteBorrowingSlip(ctxResult.context, params.id);

  return successResponse(null, 'Borrowing slip deleted successfully');
});
