/**
 * CMS Error Handler Middleware
 * Provides consistent error handling for all CMS endpoints with tenant context logging
 *
 * Requirements: 2.15, 14.1, 14.2, 14.3, 14.4
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  CMSError,
  TenantMismatchError,
  ValidationError,
  DatabaseError,
  SanitizationError,
  isTenantMismatchError,
  isValidationError,
  isDatabaseError,
  isSanitizationError,
  isCMSError,
} from '@/lib/cms-errors';
import { CMSSecurityLogger } from '@/services/cms-security-logger.service';
import { logger } from '@/utils/logger';
import { errorResponse, validationErrorResponse, forbiddenResponse, serverErrorResponse } from '@/utils/responses';
import { addCorsHeaders } from './cors';

/**
 * Extract tenant context from request
 */
function extractTenantContext(request: NextRequest): {
  tenantId?: string;
  adminId?: string;
} {
  // Try to get from custom header (set by auth middleware)
  const tenantId = request.headers.get('x-tenant-id');
  const adminId = request.headers.get('x-admin-id');

  return { tenantId: tenantId || undefined, adminId: adminId || undefined };
}

/**
 * Format error response with generic message (no internal details)
 * Requirements: Generic error messages to client
 */
function formatErrorResponse(
  error: unknown,
  statusCode: number
): { message: string; details?: Record<string, any> } {
  // For validation errors, include field-level details
  if (isValidationError(error)) {
    return {
      message: 'Validation failed',
      details: error.errors,
    };
  }

  // For tenant mismatch, return generic forbidden message
  if (isTenantMismatchError(error)) {
    return {
      message: 'Forbidden',
    };
  }

  // For sanitization errors, return generic message
  if (isSanitizationError(error)) {
    return {
      message: 'Invalid input format',
    };
  }

  // For database errors, return generic message
  if (isDatabaseError(error)) {
    if (statusCode === 400) {
      return {
        message: 'Operation failed - constraint violation or invalid data',
      };
    }
    return {
      message: 'Database error occurred',
    };
  }

  // For CMS errors, return generic message
  if (isCMSError(error)) {
    return {
      message: 'Operation failed',
    };
  }

  // For other errors, return generic message
  return {
    message: 'An unexpected error occurred',
  };
}

/**
 * Handle CMS error and return appropriate response
 */
export async function handleCMSError(
  error: unknown,
  request: NextRequest
): Promise<NextResponse> {
  const { tenantId, adminId } = extractTenantContext(request);
  const { ipAddress, userAgent } = CMSSecurityLogger.extractRequestContext(request.headers);

  // Handle TenantMismatchError
  if (isTenantMismatchError(error)) {
    const err = error as TenantMismatchError;

    // Log security incident
    await CMSSecurityLogger.logTenantMismatchAttempt(
      (err as any).attemptedTenantId ?? 'unknown',
      err.tenantId ?? tenantId ?? 'unknown',
      err.adminId ?? adminId ?? 'unknown',
      ipAddress,
      userAgent
    );

    logger.warn('[CMS Error Handler] TenantMismatchError', {
      message: err.message,
      requestingTenantId: tenantId,
      attemptedTenantId: (err as any).attemptedTenantId,
      adminId,
      ipAddress,
    });

    const response = forbiddenResponse('Forbidden');
    return addCorsHeaders(response, request.headers.get('origin'));
  }

  // Handle ValidationError
  if (isValidationError(error)) {
    const err = error as ValidationError;

    await CMSSecurityLogger.logValidationError(
      tenantId ?? err.tenantId ?? 'unknown',
      err.errors,
      adminId ?? err.adminId ?? 'unknown',
      'cms_settings',
      ipAddress
    );

    logger.warn('[CMS Error Handler] ValidationError', {
      message: err.message,
      errors: err.errors,
      tenantId,
      adminId,
    });

    const response = validationErrorResponse(err.errors);
    return addCorsHeaders(response, request.headers.get('origin'));
  }

  // Handle SanitizationError
  if (isSanitizationError(error)) {
    const err = error as SanitizationError;

    await CMSSecurityLogger.logSanitizationError(
      tenantId ?? err.tenantId ?? 'unknown',
      err.fieldName || 'unknown',
      err.violationType || 'unknown',
      adminId ?? err.adminId ?? 'unknown',
      ipAddress
    );

    logger.warn('[CMS Error Handler] SanitizationError - POTENTIAL INJECTION ATTEMPT', {
      message: err.message,
      fieldName: err.fieldName,
      violationType: err.violationType,
      tenantId,
      adminId,
      ipAddress,
    });

    const formatted = formatErrorResponse(err, 400);
    const response = errorResponse(formatted.message, 400);
    return addCorsHeaders(response, request.headers.get('origin'));
  }

  // Handle DatabaseError
  if (isDatabaseError(error)) {
    const err = error as DatabaseError;

    await CMSSecurityLogger.logDatabaseError(
      tenantId ?? err.tenantId ?? 'unknown',
      err.originalError || err,
      {
        code: err.code,
        message: err.message,
      },
      adminId ?? err.adminId ?? 'unknown',
      ipAddress
    );

    logger.error('[CMS Error Handler] DatabaseError', {
      message: err.message,
      code: err.code,
      tenantId,
      adminId,
    });

    const formatted = formatErrorResponse(err, err.statusCode);
    const response = errorResponse(formatted.message, err.statusCode);
    return addCorsHeaders(response, request.headers.get('origin'));
  }

  // Handle generic CMS errors
  if (isCMSError(error)) {
    const err = error as CMSError;

    logger.error('[CMS Error Handler] CMSError', {
      message: err.message,
      statusCode: err.statusCode,
      tenantId: err.tenantId || tenantId,
      adminId: err.adminId || adminId,
    });

    const response = errorResponse(
      formatErrorResponse(err, err.statusCode).message,
      err.statusCode
    );
    return addCorsHeaders(response, request.headers.get('origin'));
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    logger.error('[CMS Error Handler] Unhandled Error', {
      message: error.message,
      stack: error.stack,
      tenantId,
      adminId,
    });

    const response = serverErrorResponse('An unexpected error occurred');
    return addCorsHeaders(response, request.headers.get('origin'));
  }

  // Handle unknown error types
  console.error('[CMS Error Handler] Unknown error type:', error);
  logger.error('[CMS Error Handler] Unknown error type', {
    errorType: typeof error,
    tenantId,
    adminId,
  });

  const response = serverErrorResponse('An unexpected error occurred');
  return addCorsHeaders(response, request.headers.get('origin'));
}

/**
 * Wrapper for CMS endpoints to apply error handling
 * Usage: export const GET = withCMSErrorHandler(handler);
 */
export const withCMSErrorHandler = <T>(
  handler: (request: NextRequest, context?: any) => Promise<T>
) => {
  return async (request: NextRequest, context?: any): Promise<T | Response> => {
    const startTime = Date.now();
    const { tenantId, adminId } = extractTenantContext(request);

    try {
      // Log request start
      logger.info('[CMS Request] Starting', {
        method: request.method,
        url: request.url,
        tenantId,
        adminId,
      });

      const result = await handler(request, context);

      // Log successful completion
      const duration = Date.now() - startTime;
      logger.info('[CMS Request] Completed', {
        method: request.method,
        url: request.url,
        tenantId,
        adminId,
        durationMs: duration,
        status: 'success',
      });

      if (result instanceof NextResponse) {
        return addCorsHeaders(result, request.headers.get('origin')) as any;
      }
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Log error and return error response
      logger.error('[CMS Request] Failed', {
        method: request.method,
        url: request.url,
        tenantId,
        adminId,
        durationMs: duration,
        status: 'error',
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      });

      return handleCMSError(error, request);
    }
  };
};

/**
 * Middleware to ensure tenant context is present
 * Usage: await ensureTenantContext(request);
 */
export async function ensureTenantContext(request: NextRequest): Promise<{
  tenantId: string;
  adminId?: string;
}> {
  const { tenantId, adminId } = extractTenantContext(request);

  if (!tenantId) {
    const { ipAddress } = CMSSecurityLogger.extractRequestContext(request.headers);

    logger.warn('[CMS Tenant Context] Missing tenant context', {
      url: request.url,
      adminId,
      ipAddress,
    });

    throw new TenantMismatchError(
      'Missing tenant context in request',
      undefined,
      adminId
    );
  }

  return { tenantId, adminId };
}

/**
 * Middleware to validate request has required authorization
 */
export async function validateCMSAuthorization(
  request: NextRequest
): Promise<void> {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');

  if (!token) {
    throw new TenantMismatchError('Missing authorization token', undefined, undefined);
  }

  // Token validation is typically done by auth middleware
  // This just ensures it's present
}
