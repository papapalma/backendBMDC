import { NextRequest, NextResponse } from 'next/server';
import { borrowingSlipService } from '@/services/borrowingSlipService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { forbiddenResponse, successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/borrowing-slips - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/borrowing-slips - Get all borrowing slips (tenant-scoped)
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;
  const { searchParams } = new URL(request.url);

  const status = searchParams.get('status') || undefined;
  const borrower_name = searchParams.get('borrower_name') || undefined;
  const item_id = searchParams.get('item_id') || undefined;
  const lending_id = searchParams.get('lending_id') || undefined;
  const start_date = searchParams.get('start_date') || undefined;
  const end_date = searchParams.get('end_date') || undefined;

  const slips = await borrowingSlipService.getAllBorrowingSlips(context, {
    status,
    borrower_name,
    item_id,
    lending_id,
    start_date,
    end_date,
  });

  return successResponse(slips);
});

// POST /api/borrowing-slips - Create new borrowing slip
export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role } = ctxResult.context;

  // Only staff_inventory_manager and local_admin can create slips
  const allowedRoles = ['local_admin', 'staff_inventory_manager'];
  if (!allowedRoles.includes(role)) {
    return forbiddenResponse('Insufficient permissions to create borrowing slips');
  }

  const body = await request.json();

  // Validate required fields
  if (!body.lending_id || !body.item_id || !body.borrower_name || !body.item_name || !body.due_date) {
    return new NextResponse(
      JSON.stringify({
        success: false,
        error: 'Missing required fields: lending_id, item_id, borrower_name, item_name, due_date',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const slip = await borrowingSlipService.createBorrowingSlip(body, userId, tenantId);

  return successResponse(slip, 'Borrowing slip created successfully', 201);
});
