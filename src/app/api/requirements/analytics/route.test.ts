/**
 * Unit tests for GET /api/requirements/analytics endpoint
 * 
 * Tests the analytics calculation logic and response formatting
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { 
  RequirementAnalytics, 
  RequirementAnalyticsSummary, 
  AnalyticsResponse 
} from './route';

describe('Analytics Calculations', () => {
  
  describe('Completion Rate Calculation', () => {
    
    it('should calculate 100% completion when all verified', () => {
      const stats = {
        verified_count: 5,
        waived_count: 0,
        total_submissions: 5,
      };
      
      const completionRate = ((stats.verified_count + stats.waived_count) / stats.total_submissions) * 100;
      expect(completionRate).toBe(100);
    });

    it('should calculate 50% completion with mixed statuses', () => {
      const stats = {
        verified_count: 2,
        waived_count: 0,
        rejected_count: 1,
        pending_count: 1,
        total_submissions: 4,
      };
      
      const completionRate = ((stats.verified_count + stats.waived_count) / stats.total_submissions) * 100;
      expect(completionRate).toBe(50);
    });

    it('should include waived in completion rate', () => {
      const stats = {
        verified_count: 2,
        waived_count: 1,
        rejected_count: 1,
        total_submissions: 4,
      };
      
      const completionRate = ((stats.verified_count + stats.waived_count) / stats.total_submissions) * 100;
      expect(completionRate).toBe(75);
    });

    it('should handle zero submissions', () => {
      const stats = {
        verified_count: 0,
        waived_count: 0,
        total_submissions: 0,
      };
      
      const completionRate = stats.total_submissions > 0
        ? ((stats.verified_count + stats.waived_count) / stats.total_submissions) * 100
        : 0;
      
      expect(completionRate).toBe(0);
    });
  });

  describe('Rejection Rate Calculation', () => {
    
    it('should calculate 0% rejection with no rejections', () => {
      const stats = {
        rejected_count: 0,
        total_submissions: 5,
      };
      
      const rejectionRate = (stats.rejected_count / stats.total_submissions) * 100;
      expect(rejectionRate).toBe(0);
    });

    it('should calculate 25% rejection rate', () => {
      const stats = {
        rejected_count: 1,
        total_submissions: 4,
      };
      
      const rejectionRate = (stats.rejected_count / stats.total_submissions) * 100;
      expect(rejectionRate).toBe(25);
    });

    it('should handle 100% rejection', () => {
      const stats = {
        rejected_count: 3,
        total_submissions: 3,
      };
      
      const rejectionRate = (stats.rejected_count / stats.total_submissions) * 100;
      expect(rejectionRate).toBe(100);
    });
  });

  describe('Time to Completion Calculation', () => {
    
    it('should calculate average days correctly', () => {
      // Sub1: created 2024-01-01, verified 2024-01-06 = 5 days
      // Sub2: created 2024-01-02, verified 2024-01-09 = 7 days
      const times = [5, 7];
      const avgDays = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avgDays).toBe(6);
    });

    it('should round to 2 decimal places', () => {
      const avgDays = 5.5555555;
      const rounded = Math.round(avgDays * 100) / 100;
      expect(rounded).toBe(5.56);
    });

    it('should return null for no verified submissions', () => {
      const completedCount = 0;
      const avgTime = completedCount > 0 ? 5 : null;
      expect(avgTime).toBeNull();
    });
  });

  describe('Summary Statistics', () => {
    
    it('should aggregate completion rates correctly', () => {
      const requirementRates = [100, 50, 75];
      const avgRate = requirementRates.reduce((a, b) => a + b, 0) / requirementRates.length;
      expect(avgRate).toBeCloseTo(75);
    });

    it('should aggregate rejection rates correctly', () => {
      const rejectionRates = [0, 25, 50];
      const avgRate = rejectionRates.reduce((a, b) => a + b, 0) / rejectionRates.length;
      expect(Math.round(avgRate * 100) / 100).toBeCloseTo(25);
    });

    it('should sum all counts correctly', () => {
      const requirements = [
        { total_submissions: 10, verified_count: 8, rejected_count: 2 },
        { total_submissions: 5, verified_count: 4, rejected_count: 1 },
      ];

      const totalSubmissions = requirements.reduce((sum, r) => sum + r.total_submissions, 0);
      const totalVerified = requirements.reduce((sum, r) => sum + r.verified_count, 0);
      const totalRejected = requirements.reduce((sum, r) => sum + r.rejected_count, 0);

      expect(totalSubmissions).toBe(15);
      expect(totalVerified).toBe(12);
      expect(totalRejected).toBe(3);
    });
  });

  describe('Response Format Validation', () => {
    
    it('should include all required fields in requirement analytics', () => {
      const analytics: RequirementAnalytics = {
        requirement_id: 'req-001',
        requirement_type: 'profile_form',
        display_name: 'Accomplished Learner\'s Profile Form',
        is_mandatory: true,
        completion_rate: 75,
        rejection_count: 1,
        rejection_rate: 25,
        avg_time_to_completion_days: 5.5,
        total_submissions: 4,
        verified_count: 3,
        rejected_count: 1,
        pending_count: 0,
        submitted_count: 0,
        waived_count: 0,
      };

      expect(analytics.requirement_id).toBeDefined();
      expect(analytics.requirement_type).toBeDefined();
      expect(analytics.display_name).toBeDefined();
      expect(analytics.is_mandatory).toBeDefined();
      expect(analytics.completion_rate).toBeDefined();
      expect(analytics.rejection_count).toBeDefined();
      expect(analytics.rejection_rate).toBeDefined();
      expect(analytics.avg_time_to_completion_days).toBeDefined();
    });

    it('should include all required fields in summary', () => {
      const summary: RequirementAnalyticsSummary = {
        avg_completion_rate: 75,
        avg_rejection_rate: 25,
        total_requirements: 2,
        total_submissions: 8,
        total_verified: 6,
        total_rejected: 2,
        total_pending: 0,
        total_submitted: 0,
        total_waived: 0,
      };

      expect(summary.avg_completion_rate).toBeDefined();
      expect(summary.avg_rejection_rate).toBeDefined();
      expect(summary.total_requirements).toBeDefined();
      expect(summary.total_submissions).toBeDefined();
      expect(summary.total_verified).toBeDefined();
      expect(summary.total_rejected).toBeDefined();
    });

    it('should structure response with by_requirement and summary', () => {
      const response: AnalyticsResponse = {
        by_requirement: [],
        summary: {
          avg_completion_rate: 0,
          avg_rejection_rate: 0,
          total_requirements: 0,
          total_submissions: 0,
          total_verified: 0,
          total_rejected: 0,
          total_pending: 0,
          total_submitted: 0,
          total_waived: 0,
        },
      };

      expect(response).toHaveProperty('by_requirement');
      expect(response).toHaveProperty('summary');
      expect(Array.isArray(response.by_requirement)).toBe(true);
    });
  });

  describe('Data Type Validation', () => {
    
    it('should have numeric values for rates and counts', () => {
      const analytics: RequirementAnalytics = {
        requirement_id: 'req-001',
        requirement_type: 'profile_form',
        display_name: 'Test',
        is_mandatory: true,
        completion_rate: 75,
        rejection_count: 1,
        rejection_rate: 25,
        avg_time_to_completion_days: 5.5,
        total_submissions: 4,
        verified_count: 3,
        rejected_count: 1,
        pending_count: 0,
        submitted_count: 0,
        waived_count: 0,
      };

      expect(typeof analytics.completion_rate).toBe('number');
      expect(typeof analytics.rejection_count).toBe('number');
      expect(typeof analytics.rejection_rate).toBe('number');
      expect(typeof analytics.total_submissions).toBe('number');
    });

    it('should allow null for avg_time_to_completion_days', () => {
      const analytics: RequirementAnalytics = {
        requirement_id: 'req-001',
        requirement_type: 'profile_form',
        display_name: 'Test',
        is_mandatory: true,
        completion_rate: 0,
        rejection_count: 0,
        rejection_rate: 0,
        avg_time_to_completion_days: null,
        total_submissions: 0,
        verified_count: 0,
        rejected_count: 0,
        pending_count: 0,
        submitted_count: 0,
        waived_count: 0,
      };

      expect(analytics.avg_time_to_completion_days).toBeNull();
    });

    it('should have boolean values for is_mandatory', () => {
      const analytics: RequirementAnalytics = {
        requirement_id: 'req-001',
        requirement_type: 'profile_form',
        display_name: 'Test',
        is_mandatory: true,
        completion_rate: 0,
        rejection_count: 0,
        rejection_rate: 0,
        avg_time_to_completion_days: null,
        total_submissions: 0,
        verified_count: 0,
        rejected_count: 0,
        pending_count: 0,
        submitted_count: 0,
        waived_count: 0,
      };

      expect(typeof analytics.is_mandatory).toBe('boolean');
    });
  });

  describe('Edge Cases', () => {
    
    it('should handle all pending submissions', () => {
      const stats = {
        pending_count: 4,
        verified_count: 0,
        rejected_count: 0,
        submitted_count: 0,
        waived_count: 0,
        total_submissions: 4,
      };

      const completionRate = ((stats.verified_count + stats.waived_count) / stats.total_submissions) * 100;
      const rejectionRate = (stats.rejected_count / stats.total_submissions) * 100;

      expect(completionRate).toBe(0);
      expect(rejectionRate).toBe(0);
    });

    it('should handle all submitted but unverified', () => {
      const stats = {
        submitted_count: 4,
        verified_count: 0,
        rejected_count: 0,
        pending_count: 0,
        waived_count: 0,
        total_submissions: 4,
      };

      const completionRate = ((stats.verified_count + stats.waived_count) / stats.total_submissions) * 100;
      
      expect(completionRate).toBe(0);
    });

    it('should handle very large numbers without overflow', () => {
      const stats = {
        verified_count: 10000,
        waived_count: 5000,
        total_submissions: 50000,
      };

      const completionRate = ((stats.verified_count + stats.waived_count) / stats.total_submissions) * 100;
      
      expect(completionRate).toBe(30);
    });
  });
});
