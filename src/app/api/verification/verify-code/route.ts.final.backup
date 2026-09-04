import { NextRequest } from 'next/server';
import { verificationService } from '@/services/verificationService';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { z } from 'zod';

const verifyCodeSchema = z.object({
  email: z.string().email('Invalid email address'),
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

// POST /api/verification/verify-code - Verify OTP code
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  const { email, code } = verifyCodeSchema.parse(body);

  const result = await verificationService.verifyCode({
    email,
    code,
  });

  return successResponse(result);
});
