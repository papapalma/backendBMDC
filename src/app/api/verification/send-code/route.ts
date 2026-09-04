import { NextRequest } from 'next/server';
import { verificationService } from '@/services/verificationService';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { checkRateLimit, getRateLimitKey } from '@/utils/rateLimit';
import { z } from 'zod';

const sendCodeSchema = z.object({
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  method: z.enum(['email', 'whatsapp', 'both']),
  firstName: z.string().optional(),
  registrationContext: z.boolean().optional(),
});

// POST /api/verification/send-code - Send verification code
// Rate limit: 5 attempts per email per 1 minute (prevents enumeration/spam)

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  console.log('[VERIFICATION] Request body:', JSON.stringify(body, null, 2));
  
  const { email, phone, method, firstName, registrationContext } = sendCodeSchema.parse(body);
  console.log('[VERIFICATION] Parsed params:', { email, phone, method, firstName, registrationContext });

  // Rate limiting by email (public endpoint - prevent enumeration/spam)
  const normalizedEmail = email.toLowerCase();
  const rlResponse = checkRateLimit(`send-code:${normalizedEmail}`, {
    limit: 5,
    windowMs: 60 * 1000, // 1 minute
  });
  if (rlResponse) return rlResponse;

  const result = await verificationService.sendVerificationCode({
    email,
    phone,
    method,
    firstName,
    registrationContext: registrationContext || false,
  });

  console.log('[VERIFICATION] Result:', JSON.stringify(result, null, 2));
  return successResponse(result);
});
