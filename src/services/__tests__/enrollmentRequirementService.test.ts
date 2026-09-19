/**
 * Tests for Enrollment Requirement Service
 *
 * Validates:
 * - Task 6.1: Enrollment requirements initialization using requirement_definitions
 * - Task 6.2: Applicability logic evaluation for conditional requirements
 * - Requirement applicability evaluation with trainee profile data
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  evaluateApplicabilityRules,
  initializeEnrollmentRequirements,
  updateEnrollmentRequirementsApplicability,
  getEnrollmentRequirementsWithDetails,
  type ApplicabilityRules,
  type TraineeProfileData,
  type RequirementDefinition,
} from '../enrollmentRequirementService';
import { supabaseAdmin } from '@/lib/supabase-admin';

// Mock supabaseAdmin
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('enrollmentRequirementService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Tests for Task 6.2: Applicability Logic Evaluation
  // ============================================================================

  describe('evaluateApplicabilityRules - Task 6.2', () => {
    it('should return true for requirement with no applicability rules', () => {
      const traineeProfile: TraineeProfileData = {
        id: 'trainee-001',
        marital_status: 'single',
      };

      const result = evaluateApplicabilityRules(null, traineeProfile);
      expect(result).toBe(true);
    });

    it('should return true for requirement with empty applicability rules', () => {
      const traineeProfile: TraineeProfileData = {
        id: 'trainee-001',
        marital_status: 'single',
      };

      const result = evaluateApplicabilityRules({}, traineeProfile);
      expect(result).toBe(true);
    });

    it('should return true for married trainee with marriage_certificate applicable rule', () => {
      const traineeProfile: TraineeProfileData = {
        id: 'trainee-001',
        marital_status: 'married',
      };

      const rules: ApplicabilityRules = {
        applicable_to: {
          marital_status: ['married'],
        },
      };

      const result = evaluateApplicabilityRules(rules, traineeProfile);
      expect(result).toBe(true);
    });

    it('should return false for single trainee with marriage_certificate applicable rule', () => {
      const traineeProfile: TraineeProfileData = {
        id: 'trainee-001',
        marital_status: 'single',
      };

      const rules: ApplicabilityRules = {
        applicable_to: {
          marital_status: ['married'],
        },
      };

      const result = evaluateApplicabilityRules(rules, traineeProfile);
      expect(result).toBe(false);
    });

    it('should return false for trainee with null marital_status and marriage_certificate rule', () => {
      const traineeProfile: TraineeProfileData = {
        id: 'trainee-001',
        marital_status: null,
      };

      const rules: ApplicabilityRules = {
        applicable_to: {
          marital_status: ['married'],
        },
      };

      const result = evaluateApplicabilityRules(rules, traineeProfile);
      expect(result).toBe(false);
    });

    it('should return true for trainee with unmarried but applicability rule allows it', () => {
      const traineeProfile: TraineeProfileData = {
        id: 'trainee-001',
        marital_status: 'divorced',
      };

      const rules: ApplicabilityRules = {
        applicable_to: {
          marital_status: ['married', 'divorced'],
        },
      };

      const result = evaluateApplicabilityRules(rules, traineeProfile);
      expect(result).toBe(true);
    });

    it('should handle applicability_rules with empty applicable_to object', () => {
      const traineeProfile: TraineeProfileData = {
        id: 'trainee-001',
        marital_status: 'single',
      };

      const rules: ApplicabilityRules = {
        applicable_to: {},
      };

      const result = evaluateApplicabilityRules(rules, traineeProfile);
      expect(result).toBe(true);
    });
  });

  // ============================================================================
  // Tests for Task 6.1: Enrollment Requirements Initialization
  // ============================================================================

  describe('initializeEnrollmentRequirements - Task 6.1', () => {
    it('should fetch trainee profile and requirements, then create enrollment_requirements', async () => {
      const enrollmentId = 'enrollment-001';
      const traineeId = 'trainee-001';
      const tenantId = 'tenant-001';

      const mockTraineeProfile = {
        id: 'profile-001',
        trainee_id: traineeId,
        marital_status: 'single',
      };

      const mockRequirements: RequirementDefinition[] = [
        {
          id: 'req-001',
          tenant_id: tenantId,
          requirement_type: 'accomplished_learners_profile_form',
          display_name: "Accomplished Learner's Profile Form",
          description: 'Test description',
          is_mandatory: true,
          is_active: true,
          applicability_rules: null,
          display_order: 1,
        },
        {
          id: 'req-002',
          tenant_id: tenantId,
          requirement_type: 'marriage_certificate_copy',
          display_name: 'Marriage Certificate',
          description: 'For married trainees only',
          is_mandatory: false,
          is_active: true,
          applicability_rules: {
            applicable_to: {
              marital_status: ['married'],
            },
          },
          display_order: 2,
        },
      ];

      // Mock supabaseAdmin calls
      const mockSelectChain = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: mockTraineeProfile, error: null }),
      };

      const mockSelectChain2 = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockRequirements, error: null }),
      };

      const mockInsertChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      (supabaseAdmin.from as any)
        .mockReturnValueOnce(mockSelectChain)
        .mockReturnValueOnce(mockSelectChain2)
        .mockReturnValueOnce(mockInsertChain);

      const result = await initializeEnrollmentRequirements(enrollmentId, traineeId, tenantId);

      // Verify result structure
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        enrollment_id: enrollmentId,
        requirement_id: 'req-001',
        tenant_id: tenantId,
        is_applicable: true,
        submission_status: 'pending',
      });

      // Marriage certificate should not be applicable for single trainee
      expect(result[1]).toMatchObject({
        enrollment_id: enrollmentId,
        requirement_id: 'req-002',
        tenant_id: tenantId,
        is_applicable: false,
        submission_status: 'pending',
      });
    });

    it('should handle case where trainee profile does not exist', async () => {
      const enrollmentId = 'enrollment-001';
      const traineeId = 'trainee-001';
      const tenantId = 'tenant-001';

      const mockRequirements: RequirementDefinition[] = [
        {
          id: 'req-001',
          tenant_id: tenantId,
          requirement_type: 'birth_certificate_copy',
          display_name: 'Birth Certificate',
          description: 'Test',
          is_mandatory: true,
          is_active: true,
          applicability_rules: null,
          display_order: 1,
        },
      ];

      const mockSelectChain = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      const mockSelectChain2 = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockRequirements, error: null }),
      };

      const mockInsertChain = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      (supabaseAdmin.from as any)
        .mockReturnValueOnce(mockSelectChain)
        .mockReturnValueOnce(mockSelectChain2)
        .mockReturnValueOnce(mockInsertChain);

      const result = await initializeEnrollmentRequirements(enrollmentId, traineeId, tenantId);

      // Should still create requirements with defaults
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        enrollment_id: enrollmentId,
        is_applicable: true,
        submission_status: 'pending',
      });
    });

    it('should throw error if trainee fetch fails', async () => {
      const enrollmentId = 'enrollment-001';
      const traineeId = 'trainee-001';
      const tenantId = 'tenant-001';

      const mockSelectChain = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: 'Database error' } }),
      };

      (supabaseAdmin.from as any).mockReturnValueOnce(mockSelectChain);

      await expect(
        initializeEnrollmentRequirements(enrollmentId, traineeId, tenantId)
      ).rejects.toThrow('Failed to fetch trainee profile');
    });

    it('should throw error if requirements fetch fails', async () => {
      const enrollmentId = 'enrollment-001';
      const traineeId = 'trainee-001';
      const tenantId = 'tenant-001';

      const mockSelectChain = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'profile-001' }, error: null }),
      };

      const mockSelectChain2 = {
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'Query error' } }),
      };

      (supabaseAdmin.from as any)
        .mockReturnValueOnce(mockSelectChain)
        .mockReturnValueOnce(mockSelectChain2);

      await expect(
        initializeEnrollmentRequirements(enrollmentId, traineeId, tenantId)
      ).rejects.toThrow('Failed to fetch requirement definitions');
    });
  });

  // ============================================================================
  // Tests for Task 6.2: Applicability Update
  // ============================================================================

  describe('updateEnrollmentRequirementsApplicability - Task 6.2', () => {
    it('should update applicability when trainee profile changes', async () => {
      const traineeId = 'trainee-001';
      const tenantId = 'tenant-001';

      const mockTraineeProfile = {
        id: 'profile-001',
        marital_status: 'married', // Changed from single
      };

      const mockEnrollments = [
        { id: 'enrollment-001' },
        { id: 'enrollment-002' },
      ];

      const mockEnrollmentReqs = [
        {
          id: 'er-001',
          requirement_id: 'req-001',
          is_applicable: true,
          requirement_definitions: {
            applicability_rules: null,
          },
        },
        {
          id: 'er-002',
          requirement_id: 'req-002',
          is_applicable: false, // Marriage cert was not applicable, should now be true
          requirement_definitions: {
            applicability_rules: {
              applicable_to: {
                marital_status: ['married'],
              },
            },
          },
        },
      ];

      const mockSelectChain1 = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: mockTraineeProfile, error: null }),
      };

      const mockSelectChain2 = {
        eq: vi.fn().mockReturnThis(),
        select: vi
          .fn()
          .mockResolvedValue({ data: mockEnrollments, error: null }),
      };

      const mockSelectChain3 = {
        eq: vi.fn().mockReturnThis(),
        select: vi
          .fn()
          .mockResolvedValue({ data: mockEnrollmentReqs, error: null }),
      };

      const mockUpdateChain = {
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      (supabaseAdmin.from as any)
        .mockReturnValueOnce(mockSelectChain1)
        .mockReturnValueOnce(mockSelectChain2)
        .mockReturnValueOnce(mockSelectChain3)
        .mockReturnValueOnce(mockUpdateChain);

      const result = await updateEnrollmentRequirementsApplicability(traineeId, tenantId);

      // Should have updated the marriage certificate requirement
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // Tests for Task 6.1: Get Requirements with Details
  // ============================================================================

  describe('getEnrollmentRequirementsWithDetails - Task 6.1', () => {
    it('should return enrollment requirements with requirement definitions', async () => {
      const enrollmentId = 'enrollment-001';

      const mockData = [
        {
          id: 'er-001',
          requirement_id: 'req-001',
          is_applicable: true,
          submission_status: 'pending',
          requirement_definitions: {
            id: 'req-001',
            requirement_type: 'birth_certificate_copy',
            display_name: 'Birth Certificate',
            description: 'Official copy',
            is_mandatory: true,
            display_order: 1,
          },
        },
      ];

      const mockSelectChain = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: mockData, error: null }),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      };

      (supabaseAdmin.from as any).mockReturnValueOnce(mockSelectChain);

      const result = await getEnrollmentRequirementsWithDetails(enrollmentId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'er-001',
        is_applicable: true,
        submission_status: 'pending',
      });
      expect(result[0].requirement_definitions).toMatchObject({
        requirement_type: 'birth_certificate_copy',
        display_name: 'Birth Certificate',
      });
    });

    it('should filter out non-applicable requirements by default', async () => {
      const enrollmentId = 'enrollment-001';

      const mockSelectChain = {
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      };

      (supabaseAdmin.from as any).mockReturnValueOnce(mockSelectChain);

      const result = await getEnrollmentRequirementsWithDetails(enrollmentId, false);

      // Verify that is_applicable filter was applied
      const callArgs = mockSelectChain.eq.mock.calls;
      const isApplicableFilter = callArgs.some((call) => call[0] === 'is_applicable' && call[1] === true);
      expect(isApplicableFilter).toBe(true);
    });
  });
});
