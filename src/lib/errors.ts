/**
 * Custom Error Classes for CMS Settings and Landing Page Customization
 * 
 * This module provides standardized error classes for tenant mismatch,
 * validation failures, and database errors, with integrated logging support.
 */

/**
 * Base error class with tenant and admin context logging
 */
export abstract class ContextualError extends Error {
  public readonly tenantId?: string;
  public readonly adminId?: string;
  public readonly timestamp: Date;

  constructor(
    message: string,
    tenantId?: string,
    adminId?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    this.tenantId = tenantId;
    this.adminId = adminId;
    this.timestamp = new Date();

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ContextualError.prototype);
  }

  /**
   * Get error context for logging
   */
  getContext(): Record<string, any> {
    return {
      errorType: this.name,
      message: this.message,
      tenantId: this.tenantId,
      adminId: this.adminId,
      timestamp: this.timestamp.toISOString(),
    };
  }

  /**
   * Get safe error message for API responses (no internal details)
   */
  getSafeMessage(): string {
    return this.message;
  }
}

/**
 * TenantMismatchError
 * 
 * Thrown when a cross-tenant access attempt is detected.
 * This occurs when an admin from one tenant tries to access another tenant's data.
 * 
 * Requirements: 2.15 (Tenant isolation enforcement), 14.4 (Error handling)
 */
export class TenantMismatchError extends ContextualError {
  public readonly attemptedTenantId: string;
  public readonly expectedTenantId: string;

  constructor(
    attemptedTenantId: string,
    expectedTenantId: string,
    tenantId?: string,
    adminId?: string
  ) {
    const message = 'Tenant mismatch: Access denied';
    super(message, tenantId, adminId);
    
    this.attemptedTenantId = attemptedTenantId;
    this.expectedTenantId = expectedTenantId;
    
    Object.setPrototypeOf(this, TenantMismatchError.prototype);
  }

  getContext(): Record<string, any> {
    return {
      ...super.getContext(),
      attemptedTenantId: this.attemptedTenantId,
      expectedTenantId: this.expectedTenantId,
      severity: 'SECURITY_ISSUE',
    };
  }

  getSafeMessage(): string {
    return 'Access denied';
  }
}

/**
 * ValidationError
 * 
 * Thrown when input validation fails.
 * This occurs when customization data doesn't meet validation requirements
 * (e.g., invalid color format, invalid numeric values, malformed JSON).
 * 
 * Requirements: 14.1 (Validation), 14.2 (Error handling), 14.4 (Error handling)
 */
export class ValidationError extends ContextualError {
  public readonly fieldErrors: Map<string, string[]>;

  constructor(
    message: string,
    fieldErrors?: Record<string, string[]>,
    tenantId?: string,
    adminId?: string
  ) {
    super(message, tenantId, adminId);
    
    this.fieldErrors = new Map(
      fieldErrors ? Object.entries(fieldErrors) : []
    );
    
    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  /**
   * Add field error to the collection
   */
  addFieldError(field: string, error: string): void {
    if (!this.fieldErrors.has(field)) {
      this.fieldErrors.set(field, []);
    }
    this.fieldErrors.get(field)!.push(error);
  }

  /**
   * Get all field errors as a plain object
   */
  getFieldErrors(): Record<string, string[]> {
    const errors: Record<string, string[]> = {};
    this.fieldErrors.forEach((fieldErrorsList, field) => {
      errors[field] = fieldErrorsList;
    });
    return errors;
  }

  getContext(): Record<string, any> {
    const fieldErrorsObj: Record<string, string[]> = {};
    this.fieldErrors.forEach((errors, field) => {
      fieldErrorsObj[field] = errors;
    });

    return {
      ...super.getContext(),
      fieldErrors: fieldErrorsObj,
      fieldCount: this.fieldErrors.size,
    };
  }

  getSafeMessage(): string {
    if (this.fieldErrors.size === 0) {
      return this.message;
    }
    
    const firstField = Array.from(this.fieldErrors.keys())[0];
    const firstError = this.fieldErrors.get(firstField)?.[0];
    return `Validation failed: ${firstError}`;
  }
}

/**
 * DatabaseError
 * 
 * Thrown when database operations fail.
 * This covers query execution failures, connection errors, constraint violations, etc.
 * 
 * Requirements: 14.3 (Error handling), 14.4 (Error handling)
 */
export class DatabaseError extends ContextualError {
  public readonly originalError?: Error;
  public readonly operationType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'TRANSACTION' | 'UNKNOWN';

  constructor(
    message: string,
    operationType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'TRANSACTION' | 'UNKNOWN' = 'UNKNOWN',
    originalError?: Error,
    tenantId?: string,
    adminId?: string
  ) {
    const displayMessage = `Database error during ${operationType}: ${message}`;
    super(displayMessage, tenantId, adminId);
    
    this.originalError = originalError;
    this.operationType = operationType;
    
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }

  getContext(): Record<string, any> {
    return {
      ...super.getContext(),
      operationType: this.operationType,
      originalErrorMessage: this.originalError?.message,
      originalErrorStack: this.originalError?.stack,
    };
  }

  getSafeMessage(): string {
    return 'A database error occurred. Please try again later.';
  }
}

/**
 * Error logging utility for consistent error logging across the application
 * 
 * Logs errors with tenant and admin context for audit trail
 */
export class ErrorLogger {
  /**
   * Log a contextual error with appropriate severity
   */
  static log(error: ContextualError, context?: string): void {
    const errorContext = error.getContext();
    const prefix = context ? `[${context}]` : '';

    if (error instanceof TenantMismatchError) {
      console.warn(
        `${prefix} SECURITY_ISSUE: ${error.message}`,
        errorContext
      );
    } else if (error instanceof DatabaseError) {
      console.error(
        `${prefix} DATABASE_ERROR: ${error.message}`,
        errorContext
      );
    } else if (error instanceof ValidationError) {
      console.warn(
        `${prefix} VALIDATION_ERROR: ${error.message}`,
        errorContext
      );
    } else {
      console.error(
        `${prefix} ERROR: ${error.message}`,
        errorContext
      );
    }
  }

  /**
   * Log any error with contextual information
   */
  static logWithContext(
    error: Error | ContextualError,
    tenantId?: string,
    adminId?: string,
    context?: string
  ): void {
    if (error instanceof ContextualError) {
      this.log(error, context);
    } else {
      const prefix = context ? `[${context}]` : '';
      console.error(
        `${prefix} ${error.name}: ${error.message}`,
        {
          tenantId,
          adminId,
          timestamp: new Date().toISOString(),
          stack: error.stack,
        }
      );
    }
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

export function isContextualError(error: unknown): error is ContextualError {
  return error instanceof ContextualError;
}
