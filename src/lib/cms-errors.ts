/**
 * Custom Error Classes for CMS System
 * Includes TenantMismatchError, ValidationError, DatabaseError, and SanitizationError
 * All errors support tenant context for audit logging
 */

/**
 * Base error class for all CMS errors
 */
export class CMSError extends Error {
  public readonly tenantId?: string;
  public readonly adminId?: string;
  public readonly statusCode: number;

  constructor(
    message: string,
    statusCode: number = 500,
    tenantId?: string,
    adminId?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.tenantId = tenantId;
    this.adminId = adminId;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, CMSError.prototype);
  }
}

/**
 * TenantMismatchError: Thrown when cross-tenant access is attempted
 * HTTP Status: 403 Forbidden
 *
 * Requirements: 2.15, 2.5
 */
export class TenantMismatchError extends CMSError {
  constructor(
    message: string = 'Tenant mismatch: unauthorized access',
    tenantId?: string,
    adminId?: string,
    attemptedTenantId?: string
  ) {
    super(message, 403, tenantId, adminId);
    this.name = 'TenantMismatchError';

    // Additional context for security logging
    (this as any).attemptedTenantId = attemptedTenantId;

    Object.setPrototypeOf(this, TenantMismatchError.prototype);
  }
}

/**
 * ValidationError: Thrown when input validation fails
 * HTTP Status: 400 Bad Request
 *
 * Requirements: 14.1, 14.2, 14.3
 */
export class ValidationError extends CMSError {
  public readonly errors: Record<string, string[]>;

  constructor(
    errors: Record<string, string[]> | string,
    tenantId?: string,
    adminId?: string
  ) {
    // Handle both single string and record of errors
    const errorRecord = typeof errors === 'string' 
      ? { general: [errors] }
      : errors;
    
    const message = typeof errors === 'string' 
      ? errors
      : `Validation failed with ${Object.keys(errorRecord).length} error(s)`;

    super(message, 400, tenantId, adminId);
    this.name = 'ValidationError';
    this.errors = errorRecord;

    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * DatabaseError: Thrown when database operations fail
 * HTTP Status: 500 Internal Server Error (generic) or 400 (constraint violations)
 *
 * Requirements: 14.4
 */
export class DatabaseError extends CMSError {
  public readonly code?: string;
  public readonly originalError?: Error;

  constructor(
    message: string,
    code?: string,
    tenantId?: string,
    adminId?: string,
    originalError?: Error
  ) {
    // Constraint violation errors should be 400, others 500
    const statusCode = code && ['UNIQUE', 'FK', '23505', '23503'].includes(code) ? 400 : 500;

    super(message, statusCode, tenantId, adminId);
    this.name = 'DatabaseError';
    this.code = code;
    this.originalError = originalError;

    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

/**
 * SanitizationError: Thrown when input contains potentially malicious content
 * HTTP Status: 400 Bad Request
 *
 * Requirements: 14.2, 14.3
 */
export class SanitizationError extends CMSError {
  public readonly fieldName?: string;
  public readonly violationType?: string;

  constructor(
    message: string,
    fieldName?: string,
    violationType?: string,
    tenantId?: string,
    adminId?: string
  ) {
    super(message, 400, tenantId, adminId);
    this.name = 'SanitizationError';
    this.fieldName = fieldName;
    this.violationType = violationType;

    Object.setPrototypeOf(this, SanitizationError.prototype);
  }
}

/**
 * Type guard functions for error checking
 */
export function isTenantMismatchError(error: unknown): error is TenantMismatchError {
  return error instanceof TenantMismatchError;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}

export function isSanitizationError(error: unknown): error is SanitizationError {
  return error instanceof SanitizationError;
}

export function isCMSError(error: unknown): error is CMSError {
  return error instanceof CMSError;
}
