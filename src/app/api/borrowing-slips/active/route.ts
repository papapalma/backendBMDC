import { NextRequest, NextResponse } from 'next/server';
import { borrowingSlipService } from '@/services/borrowingSlipService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';

// GET /api/borrowing-slips/active - Get all active borrowing slips
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;
  const slips = await borrowingSlipService.getActiveBorrowingSlips(context);

  return successResponse(slips);
});
