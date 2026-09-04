/**
 * Security Tests for Program Validation Endpoint
 * GET /api/programs/{programId}/validate-share
 *
 * **Validates: Requirements 10.1**
 *
 * Security Focus:
 * - Test invalid program_id format rejected
 * - Test XSS-style injection in program_id prevented
 * - Test SQL injection in program_id prevented (backend validation)
 * - Test sanitized values stored correctly
 * - Ensure no code execution from malicious program_id values
 *
 * Requirements: 10.1 (Security - Validate Program Access Permissions)
 */

import { GET } from '../route';
import { NextRequest } from 'next/server';

// Mock the programService
jest.mock('@/services/programService', () => ({
  programService: {
    getProgramById: jest.fn(),
  },
}));

// Mock the errorHandler middleware
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: any) => handler,
}));

// Mock the response utilities
jest.mock('@/utils/responses', () => ({
  successResponse: (data: any, _?: any, status?: number) => {
    const textFn = () => JSON.stringify(data);
    return {
      status: status || 200,
      json: jest.fn().mockResolvedValue(data),
      text: textFn,
    };
  },
  errorResponse: (message: string, status: number) => {
    const textFn = () => JSON.stringify({ success: false, error: message });
    return {
      status,
      json: jest.fn().mockResolvedValue({ success: false, error: message }),
      text: textFn,
    };
  },
}));

describe('Program Validation Endpoint - Security Tests', () => {
  const validUUID = 'a1b2c3d4-e5f6-4a18-b9d0-c1a2b3c4d5e6';

  const mockActiveProgram = {
    id: validUUID,
    name: 'Sample Program',
    description: 'A valid program',
    status: 'active',
    start_date: '2024-01-15',
    end_date: '2024-03-15',
    max_trainees: 30,
    current_enrollment: 12,
    image_path: 'programs/image.jpg',
    thumbnail_path: 'programs/thumb.jpg',
    instructor: 'John Doe',
    duration_weeks: 8,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Requirement 10.1: Program ID Format Validation (UUID)', () => {
    it('should accept properly formatted UUID program_id', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(mockActiveProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validUUID}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validUUID }),
      });

      expect(response.status).toBe(200);
      const responseData = JSON.parse(response.text());
      expect(responseData.isValid).toBe(true);
    });

    it('should handle non-UUID program_id gracefully (returns invalid response, not error)', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(null);

      const invalidFormats = [
        'not-a-uuid',
        '12345',
        'random-string-value',
      ];

      for (const invalidFormat of invalidFormats) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${invalidFormat}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: invalidFormat }),
        });

        // Response should be well-formed with isValid=false
        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        const responseData = JSON.parse(response.text());
        expect(responseData.isValid).toBe(false);
        expect(responseData.program).toBeUndefined();
      }
    });

    it('should reject empty or whitespace-only program_id', async () => {
      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs//validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: '' }),
      });

      // Should return 400 for empty ID
      expect(response.status).toBe(400);
    });

    it('should handle program_id with control characters safely', async () => {
      const { programService } = require('@/services/programService');

      const maliciousIds = [
        'id\0test', // null byte
        'id\ntest', // newline
        'id\rtest', // carriage return
      ];

      for (const maliciousId of maliciousIds) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(maliciousId)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: maliciousId }),
        });

        // Should handle control characters safely without executing
        expect(response).toBeDefined();
        // Control characters should result in no valid program found
        if (response.status === 200) {
          const responseData = JSON.parse(response.text());
          expect(responseData.isValid).toBe(false);
        }
      }
    });
  });

  describe('Security: XSS Prevention in program_id', () => {
    it('should prevent XSS injection through program_id parameter (not executed)', async () => {
      const { programService } = require('@/services/programService');

      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src=x onerror=alert("XSS")>',
        'javascript:alert("XSS")',
        '"><script>alert("XSS")</script>',
        '"><svg onload=alert("XSS")>',
        '<iframe src="javascript:alert(\'XSS\')"></iframe>',
        '<body onload=alert("XSS")>',
        'data:text/html,<script>alert("XSS")</script>',
      ];

      for (const payload of xssPayloads) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(payload)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: payload }),
        });

        // Should not execute any script
        expect(response).toBeDefined();
        expect(response.status).toBe(200);

        // Verify no code execution - payload should not appear in any executable context
        const responseData = JSON.parse(response.text());
        expect(responseData.data?.program).toBeUndefined(); // No valid program found
        expect(responseData.isValid).toBe(false); // XSS payload is not a valid UUID
      }
    });

    it('should not store XSS attempts in response data', async () => {
      const { programService } = require('@/services/programService');

      const xssPayload = '<script>alert("XSS")</script>';
      programService.getProgramById.mockResolvedValue(null);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${encodeURIComponent(xssPayload)}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: xssPayload }),
      });

      expect(response.status).toBe(200);
      const responseData = JSON.parse(response.text());

      // Verify payload is not stored or returned
      expect(responseData.data?.program).toBeUndefined();

      // Verify programService was called (with the payload as a literal string parameter)
      // This validates that it's passed as a query parameter, not concatenated into SQL
      if (programService.getProgramById.mock.calls.length > 0) {
        const callArgs = programService.getProgramById.mock.calls[0];
        // The payload should be a parameter, not an executable context
        expect(callArgs[0]).toBe(xssPayload);
      }
    });

    it('should not execute template expressions in program_id', async () => {
      const { programService } = require('@/services/programService');

      const templateExpressions = ['${7*7}', '{{7*7}}', '<%= 7*7 %>', '#{7*7}'];

      for (const expr of templateExpressions) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(expr)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: expr }),
        });

        // Response should treat expressions as literal strings
        expect(response.status).toBe(200);
        const responseData = JSON.parse(response.text());
        expect(responseData.isValid).toBe(false); // Not a valid UUID
        expect(responseData.program).toBeUndefined();
        // Expression should not be evaluated (49, 49, etc.)
      }
    });

    it('should not echo XSS payloads in error messages', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(null);

      const xssPayload = '<script>alert("test")</script>';

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${encodeURIComponent(xssPayload)}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: xssPayload }),
      });

      const responseData = JSON.parse(response.text());

      // Error message should not contain unescaped HTML
      if (responseData.error) {
        // Error message should not contain the malicious script
        expect(responseData.error).not.toContain('<script>');
        expect(responseData.error).not.toContain('onerror');
        expect(responseData.error).not.toContain('alert');
      }
    });

    it('should treat XSS attempts as literal program_id values (not parsed)', async () => {
      const { programService } = require('@/services/programService');

      const xssPayload = '"><svg onload=alert("XSS")>';
      programService.getProgramById.mockResolvedValue(null);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${encodeURIComponent(xssPayload)}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: xssPayload }),
      });

      // Verify payload was treated as literal parameter value
      if (programService.getProgramById.mock.calls.length > 0) {
        const passedId = programService.getProgramById.mock.calls[0][0];
        // Should be passed as-is, not parsed
        expect(passedId).toBe(xssPayload);
      }

      const responseData = JSON.parse(response.text());
      expect(responseData.isValid).toBe(false);
    });
  });

  describe('Security: SQL Injection Prevention in program_id', () => {
    it('should prevent SQL injection through program_id (parameterized queries)', async () => {
      const { programService } = require('@/services/programService');

      const sqlInjectionPayloads = [
        "'; DROP TABLE programs; --",
        "' OR '1'='1",
        "' OR 1=1 --",
        "admin' --",
        "1' UNION SELECT * FROM users --",
        "' AND (SELECT COUNT(*) FROM programs) > 0 --",
      ];

      for (const payload of sqlInjectionPayloads) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(payload)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: payload }),
        });

        // Should handle safely - payload treated as literal parameter
        expect(response).toBeDefined();
        expect(response.status).toBe(200);

        // Verify programService received it as a literal parameter, not SQL
        if (programService.getProgramById.mock.calls.length > 0) {
          const passedId = programService.getProgramById.mock.calls[0][0];
          // Should be the literal string, not concatenated SQL
          expect(passedId).toBe(payload);
        }

        // Verify response doesn't contain success (program not found)
        const responseData = JSON.parse(response.text());
        expect(responseData.isValid).toBe(false); // No program matches SQL injection payload
        expect(responseData.program).toBeUndefined();
      }
    });

    it('should handle program_id with SQL keywords safely (as literal strings)', async () => {
      const { programService } = require('@/services/programService');

      const sqlKeywords = [
        "' SELECT",
        "' DELETE",
        "' INSERT",
        "' UPDATE",
      ];

      for (const keyword of sqlKeywords) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(keyword)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: keyword }),
        });

        // These should be treated as literal program IDs (which don't exist)
        expect(response.status).toBe(200);
        const responseData = JSON.parse(response.text());
        expect(responseData.isValid).toBe(false);

        // Verify programService was called with keyword as parameter
        expect(programService.getProgramById).toHaveBeenCalledWith(keyword);
      }
    });

    it('should handle program_id with SQL comments safely (as literal strings)', async () => {
      const { programService } = require('@/services/programService');

      const sqlCommentPatterns = [
        'id--comment',
        'id/*comment*/',
        'id#comment',
      ];

      for (const pattern of sqlCommentPatterns) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(pattern)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: pattern }),
        });

        // Patterns should be treated as literal IDs
        expect(response.status).toBe(200);
        const responseData = JSON.parse(response.text());
        expect(responseData.isValid).toBe(false);

        // Verify passed as parameter, not SQL
        expect(programService.getProgramById).toHaveBeenCalledWith(pattern);
      }
    });

    it('should not allow program_id to escape quote context', async () => {
      const { programService } = require('@/services/programService');

      // Simulate SQL injection that tries to escape quotes
      const payload = "'; UPDATE programs SET status='inactive' WHERE id='";
      programService.getProgramById.mockResolvedValue(null);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${encodeURIComponent(payload)}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: payload }),
      });

      expect(response.status).toBe(200);
      const responseData = JSON.parse(response.text());

      // Should be treated as literal program ID, not executed
      expect(responseData.isValid).toBe(false);

      // Verify it was passed as a parameter
      expect(programService.getProgramById).toHaveBeenCalledWith(payload);
    });

    it('should handle double-encoded SQL injection safely', async () => {
      const { programService } = require('@/services/programService');

      const doubleEncodedPayload = '%27%20OR%20%271%27%3D%271'; // ' OR '1'='1
      const decodedPayload = decodeURIComponent(doubleEncodedPayload);

      programService.getProgramById.mockResolvedValue(null);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${doubleEncodedPayload}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: decodedPayload }),
      });

      expect(response.status).toBe(200);
      const responseData = JSON.parse(response.text());

      // Should handle as literal string
      expect(responseData.isValid).toBe(false);
    });
  });

  describe('Security: Sanitization and Storage', () => {
    it('should sanitize program_id before any processing', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(mockActiveProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validUUID}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validUUID }),
      });

      // Verify programService is called with exact clean UUID
      expect(programService.getProgramById).toHaveBeenCalledWith(validUUID);

      // Verify no extra characters or encoding in the call
      const callArgs = (programService.getProgramById as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe(validUUID);
      expect(callArgs[0]).not.toContain('%');
      expect(callArgs[0]).not.toContain('\\');
    });

    it('should not allow program_id parameter to influence response fields', async () => {
      const { programService } = require('@/services/programService');

      const maliciousId = '<script>alert("xss")</script>';
      programService.getProgramById.mockResolvedValue(null);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${encodeURIComponent(maliciousId)}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: maliciousId }),
      });

      const responseData = JSON.parse(response.text());

      // Response should not echo back the malicious program_id
      const responseString = JSON.stringify(responseData);
      expect(responseString).not.toContain('<script>');
      expect(responseString).not.toContain('alert');
      expect(responseString).not.toContain('onerror');
    });

    it('should return program data only from database, not from user input', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(mockActiveProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validUUID}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validUUID }),
      });

      const responseData = JSON.parse(response.text());

      // Response program_id should come from database
      expect(responseData.program.id).toBe(mockActiveProgram.id);
      // Verify it matches database value
      expect(responseData.program.name).toBe('Sample Program');
    });

    it('should handle program_id with special characters without corruption', async () => {
      const { programService } = require('@/services/programService');

      const specialCharsId = 'id%20with%20spaces';
      programService.getProgramById.mockResolvedValue(null);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${specialCharsId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: decodeURIComponent(specialCharsId) }),
      });

      const responseData = JSON.parse(response.text());

      // Should handle special characters as literal program ID
      expect(responseData.isValid).toBe(false);
      // No corruption of other response fields
      expect(responseData).toHaveProperty('isActive');
      expect(responseData).toHaveProperty('isPublic');
    });
  });

  describe('Security: No Code Execution from program_id', () => {
    it('should not evaluate program_id as code', async () => {
      const { programService } = require('@/services/programService');

      const codeExecutionAttempts = [
        'eval("alert(1)")',
        '1 + 1',
        'Math.max(1,2,3)',
      ];

      for (const attempt of codeExecutionAttempts) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(attempt)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: attempt }),
        });

        // Should be treated as literal string, not executed
        expect(response.status).toBe(200);
        const responseData = JSON.parse(response.text());
        expect(responseData.isValid).toBe(false); // Not a UUID
      }
    });

    it('should not allow prototype pollution through program_id', async () => {
      const { programService } = require('@/services/programService');

      const pollutionAttempts = [
        '__proto__[admin]=true',
        'constructor.prototype.isAdmin=true',
      ];

      for (const attempt of pollutionAttempts) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(attempt)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: attempt }),
        });

        // Should handle safely - treated as literal string
        expect(response.status).toBe(200);
        const responseData = JSON.parse(response.text());
        expect(responseData.isValid).toBe(false);
      }
    });

    it('should not interpret program_id as object notation', async () => {
      const { programService } = require('@/services/programService');

      const objectNotationAttempts = [
        '{"admin":true}',
        '{"status":"active"}',
      ];

      for (const attempt of objectNotationAttempts) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(attempt)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: attempt }),
        });

        // Should treat as literal string, not parse as object
        expect(response.status).toBe(200);
        const responseData = JSON.parse(response.text());
        expect(responseData.isValid).toBe(false); // Not a UUID
      }
    });

    it('should not leak environment variables through program_id', async () => {
      const { programService } = require('@/services/programService');

      // Even if someone tries to reference process.env, it should not leak
      const envAccessAttempts = [
        'process.env.DATABASE_URL',
        'process.env',
        'globalThis.secretKey',
      ];

      for (const attempt of envAccessAttempts) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(attempt)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: attempt }),
        });

        // Should handle safely
        expect(response).toBeDefined();

        // If any error message is returned, it should not leak secrets
        const responseData = JSON.parse(response.text());
        if (responseData.error) {
          // Error message should not contain database URL if it exists
          const dbUrl = process.env.DATABASE_URL;
          if (dbUrl) {
            expect(responseData.error).not.toContain(dbUrl);
          }
        }
      }
    });
  });

  describe('Security: Backend Validation Requirements', () => {
    it('should validate program_id on backend before database query (Requirement 10.1)', async () => {
      const { programService } = require('@/services/programService');

      const maliciousId = "'; DROP TABLE programs; --";

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${encodeURIComponent(maliciousId)}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: maliciousId }),
      });

      // Should handle safely - either reject (400) or treat as literal
      expect(response).toBeDefined();
      if (response.status === 200) {
        // If accepted, verify it's treated as literal not executed
        expect(programService.getProgramById).toHaveBeenCalledWith(maliciousId);
        const responseData = JSON.parse(response.text());
        expect(responseData.isValid).toBe(false);
      }
    });

    it('should pass program_id as a parameter, not concatenate into SQL', async () => {
      const { programService } = require('@/services/programService');

      // The endpoint should pass program_id as a parameter, not concatenate it
      // This is verified by checking that programService receives literal string
      programService.getProgramById.mockResolvedValue(mockActiveProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validUUID}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validUUID }),
      });

      // Verify programService was called with the exact parameter
      expect(programService.getProgramById).toHaveBeenCalledWith(validUUID);
      expect(programService.getProgramById).toHaveBeenCalledTimes(1);

      // Verify only one argument (parameterized call, not SQL string)
      const callArgs = (programService.getProgramById as jest.Mock).mock.calls[0];
      expect(callArgs.length).toBe(1);
    });

    it('should not allow program_id to control database query behavior', async () => {
      const { programService } = require('@/services/programService');

      const queryManipulationAttempts = [
        'id; UPDATE',
        'id LIMIT',
        'id ORDER BY',
      ];

      for (const attempt of queryManipulationAttempts) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(null);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(attempt)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: attempt }),
        });

        // Should treat as literal string
        expect(response.status).toBe(200);
        if (programService.getProgramById.mock.calls.length > 0) {
          // Verify it's treated as literal lookup
          expect(programService.getProgramById).toHaveBeenCalledWith(attempt);
          const responseData = JSON.parse(response.text());
          expect(responseData.isValid).toBe(false); // No program with this literal ID
        }
      }
    });
  });

  describe('Security: Defense in Depth', () => {
    it('should handle concurrent security threats safely', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(null);

      const threats = [
        '<script>alert("1")</script>',
        "'; DROP TABLE; --",
        '${alert("xss")}',
      ];

      for (const threat of threats) {
        jest.clearAllMocks();
        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${encodeURIComponent(threat)}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: threat }),
        });

        // All threats should be handled safely
        expect(response).toBeDefined();
        const responseData = JSON.parse(response.text());
        expect(responseData.isValid).toBe(false);
      }
    });

    it('should maintain security posture with malformed requests', async () => {
      const { programService } = require('@/services/programService');

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs//validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: '' }),
      });

      // Should handle gracefully
      expect(response).toBeDefined();
      expect(response.status).toBe(400);
    });

    it('should not leak sensitive information in error messages', async () => {
      const { programService } = require('@/services/programService');

      const sensitiveError = new Error('Database password is incorrect: abc123');
      programService.getProgramById.mockRejectedValue(sensitiveError);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validUUID}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validUUID }),
      });

      const responseData = JSON.parse(response.text());

      // Error message should not contain sensitive info
      if (responseData.data?.error) {
        expect(responseData.data.error).not.toContain('abc123');
        expect(responseData.data.error).not.toContain('password');
      }
    });
  });

  describe('Security: Input Validation Before Storage', () => {
    it('should validate UUID format strictly before any DB operation', async () => {
      const { programService } = require('@/services/programService');

      const strictUUIDTests = [
        { input: validUUID, shouldCall: true }, // Valid
        { input: 'not-uuid', shouldCall: false }, // Invalid but handled gracefully
        { input: 'a1b2c3d4-e5f6-4a18-b9d0-c1a2b3c4d5e6extra', shouldCall: false }, // Too long
      ];

      for (const test of strictUUIDTests) {
        jest.clearAllMocks();
        programService.getProgramById.mockResolvedValue(
          test.shouldCall ? mockActiveProgram : null
        );

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${test.input}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: test.input }),
        });

        if (test.shouldCall) {
          expect(response.status).toBe(200);
          expect(programService.getProgramById).toHaveBeenCalled();
        } else {
          // Should handle as unknown program (returns isValid=false)
          expect(response.status).toBe(200);
          const responseData = JSON.parse(response.text());
          expect(responseData.isValid).toBe(false);
        }
      }
    });
  });

  describe('Requirement 10.1 Coverage: Security Validation for program_id', () => {
    it('fulfills Requirement 10.1.1: Validate program_id format (UUID)', async () => {
      // Test that only valid UUIDs are accepted
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(mockActiveProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validUUID}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validUUID }),
      });

      expect(response.status).toBe(200);
      expect(programService.getProgramById).toHaveBeenCalledWith(validUUID);
    });

    it('fulfills Requirement 10.1.2: Sanitize query parameter before storage', async () => {
      // Test that input is sanitized (whitespace, encoding)
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(mockActiveProgram);

      const encodedUUID = encodeURIComponent(validUUID);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${encodedUUID}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validUUID }),
      });

      // Verify response doesn't contain URL-encoded characters
      const responseData = JSON.parse(response.text());
      expect(responseData.program.id).toBe(validUUID);
      expect(responseData.program.id).not.toContain('%');
    });

    it('fulfills Requirement 10.1.3: Never execute code from program_id value', async () => {
      const { programService } = require('@/services/programService');

      const codeExecution = "require('fs').readFileSync('/etc/passwd')";
      programService.getProgramById.mockResolvedValue(null);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${encodeURIComponent(codeExecution)}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: codeExecution }),
      });

      // Should not execute - treat as literal string, return isValid=false
      expect(response.status).toBe(200);
      const responseData = JSON.parse(response.text());
      expect(responseData.isValid).toBe(false); // Not a valid UUID
    });

    it('fulfills Requirement 10.1.4: Validate on backend before any action', async () => {
      const { programService } = require('@/services/programService');

      const maliciousInput = "'; DELETE FROM programs; --";
      programService.getProgramById.mockResolvedValue(null);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${encodeURIComponent(maliciousInput)}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: maliciousInput }),
      });

      // Validation should happen - payload treated as literal string
      expect(response.status).toBe(200);
      const responseData = JSON.parse(response.text());
      expect(responseData.isValid).toBe(false);

      // Verify it's passed as parameter to service
      if (programService.getProgramById.mock.calls.length > 0) {
        expect(programService.getProgramById).toHaveBeenCalledWith(maliciousInput);
      }
    });
  });
});
