/**
 * Tests for Custom Error Classes
 * 
 * Validates that error classes properly encapsulate error context,
 * support logging, and maintain tenant isolation through error metadata.
 */

import {
  TenantMismatchError,
  ValidationError,
  DatabaseError,
  ContextualError,
  ErrorLogger,
  isTenantMismatchError,
  isValidationError,
  isDatabaseError,
  isContextualError,
} from './errors';

describe('ContextualError', () => {
  it('should capture basic error information', () => {
    class TestError extends ContextualError {
      constructor() {
        super('Test error message', 'tenant-123', 'admin-456');
      }
    }

    const error = new TestError();

    expect(error.message).toBe('Test error message');
    expect(error.tenantId).toBe('tenant-123');
    expect(error.adminId).toBe('admin-456');
    expect(error.timestamp).toBeInstanceOf(Date);
    expect(error.name).toBe('TestError');
  });

  it('should provide context with all metadata', () => {
    class TestError extends ContextualError {
      constructor() {
        super('Test error', 'tenant-789', 'admin-012');
      }
    }

    const error = new TestError();
    const context = error.getContext();

    expect(context).toHaveProperty('errorType', 'TestError');
    expect(context).toHaveProperty('message', 'Test error');
    expect(context).toHaveProperty('tenantId', 'tenant-789');
    expect(context).toHaveProperty('adminId', 'admin-012');
    expect(context).toHaveProperty('timestamp');
  });

  it('should handle optional tenantId and adminId', () => {
    class TestError extends ContextualError {
      constructor() {
        super('Test error');
      }
    }

    const error = new TestError();

    expect(error.tenantId).toBeUndefined();
    expect(error.adminId).toBeUndefined();
    expect(error.message).toBe('Test error');
  });

  it('should maintain instanceof checks', () => {
    class TestError extends ContextualError {
      constructor() {
        super('Test error');
      }
    }

    const error = new TestError();

    expect(error).toBeInstanceOf(ContextualError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('TenantMismatchError', () => {
  it('should capture tenant IDs involved in mismatch', () => {
    const error = new TenantMismatchError(
      'tenant-bad',
      'tenant-good',
      'tenant-good',
      'admin-123'
    );

    expect(error.attemptedTenantId).toBe('tenant-bad');
    expect(error.expectedTenantId).toBe('tenant-good');
    expect(error.tenantId).toBe('tenant-good');
    expect(error.adminId).toBe('admin-123');
  });

  it('should provide descriptive error message', () => {
    const error = new TenantMismatchError(
      'tenant-bad',
      'tenant-good'
    );

    expect(error.message).toBe('Tenant mismatch: Access denied');
  });

  it('should include tenant IDs in context', () => {
    const error = new TenantMismatchError(
      'tenant-attacker',
      'tenant-victim',
      'tenant-victim',
      'admin-attacker'
    );

    const context = error.getContext();

    expect(context.attemptedTenantId).toBe('tenant-attacker');
    expect(context.expectedTenantId).toBe('tenant-victim');
    expect(context.severity).toBe('SECURITY_ISSUE');
  });

  it('should provide safe message for API responses', () => {
    const error = new TenantMismatchError(
      'tenant-bad',
      'tenant-good'
    );

    expect(error.getSafeMessage()).toBe('Access denied');
  });

  it('should maintain instanceof checks', () => {
    const error = new TenantMismatchError(
      'tenant-bad',
      'tenant-good'
    );

    expect(error).toBeInstanceOf(TenantMismatchError);
    expect(error).toBeInstanceOf(ContextualError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ValidationError', () => {
  it('should capture field-level validation errors', () => {
    const fieldErrors = {
      colors: ['Invalid hex color format'],
      fontSize: ['Must be a positive number'],
    };

    const error = new ValidationError(
      'Validation failed',
      fieldErrors,
      'tenant-123',
      'admin-456'
    );

    expect(error.fieldErrors.get('colors')).toContain('Invalid hex color format');
    expect(error.fieldErrors.get('fontSize')).toContain('Must be a positive number');
  });

  it('should allow adding field errors after creation', () => {
    const error = new ValidationError('Initial validation failed');

    error.addFieldError('colors', 'Invalid color');
    error.addFieldError('colors', 'Color already used');
    error.addFieldError('spacing', 'Must be positive');

    const colorErrors = error.fieldErrors.get('colors');
    expect(colorErrors).toHaveLength(2);
    expect(colorErrors).toContain('Invalid color');
    expect(colorErrors).toContain('Color already used');
  });

  it('should provide field errors as plain object', () => {
    const fieldErrors = {
      colors: ['Invalid hex'],
      layout: ['Invalid width'],
    };

    const error = new ValidationError('Validation failed', fieldErrors);
    const errors = error.getFieldErrors();

    expect(errors.colors).toContain('Invalid hex');
    expect(errors.layout).toContain('Invalid width');
  });

  it('should include field errors in context', () => {
    const fieldErrors = {
      colors: ['Error 1'],
      spacing: ['Error 2', 'Error 3'],
    };

    const error = new ValidationError('Validation failed', fieldErrors);
    const context = error.getContext();

    expect(context.fieldErrors).toEqual(fieldErrors);
    expect(context.fieldCount).toBe(2);
  });

  it('should provide safe message with first field error', () => {
    const fieldErrors = {
      colors: ['Invalid hex color'],
      spacing: ['Must be positive'],
    };

    const error = new ValidationError('Validation failed', fieldErrors);
    const safeMessage = error.getSafeMessage();

    expect(safeMessage).toContain('Invalid hex color');
  });

  it('should handle empty field errors gracefully', () => {
    const error = new ValidationError('Validation failed');

    expect(error.fieldErrors.size).toBe(0);
    expect(error.getSafeMessage()).toBe('Validation failed');
    expect(error.getFieldErrors()).toEqual({});
  });

  it('should maintain instanceof checks', () => {
    const error = new ValidationError('Validation failed');

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toBeInstanceOf(ContextualError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('DatabaseError', () => {
  it('should capture operation type', () => {
    const error = new DatabaseError(
      'Connection timeout',
      'SELECT',
      undefined,
      'tenant-123',
      'admin-456'
    );

    expect(error.operationType).toBe('SELECT');
    expect(error.message).toContain('Database error during SELECT');
  });

  it('should capture original error', () => {
    const originalError = new Error('Unique constraint violation');
    const error = new DatabaseError(
      'Failed to insert record',
      'INSERT',
      originalError
    );

    expect(error.originalError).toBe(originalError);
    expect(error.originalError?.message).toBe('Unique constraint violation');
  });

  it('should include operation details in context', () => {
    const originalError = new Error('Connection lost');
    const error = new DatabaseError(
      'Query failed',
      'UPDATE',
      originalError,
      'tenant-789'
    );

    const context = error.getContext();

    expect(context.operationType).toBe('UPDATE');
    expect(context.originalErrorMessage).toBe('Connection lost');
    expect(context.originalErrorStack).toBeDefined();
  });

  it('should provide safe message for API responses', () => {
    const originalError = new Error('Sensitive DB details here');
    const error = new DatabaseError(
      'Internal error',
      'SELECT',
      originalError
    );

    expect(error.getSafeMessage()).toBe('A database error occurred. Please try again later.');
  });

  it('should default to UNKNOWN operation type', () => {
    const error = new DatabaseError('Unknown error');

    expect(error.operationType).toBe('UNKNOWN');
    expect(error.message).toContain('UNKNOWN');
  });

  it('should maintain instanceof checks', () => {
    const error = new DatabaseError('Query failed', 'DELETE');

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toBeInstanceOf(ContextualError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ErrorLogger', () => {
  // Mock console methods to capture logs
  let consoleSpy: {
    warn: jest.SpyInstance;
    error: jest.SpyInstance;
  };

  beforeEach(() => {
    consoleSpy = {
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log TenantMismatchError as security issue', () => {
    const error = new TenantMismatchError('tenant-bad', 'tenant-good', 'tenant-good', 'admin-123');

    ErrorLogger.log(error, 'TEST_CONTEXT');

    expect(consoleSpy.warn).toHaveBeenCalledWith(
      expect.stringContaining('SECURITY_ISSUE'),
      expect.any(Object)
    );
    expect(consoleSpy.warn).toHaveBeenCalledWith(
      expect.stringContaining('[TEST_CONTEXT]'),
      expect.any(Object)
    );
  });

  it('should log ValidationError as warning', () => {
    const error = new ValidationError('Validation failed', { colors: ['Invalid'] });

    ErrorLogger.log(error, 'VALIDATION');

    expect(consoleSpy.warn).toHaveBeenCalledWith(
      expect.stringContaining('VALIDATION_ERROR'),
      expect.any(Object)
    );
  });

  it('should log DatabaseError as error', () => {
    const error = new DatabaseError('Query failed', 'SELECT');

    ErrorLogger.log(error, 'DATABASE');

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('DATABASE_ERROR'),
      expect.any(Object)
    );
  });

  it('should log with context when provided', () => {
    const error = new ContextualError('Generic error', 'tenant-123', 'admin-456');
    const context = { customField: 'value' };

    ErrorLogger.logWithContext(error, 'tenant-123', 'admin-456', 'MY_CONTEXT');

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('[MY_CONTEXT]'),
      expect.any(Object)
    );
  });

  it('should log non-contextual errors with tenant info', () => {
    const standardError = new Error('Standard error');

    ErrorLogger.logWithContext(standardError, 'tenant-789', 'admin-012', 'STANDARD');

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining('[STANDARD]'),
      expect.objectContaining({
        tenantId: 'tenant-789',
        adminId: 'admin-012',
      })
    );
  });
});

describe('Type guard functions', () => {
  it('should correctly identify TenantMismatchError', () => {
    const error = new TenantMismatchError('bad', 'good');
    const notError = new ValidationError('test');

    expect(isTenantMismatchError(error)).toBe(true);
    expect(isTenantMismatchError(notError)).toBe(false);
    expect(isTenantMismatchError(new Error('standard'))).toBe(false);
  });

  it('should correctly identify ValidationError', () => {
    const error = new ValidationError('test');
    const notError = new TenantMismatchError('bad', 'good');

    expect(isValidationError(error)).toBe(true);
    expect(isValidationError(notError)).toBe(false);
    expect(isValidationError(new Error('standard'))).toBe(false);
  });

  it('should correctly identify DatabaseError', () => {
    const error = new DatabaseError('test', 'SELECT');
    const notError = new ValidationError('test');

    expect(isDatabaseError(error)).toBe(true);
    expect(isDatabaseError(notError)).toBe(false);
    expect(isDatabaseError(new Error('standard'))).toBe(false);
  });

  it('should correctly identify ContextualError', () => {
    const error1 = new TenantMismatchError('bad', 'good');
    const error2 = new ValidationError('test');
    const error3 = new DatabaseError('test', 'SELECT');
    const notError = new Error('standard');

    expect(isContextualError(error1)).toBe(true);
    expect(isContextualError(error2)).toBe(true);
    expect(isContextualError(error3)).toBe(true);
    expect(isContextualError(notError)).toBe(false);
  });
});

describe('Error context with tenant isolation', () => {
  it('should include tenant context in TenantMismatchError logs', () => {
    const error = new TenantMismatchError(
      'tenant-attacker',
      'tenant-victim',
      'tenant-victim',
      'admin-attacker'
    );

    const context = error.getContext();

    // Security: Ensure both tenant IDs are captured for audit
    expect(context.tenantId).toBe('tenant-victim');
    expect(context.attemptedTenantId).toBe('tenant-attacker');
    expect(context.expectedTenantId).toBe('tenant-victim');
  });

  it('should include admin context in all errors', () => {
    const errors = [
      new TenantMismatchError('bad', 'good', 'good', 'admin-123'),
      new ValidationError('test', {}, 'tenant-123', 'admin-123'),
      new DatabaseError('test', 'SELECT', undefined, 'tenant-123', 'admin-123'),
    ];

    errors.forEach((error) => {
      const context = error.getContext();
      expect(context.adminId).toBe('admin-123');
      expect(context.tenantId).toBeDefined();
      expect(context.timestamp).toBeDefined();
    });
  });
});
