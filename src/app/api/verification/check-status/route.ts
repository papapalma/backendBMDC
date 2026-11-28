import { NextRequest } from 'next/server';
import { verificationService } from '@/services/verificationService';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { checkRateLimit, getRateLimitKey } from '@/utils/rateLimit';
import { z } from 'zod';

const checkStatusSchema = z.object({
  email: z.string().email('Invalid email address'),
});

// POST /api/verification/check-status - Check if email is verified
// Rate limit: 30 requests per email per 1 minute (prevents enumeration)

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  const { email } = checkStatusSchema.parse(body);

  // Rate limiting by email (public endpoint - prevent enumeration)
  const normalizedEmail = email.toLowerCase();
  const rlResponse = checkRateLimit(`check-status:${normalizedEmail}`, {
    limit: 30,
    windowMs: 60 * 1000, // 1 minute
  });
  if (rlResponse) return rlResponse;

  const isVerified = await verificationService.isEmailVerified(email);

  return successResponse({
    email,
    isVerified,
  });
});
