import { NextRequest } from 'next/server';
import { verificationService } from '@/services/verificationService';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { z } from 'zod';

const sendCodeSchema = z.object({
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  method: z.enum(['email', 'whatsapp', 'both']),
  firstName: z.string().optional(),
});

// POST /api/verification/send-code - Send verification code
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  const { email, phone, method, firstName } = sendCodeSchema.parse(body);

  const result = await verificationService.sendVerificationCode({
    email,
    phone,
    method,
    firstName,
  });

  return successResponse(result);
});
