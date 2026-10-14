import { NextRequest } from 'next/server';
import { verificationService } from '@/services/verificationService';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { checkRateLimit, getRateLimitKey } from '@/utils/rateLimit';
import { z } from 'zod';

const verifyCodeSchema = z.object({
  email: z.string().email('Invalid email address'),
  code: z.string().length(6, 'Verification code must be 6 digits'),
});

// POST /api/verification/verify-code - Verify OTP code
// Rate limit: 10 attempts per email per 5 minutes (prevents brute force)

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  const { email, code } = verifyCodeSchema.parse(body);

  // Rate limiting by email (public endpoint - prevent brute force)
  const normalizedEmail = email.toLowerCase();
  const rlResponse = checkRateLimit(`verify-code:${normalizedEmail}`, {
    limit: 10,
    windowMs: 5 * 60 * 1000, // 5 minutes
  });
  if (rlResponse) return rlResponse;

  const result = await verificationService.verifyCode({
    email,
    code,
  });

  return successResponse(result);
});
