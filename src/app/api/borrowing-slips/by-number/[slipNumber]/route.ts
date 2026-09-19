import { NextRequest, NextResponse } from 'next/server';
import { borrowingSlipService } from '@/services/borrowingSlipService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';

// GET /api/borrowing-slips/by-number/:slipNumber - Get borrowing slip by slip number
export const GET = withErrorHandler(async (request: NextRequest, { params }: { params: { slipNumber: string } }) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;
  const slip = await borrowingSlipService.getBorrowingSlipByNumber(context, params.slipNumber);

  if (!slip) {
    return new NextResponse(
      JSON.stringify({ success: false, error: 'Borrowing slip not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return successResponse(slip);
});
