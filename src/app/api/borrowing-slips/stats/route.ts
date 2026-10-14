import { NextRequest, NextResponse } from 'next/server';
import { borrowingSlipService } from '@/services/borrowingSlipService';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';

// GET /api/borrowing-slips/stats - Get borrowing slip statistics
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;
  const stats = await borrowingSlipService.getBorrowingSlipStats(context);

  return successResponse(stats);
});
