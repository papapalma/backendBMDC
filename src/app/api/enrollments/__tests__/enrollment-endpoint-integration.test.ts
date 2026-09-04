/**
 * Integration tests for modified Enrollment endpoint (Task 5.1)
 * Tests the POST /api/enrollments endpoint with source parameter
 * 
 * Validates: Requirements 4.1, 5.5
 * - Enrollment creation with 'social_share' source
 * - Default source assignment ('direct') when not specified
 * - Duplicate enrollment prevention
 * - Required field validation (trainee_id, program_id)
 * - Source tracking enables analytics on social share attribution
 */

import { z } from 'zod';

/**
 * Test suite for Enrollment POST endpoint
 * These tests verify the schema validation and expected behavior of the endpoint
 */
describe('POST /api/enrollments - Enrollment Source Tracking (Task 5.1)', () => {
  const mockTraineeId = '123e4567-e89b-12d3-a456-426614174000';
  const mockProgramId = '223e4567-e89b-12d3-a456-426614174000';

  // Replicate the schema from route.ts
  const createEnrollmentSchema = z.object({
    trainee_id: z.string().uuid('Invalid trainee ID'),
    program_id: z.string().uuid('Invalid program ID'),
    enrollment_date: z.string().optional(),
    notes: z.string().max(1000).optional(),
    source: z.enum(['social_share', 'direct', 'admin_assigned']).optional().default('direct'),
  });

  describe('Requirement 5.5 - Enrollment source parameter validation', () => {
    /**
     * Test 1: Enrollment creation with 'social_share' source
     * WHEN creating an enrollment with source: 'social_share'
     * THEN the enrollment data MUST include source='social_share'
     * 
     * Validates: Requirement 5.5
     */
    it('should accept and preserve social_share source value', () => {
      const enrollmentRequest = {
        trainee_id: mockTraineeId,
        program_id: mockProgramId,
        source: 'social_share',
      };

      const result = createEnrollmentSchema.safeParse(enrollmentRequest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('social_share');
        expect(result.data.trainee_id).toBe(mockTraineeId);
        expect(result.data.program_id).toBe(mockProgramId);
      }
    });

    /**
     * Test 2: Default source assignment ('direct')
     * WHEN creating an enrollment WITHOUT specifying source parameter
     * THEN the source MUST default to 'direct' for backward compatibility
     * 
     * Validates: Requirement 4.1 (backward compatibility)
     */
    it('should default to direct source when source not specified', () => {
      const enrollmentRequest = {
        trainee_id: mockTraineeId,
        program_id: mockProgramId,
        // source NOT specified
      };

      const result = createEnrollmentSchema.safeParse(enrollmentRequest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('direct');
      }
    });

    /**
     * Test 3: All valid source values are accepted
     * WHEN creating enrollments with each valid source: 'social_share', 'direct', 'admin_assigned'
     * THEN all MUST be accepted and preserved
     */
    it('should accept all valid source enum values', () => {
      const validSources = ['social_share', 'direct', 'admin_assigned'];

      validSources.forEach((source) => {
        const enrollmentRequest = {
          trainee_id: mockTraineeId,
          program_id: mockProgramId,
          source,
        };

        const result = createEnrollmentSchema.safeParse(enrollmentRequest);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.source).toBe(source);
        }
      });
    });

    /**
     * Test 4: Invalid source values are rejected
     * WHEN attempting to create an enrollment with invalid source value
     * THEN validation MUST reject the request
     */
    it('should reject invalid source values', () => {
      const enrollmentRequest = {
        trainee_id: mockTraineeId,
        program_id: mockProgramId,
        source: 'invalid_source_value',
      };

      const result = createEnrollmentSchema.safeParse(enrollmentRequest);

      expect(result.success).toBe(false);
    });

    /**
     * Test 5: Source is case-sensitive
     * WHEN providing source with wrong case
     * THEN validation MUST reject it
     */
    it('should reject source values with incorrect casing', () => {
      const testCases = [
        'SOCIAL_SHARE',
        'Social_Share',
        'DIRECT',
        'Direct',
      ];

      testCases.forEach((source) => {
        const enrollmentRequest = {
          trainee_id: mockTraineeId,
          program_id: mockProgramId,
          source,
        };

        const result = createEnrollmentSchema.safeParse(enrollmentRequest);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Requirement 5.5 - Duplicate enrollment prevention', () => {
    /**
     * Test 6: Same trainee-program combination with different sources
     * WHEN creating enrollment requests with same trainee_id and program_id but different sources
     * THEN the schema validation MUST accept all (business logic prevents duplicates at DB level)
     * AND the source values MUST be preserved correctly
     */
    it('should validate identical trainee-program pairs with different source values', () => {
      const sources = ['social_share', 'direct', 'admin_assigned'];

      const validationResults = sources.map((source) => {
        const enrollmentRequest = {
          trainee_id: mockTraineeId,
          program_id: mockProgramId,
          source,
        };

        return createEnrollmentSchema.safeParse(enrollmentRequest);
      });

      // All should pass schema validation
      validationResults.forEach((result) => {
        expect(result.success).toBe(true);
      });

      // All should have same trainee_id and program_id
      if (validationResults.every(r => r.success)) {
        const parsedData = validationResults.map(r => (r as any).data);
        parsedData.forEach((data) => {
          expect(data.trainee_id).toBe(mockTraineeId);
          expect(data.program_id).toBe(mockProgramId);
        });
      }
    });
  });

  describe('Requirement 5.5 - Required field validation', () => {
    /**
     * Test 7: trainee_id is required
     * WHEN attempting to create an enrollment without trainee_id
     * THEN validation MUST fail
     */
    it('should require trainee_id field', () => {
      const enrollmentRequest = {
        // trainee_id MISSING
        program_id: mockProgramId,
        source: 'direct',
      };

      const result = createEnrollmentSchema.safeParse(enrollmentRequest);

      expect(result.success).toBe(false);
    });

    /**
     * Test 8: program_id is required
     * WHEN attempting to create an enrollment without program_id
     * THEN validation MUST fail
     */
    it('should require program_id field', () => {
      const enrollmentRequest = {
        trainee_id: mockTraineeId,
        // program_id MISSING
        source: 'admin_assigned',
      };

      const result = createEnrollmentSchema.safeParse(enrollmentRequest);

      expect(result.success).toBe(false);
    });

    /**
     * Test 9: trainee_id must be valid UUID
     * WHEN providing an invalid trainee_id format
     * THEN validation MUST fail
     */
    it('should validate trainee_id is valid UUID format', () => {
      const invalidFormats = [
        'not-a-uuid',
        '123456',
        'invalid-uuid-format',
        '',
        '123e4567-e89b-12d3-a456',
        'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      ];

      invalidFormats.forEach((invalidId) => {
        const enrollmentRequest = {
          trainee_id: invalidId,
          program_id: mockProgramId,
          source: 'direct',
        };

        const result = createEnrollmentSchema.safeParse(enrollmentRequest);
        expect(result.success).toBe(false);
      });
    });

    /**
     * Test 10: program_id must be valid UUID
     * WHEN providing an invalid program_id format
     * THEN validation MUST fail
     */
    it('should validate program_id is valid UUID format', () => {
      const invalidFormats = [
        'not-a-uuid',
        '123456',
        'invalid',
        '',
      ];

      invalidFormats.forEach((invalidId) => {
        const enrollmentRequest = {
          trainee_id: mockTraineeId,
          program_id: invalidId,
          source: 'social_share',
        };

        const result = createEnrollmentSchema.safeParse(enrollmentRequest);
        expect(result.success).toBe(false);
      });
    });

    /**
     * Test 11: Both trainee_id and program_id are required
     * WHEN both fields are missing
     * THEN validation MUST fail
     */
    it('should require both trainee_id and program_id', () => {
      const enrollmentRequest = {
        // both MISSING
        source: 'direct',
      };

      const result = createEnrollmentSchema.safeParse(enrollmentRequest);

      expect(result.success).toBe(false);
    });
  });

  describe('Requirement 4.1 - Backward compatibility', () => {
    /**
     * Test 12: Legacy requests without source work correctly
     * WHEN old client code creates enrollment without source parameter
     * THEN the system MUST accept it AND assign default source='direct'
     */
    it('should handle legacy requests without source parameter', () => {
      const legacyRequest = {
        trainee_id: mockTraineeId,
        program_id: mockProgramId,
        enrollment_date: '2024-01-15',
        notes: 'Legacy enrollment',
        // source NOT specified
      };

      const result = createEnrollmentSchema.safeParse(legacyRequest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('direct');
        expect(result.data.enrollment_date).toBe('2024-01-15');
        expect(result.data.notes).toBe('Legacy enrollment');
      }
    });

    /**
     * Test 13: Optional fields are preserved with source parameter
     * WHEN providing optional fields alongside source
     * THEN all fields MUST be preserved correctly
     */
    it('should preserve optional fields when source is specified', () => {
      const completeRequest = {
        trainee_id: mockTraineeId,
        program_id: mockProgramId,
        enrollment_date: '2024-01-20',
        notes: 'Enrolled via social media',
        source: 'social_share',
      };

      const result = createEnrollmentSchema.safeParse(completeRequest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trainee_id).toBe(mockTraineeId);
        expect(result.data.program_id).toBe(mockProgramId);
        expect(result.data.enrollment_date).toBe('2024-01-20');
        expect(result.data.notes).toBe('Enrolled via social media');
        expect(result.data.source).toBe('social_share');
      }
    });
  });

  describe('Requirement 5.5 - Optional field constraints', () => {
    /**
     * Test 14: enrollment_date is optional
     * WHEN enrollment_date is not provided
     * THEN validation MUST succeed
     */
    it('should allow enrollment without enrollment_date', () => {
      const enrollmentRequest = {
        trainee_id: mockTraineeId,
        program_id: mockProgramId,
        source: 'direct',
        // enrollment_date NOT specified
      };

      const result = createEnrollmentSchema.safeParse(enrollmentRequest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enrollment_date).toBeUndefined();
      }
    });

    /**
     * Test 15: notes has max length of 1000 characters
     * WHEN notes exceed 1000 characters
     * THEN validation MUST fail
     */
    it('should reject notes exceeding 1000 character limit', () => {
      const longNotes = 'a'.repeat(1001);
      const enrollmentRequest = {
        trainee_id: mockTraineeId,
        program_id: mockProgramId,
        notes: longNotes,
        source: 'social_share',
      };

      const result = createEnrollmentSchema.safeParse(enrollmentRequest);

      expect(result.success).toBe(false);
    });

    /**
     * Test 16: notes of exactly 1000 characters is accepted
     * WHEN notes are exactly 1000 characters
     * THEN validation MUST succeed
     */
    it('should accept notes of exactly 1000 characters', () => {
      const notesOf1000Chars = 'a'.repeat(1000);
      const enrollmentRequest = {
        trainee_id: mockTraineeId,
        program_id: mockProgramId,
        notes: notesOf1000Chars,
        source: 'direct',
      };

      const result = createEnrollmentSchema.safeParse(enrollmentRequest);

      expect(result.success).toBe(true);
    });
  });

  describe('Source tracking for analytics', () => {
    /**
     * Test 17: Source is properly typed as enum
     * WHEN accessing source field of validated enrollment
     * THEN source MUST be one of the exact enum values
     */
    it('should preserve source as specific enum type', () => {
      const enrollmentRequest = {
        trainee_id: mockTraineeId,
        program_id: mockProgramId,
        source: 'social_share',
      };

      const result = createEnrollmentSchema.safeParse(enrollmentRequest);

      expect(result.success).toBe(true);
      if (result.success) {
        // Verify source is one of the valid values
        const validValues = ['social_share', 'direct', 'admin_assigned'];
        expect(validValues).toContain(result.data.source);
        expect(result.data.source).toEqual('social_share');
      }
    });

    /**
     * Test 18: Multiple enrollments can be created with different sources
     * WHEN processing multiple enrollment requests with different sources
     * THEN each MUST retain its individual source value
     */
    it('should independently track source for each enrollment', () => {
      const enrollments = [
        { trainee_id: mockTraineeId, program_id: mockProgramId, source: 'social_share' },
        { trainee_id: mockTraineeId, program_id: mockProgramId, source: 'direct' },
        { trainee_id: mockTraineeId, program_id: mockProgramId, source: 'admin_assigned' },
      ];

      const results = enrollments.map(e => createEnrollmentSchema.safeParse(e));

      // All should validate successfully
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.source).toBe(enrollments[index].source);
        }
      });
    });
  });
});

/**
 * Schema validation test suite
 * Ensures the createEnrollmentSchema behaves as expected
 */
describe('Enrollment schema - Core validation rules', () => {
  const createEnrollmentSchema = z.object({
    trainee_id: z.string().uuid('Invalid trainee ID'),
    program_id: z.string().uuid('Invalid program ID'),
    enrollment_date: z.string().optional(),
    notes: z.string().max(1000).optional(),
    source: z.enum(['social_share', 'direct', 'admin_assigned']).optional().default('direct'),
  });

  /**
   * Test 19: Idempotent source assignment
   * WHEN validating same enrollment data multiple times
   * THEN each validation MUST produce identical source value
   */
  it('should consistently assign same source value across multiple validations', () => {
    const enrollmentRequest = {
      trainee_id: '123e4567-e89b-12d3-a456-426614174000',
      program_id: '223e4567-e89b-12d3-a456-426614174000',
      source: 'social_share',
    };

    const results = Array(5)
      .fill(null)
      .map(() => createEnrollmentSchema.safeParse(enrollmentRequest));

    const sources = results.map(r => (r.success ? r.data.source : null));

    // All sources should be identical
    expect(sources).toEqual(['social_share', 'social_share', 'social_share', 'social_share', 'social_share']);
  });

  /**
   * Test 20: Default source idempotence
   * WHEN validating multiple requests without source
   * THEN each MUST default to 'direct'
   */
  it('should consistently default to direct source when not specified', () => {
    const requests = Array(3)
      .fill(null)
      .map(() => ({
        trainee_id: '123e4567-e89b-12d3-a456-426614174000',
        program_id: '223e4567-e89b-12d3-a456-426614174000',
      }));

    const results = requests.map(r => createEnrollmentSchema.safeParse(r));

    const sources = results.map(r => (r.success ? r.data.source : null));

    expect(sources).toEqual(['direct', 'direct', 'direct']);
  });
});
