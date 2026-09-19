import { NextRequest } from 'next/server';
import { verificationService } from '@/services/verificationService';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { z } from 'zod';

const checkStatusSchema = z.object({
  email: z.string().email('Invalid email address'),
});

// POST /api/verification/check-status - Check if email is verified
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  const { email } = checkStatusSchema.parse(body);

  const isVerified = await verificationService.isEmailVerified(email);

  return successResponse({
    email,
    isVerified,
  });
});
