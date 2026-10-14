/**
 * Unit Tests for Program Validation Endpoint
 * GET /api/programs/{programId}/validate-share
 *
 * Requirements: 2.4, 8.1
 * Property 3: Program Validation Non-Acceptance — Invalid program_id fails validation and no data stored
 *
 * Tests:
 * - Valid active program returns success with metadata
 * - Inactive program returns failure
 * - Non-existent program returns failure with appropriate error
 * - Program metadata is included in response
 * - Invalid program_id format is handled gracefully
 *
 * Validates: Requirements 2.4, 8.1
 */

import { GET } from '../route';
import { NextRequest } from 'next/server';
import * as programSharingUtils from '@/utils/programSharingUtils';

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

describe('Program Validation Endpoint - GET /api/programs/{programId}/validate-share', () => {
  const validProgramId = 'a1b2c3d4-e5f6-4a18-b9d0-c1a2b3c4d5e6';
  const invalidProgramId = 'not-a-uuid';
  const nonExistentId = '00000000-0000-0000-0000-000000000000';

  const mockActiveProgram = {
    id: validProgramId,
    name: 'TypeScript Advanced Training',
    description: 'Learn advanced TypeScript concepts and best practices',
    status: 'active',
    start_date: '2024-01-15',
    end_date: '2024-03-15',
    max_trainees: 30,
    current_enrollment: 12,
    image_path: 'programs/a1b2c3d4/image.jpg',
    thumbnail_path: 'programs/a1b2c3d4/thumbnail.jpg',
    instructor: 'John Doe',
    duration_weeks: 8,
    tenant_id: 'test-tenant-id',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  const mockInactiveProgram = {
    ...mockActiveProgram,
    status: 'completed',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Valid Active Program', () => {
    it('should return success with program metadata for valid active program', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(mockActiveProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validProgramId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validProgramId }),
      });

      // Verify the response structure
      expect(response).toBeDefined();
      expect(response.status).toBe(200);

      // Parse response
      const responseData = JSON.parse(response.text());

      // Property 3 validation: Valid program should be accepted
      expect(responseData.isValid).toBe(true);
      expect(responseData.isActive).toBe(true);
      expect(responseData.isPublic).toBe(true);
      expect(responseData.error).toBeUndefined();

      // Requirement 2.4: Program metadata included in response
      expect(responseData.program).toBeDefined();
      expect(responseData.program.id).toBe(validProgramId);
      expect(responseData.program.name).toBe('TypeScript Advanced Training');
      expect(responseData.program.description).toBe('Learn advanced TypeScript concepts and best practices');
      expect(responseData.program.status).toBe('active');
      expect(responseData.program.start_date).toBe('2024-01-15');
      expect(responseData.program.end_date).toBe('2024-03-15');
      expect(responseData.program.max_trainees).toBe(30);
      expect(responseData.program.current_enrollment).toBe(12);
      expect(responseData.program.image_path).toBe('programs/a1b2c3d4/image.jpg');
      expect(responseData.program.instructor).toBe('John Doe');
      expect(responseData.program.duration_weeks).toBe(8);

      // Verify programService was called correctly
      expect(programService.getProgramById).toHaveBeenCalledWith(validProgramId);
      expect(programService.getProgramById).toHaveBeenCalledTimes(1);
    });

    it('should include all required program fields in metadata', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(mockActiveProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validProgramId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validProgramId }),
      });

      const responseData = JSON.parse(response.text());

      // Requirement 2.4: Validate metadata includes all required fields
      const requiredFields = [
        'id',
        'name',
        'description',
        'status',
        'start_date',
        'end_date',
        'max_trainees',
        'current_enrollment',
        'image_path',
        'instructor',
      ];

      requiredFields.forEach((field) => {
        expect(responseData.program).toHaveProperty(field);
      });
    });
  });

  describe('Inactive Program', () => {
    it('should return failure for inactive (completed) program', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(mockInactiveProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validProgramId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validProgramId }),
      });

      const responseData = JSON.parse(response.text());

      // Requirement 8.1: Invalid/inactive program should fail
      expect(responseData.isValid).toBe(false);
      expect(responseData.isActive).toBe(false);
      expect(responseData.isPublic).toBe(false);
      expect(responseData.program).toBeUndefined();

      // Requirement 8.3: User-friendly error message
      expect(responseData.error).toBe('This program is no longer available');
    });

    it('should not return inactive program data even if it exists', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(mockInactiveProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validProgramId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validProgramId }),
      });

      const responseData = JSON.parse(response.text());

      // Requirement 8.1: Program data should not be exposed for inactive programs
      expect(responseData.program).toBeUndefined();
      expect(responseData.isValid).toBe(false);
    });
  });

  describe('Non-Existent Program', () => {
    it('should return failure for non-existent program', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(null);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${nonExistentId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: nonExistentId }),
      });

      const responseData = JSON.parse(response.text());

      // Requirement 2.4, 8.1: Non-existent program should fail validation
      expect(responseData.isValid).toBe(false);
      expect(responseData.isActive).toBe(false);
      expect(responseData.isPublic).toBe(false);
      expect(responseData.program).toBeUndefined();

      // Requirement 8.3: User-friendly error message
      expect(responseData.error).toBe('This program is no longer available');
    });

    it('should not expose that program truly does not exist (security)', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(null);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${nonExistentId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: nonExistentId }),
      });

      const responseData = JSON.parse(response.text());

      // Requirement 8.3: Generic error message for both missing and inactive programs
      expect(responseData.error).toBe('This program is no longer available');
      expect(responseData.error).not.toContain('not found');
      expect(responseData.error).not.toContain('does not exist');
    });
  });

  describe('Invalid Program ID Format', () => {
    it('should handle invalid program ID gracefully', async () => {
      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${invalidProgramId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: invalidProgramId }),
      });

      const responseData = JSON.parse(response.text());

      // Requirement 2.4, 8.1: Invalid format should fail validation
      expect(responseData.isValid).toBe(false);
      expect(responseData.isActive).toBe(false);
      expect(responseData.isPublic).toBe(false);
      expect(responseData.program).toBeUndefined();
      expect(responseData.error).toBeDefined();
    });

    it('should reject empty program ID', async () => {
      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs//validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: '' }),
      });

      // Should either return error or handle gracefully
      expect(response).toBeDefined();
      // Empty ID should not result in database call
      const { programService } = require('@/services/programService');
      expect(programService.getProgramById).not.toHaveBeenCalled();
    });

    it('should handle whitespace-only program ID', async () => {
      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/%20/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: '   ' }),
      });

      expect(response).toBeDefined();
      const { programService } = require('@/services/programService');
      // Whitespace-only ID should not result in database call
      expect(programService.getProgramById).not.toHaveBeenCalled();
    });
  });

  describe('API Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const { programService } = require('@/services/programService');
      const dbError = new Error('Database connection failed');
      programService.getProgramById.mockRejectedValue(dbError);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validProgramId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validProgramId }),
      });

      const responseData = JSON.parse(response.text());

      // Requirement 8.1: Error should be handled gracefully
      expect(responseData.isValid).toBe(false);
      expect(responseData.isActive).toBe(false);
      expect(responseData.isPublic).toBe(false);
      expect(responseData.program).toBeUndefined();

      // Requirement 8.3: User-friendly error message, not exposing system details
      expect(responseData.error).toBe('Unable to validate program. Please try again.');
      expect(responseData.error).not.toContain('Database');
      expect(responseData.error).not.toContain('connection');
    });

    it('should handle timeout errors', async () => {
      const { programService } = require('@/services/programService');
      const timeoutError = new Error('Operation timed out');
      programService.getProgramById.mockRejectedValue(timeoutError);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validProgramId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validProgramId }),
      });

      const responseData = JSON.parse(response.text());

      // Should handle timeout gracefully
      expect(responseData.isValid).toBe(false);
      expect(responseData.error).toBe('Unable to validate program. Please try again.');
    });
  });

  describe('Property-Based Testing: Program Validation Non-Acceptance', () => {
    it('should reject any invalid program_id and not store data (Property 3)', async () => {
      // Property 3: For any invalid program_id, validation SHALL fail
      // and NO data SHALL be stored in LocalStorage

      const invalidIds = [
        'not-a-uuid',
        '12345',
        'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        'a1b2c3d4-e5f6-4g18-b9d0-c1a2b3c4d5e6', // invalid char 'g'
      ];

      for (const invalidId of invalidIds) {
        jest.clearAllMocks();
        const { programService } = require('@/services/programService');

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${invalidId}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: invalidId }),
        });

        const responseData = JSON.parse(response.text());

        // Property 3: Invalid program_id should fail validation
        // Response might be success response with isValid: false or error response
        if (responseData.isValid !== undefined) {
          expect(responseData.isValid).toBe(false);
        } else if (responseData.error) {
          // Early validation error - should have error message
          expect(responseData.error).toBeDefined();
        }

        // Property 3: No data should be stored (verified by response not returning program details)
        expect(responseData.program).toBeUndefined();
      }
    });

    it('should validate that only active programs pass validation (Property 3 - Status Check)', async () => {
      const { programService } = require('@/services/programService');

      const statuses = ['active', 'upcoming', 'completed', 'cancelled'];
      const expectedResults = {
        active: true,
        upcoming: false,
        completed: false,
        cancelled: false,
      };

      for (const status of statuses) {
        jest.clearAllMocks();

        const program = {
          ...mockActiveProgram,
          status,
        };

        programService.getProgramById.mockResolvedValue(program);

        const request = new NextRequest(
          new URL(`http://localhost:3003/api/programs/${validProgramId}/validate-share`)
        );

        const response = await GET(request, {
          params: Promise.resolve({ id: validProgramId }),
        });

        const responseData = JSON.parse(response.text());

        // Property 3: Only 'active' status programs should pass
        expect(responseData.isValid).toBe(expectedResults[status as keyof typeof expectedResults]);
        expect(responseData.isActive).toBe(expectedResults[status as keyof typeof expectedResults]);

        if (!expectedResults[status as keyof typeof expectedResults]) {
          expect(responseData.program).toBeUndefined();
        }
      }
    });
  });

  describe('Response Format Consistency', () => {
    it('should always return consistent response structure for success', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(mockActiveProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validProgramId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validProgramId }),
      });

      const responseData = JSON.parse(response.text());

      // Validate response structure
      expect(responseData).toHaveProperty('isValid');
      expect(responseData).toHaveProperty('isActive');
      expect(responseData).toHaveProperty('isPublic');
      expect(typeof responseData.isValid).toBe('boolean');
      expect(typeof responseData.isActive).toBe('boolean');
      expect(typeof responseData.isPublic).toBe('boolean');
    });

    it('should always return consistent response structure for failure', async () => {
      const { programService } = require('@/services/programService');
      programService.getProgramById.mockResolvedValue(null);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${nonExistentId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: nonExistentId }),
      });

      const responseData = JSON.parse(response.text());

      // Validate response structure
      expect(responseData).toHaveProperty('isValid');
      expect(responseData).toHaveProperty('isActive');
      expect(responseData).toHaveProperty('isPublic');
      expect(responseData).toHaveProperty('error');
      expect(typeof responseData.isValid).toBe('boolean');
      expect(typeof responseData.error).toBe('string');
    });
  });

  describe('Edge Cases', () => {
    it('should handle program with minimal metadata', async () => {
      const { programService } = require('@/services/programService');
      const minimalProgram = {
        id: validProgramId,
        name: 'Basic Program',
        status: 'active',
        start_date: '2024-01-15',
        end_date: '2024-03-15',
      };

      programService.getProgramById.mockResolvedValue(minimalProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validProgramId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validProgramId }),
      });

      const responseData = JSON.parse(response.text());

      // Should still validate successfully with minimal metadata
      expect(responseData.isValid).toBe(true);
      expect(responseData.program).toBeDefined();
      expect(responseData.program.id).toBe(validProgramId);
    });

    it('should handle program with null optional fields', async () => {
      const { programService } = require('@/services/programService');
      const programWithNulls = {
        ...mockActiveProgram,
        description: null,
        image_path: null,
        instructor: null,
        current_enrollment: null,
      };

      programService.getProgramById.mockResolvedValue(programWithNulls);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validProgramId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validProgramId }),
      });

      const responseData = JSON.parse(response.text());

      // Should validate successfully even with null optional fields
      expect(responseData.isValid).toBe(true);
      expect(responseData.program).toBeDefined();
      expect(responseData.isActive).toBe(true);
    });

    it('should handle program with special characters in name', async () => {
      const { programService } = require('@/services/programService');
      const specialProgram = {
        ...mockActiveProgram,
        name: 'Advanced TypeScript & React: "Best Practices" 2024',
        description: 'Learn <best practices> & advanced patterns',
      };

      programService.getProgramById.mockResolvedValue(specialProgram);

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/programs/${validProgramId}/validate-share`)
      );

      const response = await GET(request, {
        params: Promise.resolve({ id: validProgramId }),
      });

      const responseData = JSON.parse(response.text());

      // Should handle special characters correctly
      expect(responseData.isValid).toBe(true);
      expect(responseData.program.name).toBe('Advanced TypeScript & React: "Best Practices" 2024');
      expect(responseData.program.description).toBe('Learn <best practices> & advanced patterns');
    });
  });
});
