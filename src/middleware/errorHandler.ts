import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { DatabaseError } from '@/lib/db';
import { logger } from '@/utils/logger';
import { errorResponse, serverErrorResponse, validationErrorResponse } from '@/utils/responses';
import { addCorsHeaders } from './cors';

export const handleError = (error: unknown, request: NextRequest) => {
  logger.error('Request error:', error);
  // Always dump to console so the real cause is visible in the server terminal
  console.error('❌ Full error details:', JSON.stringify(error, null, 2));

  // Zod validation errors

if (error instanceof ZodError) {
    const errors: Record<string, string[]> = {};
    error.errors.forEach((err: any) => {
      const path = err.path.join('.');
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push(err.message);
    });
    console.error('❌ Validation errors:', errors);
    return validationErrorResponse(errors);
  }

  // Database errors

if (error instanceof DatabaseError) {
    logger.error('Database error:', error);
    console.error(`❌ DatabaseError [${error.code ?? 'unknown'}]: ${error.message}`);
    return errorResponse(`Database error: ${error.message}`, 400);
  }

  // Supabase PostgrestError (plain object with code/message/details) — NOT always an Error instance

if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const pgErr = error as { code: string; message: string; details?: string; hint?: string };
    console.error(`❌ Supabase error [${pgErr.code}]: ${pgErr.message} | details: ${pgErr.details ?? '-'} | hint: ${pgErr.hint ?? '-'}`);
    return errorResponse(`Database error: ${pgErr.message}`, 400);
  }

  // Standard errors — log the real message but return a generic one (SEC-15)
  if (error instanceof Error) {
    logger.error('Unhandled error:', error);
    // Surface validation-like messages that are safe to show to the caller
    const safeMessagePatterns = [
      /^A \w+ with this email already exists$/,
      /^No valid fields to update$/,
      /^File .+$/,
      /^Category .+$/,
      /^An account with this email already exists\..+$/,
      /^A registration request with this email is already pending review\.$/,
      /^This username is already taken\..+$/,
      /^This username is already pending approval for another registration\.$/,
      /^Registration not found$/,
      /^Registration is already .+$/,
      /^Cannot approve registration: .+$/,
      /^Trainee not found with this QR code$/,
      /^Session not found$/,
      /^Trainee is not enrolled in this program$/,
      /^No active attendance schedule found/,
      /^Attendance window is currently closed$/,
      /^Today is a non-attendance day$/,
      /^An override for .+ already exists on this schedule$/,
      /^Email verification is only available for trainee accounts$/,
      /^Your account is already verified\. Please log in$/,
      /^Failed to find existing trainee.+$/,
      /^Existing trainee not found.+$/,
      /^Associated user account not found.+$/,
      /^Trainee is already enrolled in this program$/,
      /^Failed to create enrollment.+$/,
    ];
    const isSafe = safeMessagePatterns.some(p => p.test(error.message));
    return errorResponse(isSafe ? error.message : 'An unexpected error occurred', 400);
  }

  // Unknown errors
  console.error('❌ Unknown error type:', typeof error, error);
  return serverErrorResponse('An unexpected error occurred');
};

export const withErrorHandler = <T>(
  handler: (request: NextRequest, context?: any) => Promise<T>
) => {
  return async (request: NextRequest, context?: any): Promise<T | Response> => {
    const origin = request.headers.get('origin');
    const startTime = Date.now();
    
    try {
      const result = await handler(request, context);
      
      // Log successful request
      const duration = Date.now() - startTime;
      logger.info('[REQUEST_OBSERVABILITY] Request completed', {
        method: request.method,
        url: request.url,
        durationMs: duration,
        status: 'success',
      });
      
      // Add CORS headers to every successful response
      if (result instanceof NextResponse) {
        return addCorsHeaders(result, origin) as any;
      }
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('[REQUEST_OBSERVABILITY] Request failed', {
        method: request.method,
        url: request.url,
        durationMs: duration,
        status: 'error',
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });
      
      const errResp = handleError(error, request);
      return addCorsHeaders(errResp, origin);
    }
  };
};
