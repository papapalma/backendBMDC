/**
 * Unit tests for Program Validation endpoint
 * GET /api/programs/:id/validate-share
 *
 * Tests validation of program existence, status, and public availability
 * Property 3: Program Validation Non-Acceptance — Invalid program_id fails validation and no data stored
 * **Validates: Requirements 2.1, 2.3, 2.4, 8.1**
 */

import { NextRequest } from 'next/server';
import { GET } from './route';
import { programService } from '@/services/programService';

// Mock dependencies
jest.mock('@/services/programService');
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));

describe('GET /api/programs/:id/validate-share', () => {
  let mockRequest: Partial<NextRequest>;
  let mockProgram: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock program data - a valid active program
    mockProgram = {
      id: 'prog-uuid-1234',
      name: 'Advanced JavaScript Training',
      description: 'Learn modern JavaScript with ES6+ features',
      status: 'active',
      tenant_id: 'tenant-uuid-5678',
      image_path: 'programs/prog-uuid-1234/image.jpg',
      thumbnail_path: 'programs/prog-uuid-1234/thumb.jpg',
      start_date: '2024-01-15',
      end_date: '2024-03-15',
      max_trainees: 30,
      current_enrollment: 12,
      instructor: 'John Doe',
      duration_weeks: 8,
    };

    // Mock request
    mockRequest = {
      url: 'http://localhost:3003/api/programs/prog-uuid-1234/validate-share',
    } as any;
  });

  describe('Valid Program Validation', () => {
    it('should return isValid=true for an active program', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.isValid).toBe(true);
      expect(data.data.isActive).toBe(true);
      expect(data.data.isPublic).toBe(true);
    });

    it('should return complete program metadata on successful validation', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.program).toBeDefined();
      expect(data.data.program.id).toBe('prog-uuid-1234');
      expect(data.data.program.name).toBe('Advanced JavaScript Training');
      expect(data.data.program.description).toBe('Learn modern JavaScript with ES6+ features');
      expect(data.data.program.status).toBe('active');
    });

    it('should include enrollment information in response', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.program.max_trainees).toBe(30);
      expect(data.data.program.current_enrollment).toBe(12);
    });

    it('should include dates in program metadata', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.program.start_date).toBe('2024-01-15');
      expect(data.data.program.end_date).toBe('2024-03-15');
    });

    it('should include image paths in program metadata', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.program.image_path).toBeDefined();
      expect(data.data.program.thumbnail_path).toBeDefined();
    });

    it('should include instructor information in program metadata', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.program.instructor).toBe('John Doe');
    });

    it('should handle programs without image_path gracefully', async () => {
      const progNoImage = { ...mockProgram, image_path: null, thumbnail_path: null };
      (programService.getProgramById as jest.Mock).mockResolvedValue(progNoImage);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.isValid).toBe(true);
      expect(data.data.program.image_path).toBeNull();
    });

    it('should handle programs without description gracefully', async () => {
      const progNoDesc = { ...mockProgram, description: null };
      (programService.getProgramById as jest.Mock).mockResolvedValue(progNoDesc);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.isValid).toBe(true);
    });
  });

  describe('Non-Existent Program (Requirement 8.1)', () => {
    it('should return isValid=false when program not found', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(null);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent-id' }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.isValid).toBe(false);
      expect(data.data.isActive).toBe(false);
      expect(data.data.isPublic).toBe(false);
    });

    it('should return user-friendly error message for non-existent program', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(null);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent-id' }) }
      );

      const data = await response.json();
      expect(data.data.error).toBe('This program is no longer available');
    });

    it('should not include program data when program not found', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(null);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent-id' }) }
      );

      const data = await response.json();
      expect(data.data.program).toBeUndefined();
    });

    it('should not throw error but return structured response for non-existent program', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(null);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent-id' }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('data');
    });
  });

  describe('Invalid Program Status (Requirement 2.3)', () => {
    it('should return isValid=false when program is completed', async () => {
      const completedProgram = { ...mockProgram, status: 'completed' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(completedProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.isValid).toBe(false);
      expect(data.data.isActive).toBe(false);
      expect(data.data.isPublic).toBe(false);
    });

    it('should return isValid=false when program is upcoming', async () => {
      const upcomingProgram = { ...mockProgram, status: 'upcoming' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(upcomingProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.isValid).toBe(false);
      expect(data.data.isActive).toBe(false);
    });

    it('should return isValid=false when program is cancelled', async () => {
      const cancelledProgram = { ...mockProgram, status: 'cancelled' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(cancelledProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.isValid).toBe(false);
      expect(data.data.isActive).toBe(false);
    });

    it('should return user-friendly error message for inactive program', async () => {
      const inactiveProgram = { ...mockProgram, status: 'completed' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(inactiveProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.error).toBe('This program is no longer available');
    });

    it('should not include program data when status is invalid', async () => {
      const inactiveProgram = { ...mockProgram, status: 'completed' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(inactiveProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.program).toBeUndefined();
    });
  });

  describe('Public Availability (Requirement 2.4)', () => {
    it('should return isPublic=true for active programs', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.isPublic).toBe(true);
    });

    it('should not return isPublic=true for inactive programs', async () => {
      const inactiveProgram = { ...mockProgram, status: 'completed' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(inactiveProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.isPublic).toBe(false);
    });
  });

  describe('Public Endpoint - No Authentication Required', () => {
    it('should work without authentication headers', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      // Request with no auth headers
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should not require tenant context', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      // Verify programService was called without tenantId (public access)
      expect(programService.getProgramById).toHaveBeenCalledWith('prog-uuid-1234');
      const args = (programService.getProgramById as jest.Mock).mock.calls[0];
      expect(args.length).toBe(1); // Only program ID, no tenantId
    });
  });

  describe('Invalid Input Handling (Requirement 2.1)', () => {
    it('should return 400 for empty program ID', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: '' }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Invalid program ID');
    });

    it('should return 400 for whitespace-only program ID', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: '   ' }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });

    it('should return 400 for null program ID', async () => {
      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: null as any }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      (programService.getProgramById as jest.Mock).mockRejectedValue(dbError);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.isValid).toBe(false);
      expect(data.data.error).toBe('Unable to validate program. Please try again.');
    });

    it('should not expose internal error details to client', async () => {
      const dbError = new Error('Internal database connection pool exhausted');
      (programService.getProgramById as jest.Mock).mockRejectedValue(dbError);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.error).not.toContain('pool exhausted');
      expect(data.data.error).not.toContain('database');
    });

    it('should return structured response even on error', async () => {
      const dbError = new Error('Some error');
      (programService.getProgramById as jest.Mock).mockRejectedValue(dbError);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('isValid');
      expect(data.data).toHaveProperty('error');
    });
  });

  describe('Response Structure Validation', () => {
    it('should return HTTP 200 on success', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      expect(response.status).toBe(200);
    });

    it('should return standard API response structure', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
    });

    it('should include all required validation fields in response', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data).toHaveProperty('isValid');
      expect(data.data).toHaveProperty('isActive');
      expect(data.data).toHaveProperty('isPublic');
    });

    it('should include program data when validation succeeds', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data).toHaveProperty('program');
      expect(data.data.program).toHaveProperty('id');
      expect(data.data.program).toHaveProperty('name');
    });

    it('should omit program data when validation fails', async () => {
      const inactiveProgram = { ...mockProgram, status: 'completed' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(inactiveProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.program).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle program with UUID format', async () => {
      const uuidProgram = {
        ...mockProgram,
        id: 'a1b2c3d4-e5f6-47a8-b9c0-d1e2f3g4h5i6',
      };
      (programService.getProgramById as jest.Mock).mockResolvedValue(uuidProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'a1b2c3d4-e5f6-47a8-b9c0-d1e2f3g4h5i6' }) }
      );

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.isValid).toBe(true);
    });

    it('should handle program with very long description', async () => {
      const longDesc = 'A'.repeat(5000);
      const progLongDesc = { ...mockProgram, description: longDesc };
      (programService.getProgramById as jest.Mock).mockResolvedValue(progLongDesc);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.isValid).toBe(true);
      expect(data.data.program.description.length).toBe(5000);
    });

    it('should handle program with special characters in name', async () => {
      const specialProgram = {
        ...mockProgram,
        name: 'C++ & Data Structures (2024) — Advanced',
      };
      (programService.getProgramById as jest.Mock).mockResolvedValue(specialProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.program.name).toContain('C++');
    });

    it('should handle program with zero current_enrollment', async () => {
      const emptyProgram = { ...mockProgram, current_enrollment: 0 };
      (programService.getProgramById as jest.Mock).mockResolvedValue(emptyProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.program.current_enrollment).toBe(0);
    });

    it('should handle program with full enrollment capacity', async () => {
      const fullProgram = {
        ...mockProgram,
        max_trainees: 30,
        current_enrollment: 30,
      };
      (programService.getProgramById as jest.Mock).mockResolvedValue(fullProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.isValid).toBe(true);
      expect(data.data.program.current_enrollment).toBe(30);
    });
  });

  describe('Property 3: Program Validation Non-Acceptance', () => {
    it('Property: Invalid program_id should fail validation', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(null);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'invalid-uuid-that-doesnt-exist' }) }
      );

      const data = await response.json();
      expect(data.data.isValid).toBe(false);
      expect(data.data.program).toBeUndefined();
    });

    it('Property: Inactive program_id should fail validation', async () => {
      const inactiveProgram = { ...mockProgram, status: 'completed' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(inactiveProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.isValid).toBe(false);
      expect(data.data.isActive).toBe(false);
    });

    it('Property: Cancelled program_id should fail validation', async () => {
      const cancelledProgram = { ...mockProgram, status: 'cancelled' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(cancelledProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.isValid).toBe(false);
    });

    it('Property: Error during validation should still return structured failure response', async () => {
      (programService.getProgramById as jest.Mock).mockRejectedValue(
        new Error('Unexpected error')
      );

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.isValid).toBe(false);
      expect(data.data.program).toBeUndefined();
    });
  });

  describe('Requirements Coverage', () => {
    it('Requirement 2.1: Endpoint extracts program details from database', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(programService.getProgramById).toHaveBeenCalledWith('prog-uuid-1234');
      expect(data.data.program).toBeDefined();
    });

    it('Requirement 2.3: Endpoint checks program status is active', async () => {
      const inactiveProgram = { ...mockProgram, status: 'completed' };
      (programService.getProgramById as jest.Mock).mockResolvedValue(inactiveProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.isActive).toBe(false);
      expect(data.data.isValid).toBe(false);
    });

    it('Requirement 2.4: Endpoint returns validation result with metadata', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(mockProgram);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'prog-uuid-1234' }) }
      );

      const data = await response.json();
      expect(data.data.isValid).toBe(true);
      expect(data.data.program).toBeDefined();
      expect(data.data.program.name).toBeDefined();
      expect(data.data.program.description).toBeDefined();
    });

    it('Requirement 8.1: Endpoint returns user-friendly error for invalid program', async () => {
      (programService.getProgramById as jest.Mock).mockResolvedValue(null);

      const response = await GET(
        mockRequest as NextRequest,
        { params: Promise.resolve({ id: 'invalid-id' }) }
      );

      const data = await response.json();
      expect(data.data.error).toBe('This program is no longer available');
    });
  });
});
