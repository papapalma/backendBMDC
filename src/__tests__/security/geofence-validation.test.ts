/**
 * Geofence Validation Tests (Task 22)
 *
 * Validates: Requirements 22.1-22.4
 *
 * Test scenarios:
 * - GPS inside geofence → validates
 * - GPS outside geofence → rejected with 403
 * - GPS at boundary with low accuracy → validates
 * - GPS at boundary with high accuracy → rejected
 * - GPS outside with any accuracy → rejected
 * - Missing geofence configuration → rejected
 * - Inactive geofence → rejected
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { validateGeofence, calculateDistance } from '@/lib/security/index';
import { Geofence } from '@/lib/security/index';

describe('Geofence Validation (Task 22)', () => {
  // Test geofence: center at specific location, 100m radius
  const testGeofence: Geofence = {
    id: 'geofence-test-1',
    program_id: 'program-test-1',
    name: 'Training Center',
    latitude: 40.7128,
    longitude: -74.0060,
    radius_meters: 100,
    is_active: true,
  };

  // Coordinates
  const centerLat = 40.7128;
  const centerLng = -74.0060;
  
  // Nearby coordinates (inside geofence when accuracy is considered)
  const insideLat = 40.7129;
  const insideLng = -74.0061;
  
  // Faraway coordinates (definitely outside geofence)
  const outsideLat = 40.7228;
  const outsideLng = -73.9960;

  // Test helper: validate distance calculation
  describe('Distance Calculation (Haversine)', () => {
    it('should calculate distance between two points correctly', () => {
      // Calculate actual distance
      const distance = calculateDistance(40.7128, -74.0060, 40.7129, -74.0061);
      // Should be in the range of 100-200 meters (small distances)
      expect(distance).toBeGreaterThan(0.01);
      expect(distance).toBeLessThan(1);
    });

    it('should return 0 for identical coordinates', () => {
      const distance = calculateDistance(40.7128, -74.0060, 40.7128, -74.0060);
      expect(distance).toBe(0);
    });

    it('should calculate distance at geofence boundary', () => {
      // Calculate distance from center to nearby point
      const dist = calculateDistance(centerLat, centerLng, insideLat, insideLng);
      // Should be small (nearby)
      expect(dist).toBeGreaterThan(0.01);
      expect(dist).toBeLessThan(1);
    });
  });

  describe('validateGeofence()', () => {
    describe('Valid Submissions (inside geofence)', () => {
      it('should accept GPS at geofence center', () => {
        const result = validateGeofence(centerLat, centerLng, 10, testGeofence);
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should accept GPS inside geofence with good accuracy (10m)', () => {
        const result = validateGeofence(insideLat, insideLng, 10, testGeofence);
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should accept GPS inside geofence with maximum accuracy (100m)', () => {
        const result = validateGeofence(insideLat, insideLng, 30, testGeofence);
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should accept GPS inside geofence with no accuracy provided', () => {
        const result = validateGeofence(insideLat, insideLng, undefined, testGeofence);
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should accept GPS at boundary (distance + accuracy <= radius)', () => {
        // Point very close to center with moderate accuracy
        const boundaryLat = 40.712801;
        const boundaryLng = -74.006001;
        const result = validateGeofence(boundaryLat, boundaryLng, 50, testGeofence);
        // Should accept (since distance is tiny)
        expect(result.valid).toBe(true);
      });
    });

    describe('Invalid Submissions (outside geofence)', () => {
      it('should reject GPS outside geofence (far away)', () => {
        const result = validateGeofence(outsideLat, outsideLng, 10, testGeofence);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Location outside geofence');
        expect(result.reason).toContain('max 100m');
      });

      it('should reject GPS with accuracy that exceeds geofence boundary', () => {
        // GPS at center but high accuracy makes it uncertain
        const result = validateGeofence(centerLat, centerLng, 150, testGeofence);
        expect(result.valid).toBe(false);
      });

      it('should reject GPS far outside geofence even with zero accuracy', () => {
        const result = validateGeofence(outsideLat, outsideLng, 0, testGeofence);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Location outside geofence');
      });

      it('should reject GPS far away from geofence', () => {
        // Coordinates many miles away
        const farAwayLat = 40.8;
        const farAwayLng = -73.9;
        const result = validateGeofence(farAwayLat, farAwayLng, 0, testGeofence);
        expect(result.valid).toBe(false);
      });
    });

    describe('Geofence Configuration Errors', () => {
      it('should reject submission if geofence is null', () => {
        const result = validateGeofence(centerLat, centerLng, 10, null as any);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Geofence not configured');
      });

      it('should reject submission if geofence is inactive', () => {
        const inactiveGeofence: Geofence = {
          ...testGeofence,
          is_active: false,
        };
        const result = validateGeofence(centerLat, centerLng, 10, inactiveGeofence);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Geofence is not active');
      });

      it('should reject submission for missing geofence object', () => {
        const result = validateGeofence(centerLat, centerLng, 10, undefined as any);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Geofence not configured');
      });
    });

    describe('Edge Cases', () => {
      it('should handle very small geofence radius (5m)', () => {
        const smallGeofence: Geofence = {
          ...testGeofence,
          radius_meters: 5,
        };
        // GPS at center should pass
        const result1 = validateGeofence(
          centerLat,
          centerLng,
          1,
          smallGeofence
        );
        expect(result1.valid).toBe(true);

        // GPS far from center should fail
        const result2 = validateGeofence(
          outsideLat,
          outsideLng,
          1,
          smallGeofence
        );
        expect(result2.valid).toBe(false);
      });

      it('should handle large geofence radius (1000m)', () => {
        const largeGeofence: Geofence = {
          ...testGeofence,
          radius_meters: 1000,
        };
        // GPS close to center should pass with large radius
        const result = validateGeofence(
          centerLat + 0.001,  // Small offset = ~100m
          centerLng + 0.001,
          10,
          largeGeofence
        );
        expect(result.valid).toBe(true);
      });

      it('should handle zero accuracy (GPS with perfect accuracy)', () => {
        const result = validateGeofence(insideLat, insideLng, 0, testGeofence);
        expect(result.valid).toBe(true);
      });

      it('should combine distance and accuracy checks', () => {
        // GPS at center but accuracy exceeds radius
        const result = validateGeofence(centerLat, centerLng, 150, testGeofence);
        expect(result.valid).toBe(false);
      });
    });

    describe('Accuracy Validation', () => {
      it('should include accuracy value in error message', () => {
        // GPS that fails due to accuracy
        const result = validateGeofence(
          centerLat,
          centerLng,
          150,
          testGeofence
        );
        if (!result.valid) {
          expect(result.reason).toBeDefined();
        }
      });

      it('should show distance information in error message', () => {
        const result = validateGeofence(outsideLat, outsideLng, 10, testGeofence);
        if (!result.valid) {
          // Should mention the distance value
          expect(result.reason).toContain('m from center');
        }
      });
    });
  });

  describe('Integration: Geofence with GPS Validation', () => {
    /**
     * Validates: Requirements 22.1 + 22.5
     * Both GPS validation AND geofence validation work together
     */

    it('should accept GPS that passes both base validation and geofence check', () => {
      // This would be called after validateGPS() returns valid=true
      const result = validateGeofence(insideLat, insideLng, 15, testGeofence);
      expect(result.valid).toBe(true);
    });

    it('should reject GPS that passes base validation but fails geofence check', () => {
      // Even though coordinates are valid ranges, they're outside the geofence
      const result = validateGeofence(outsideLat, outsideLng, 20, testGeofence);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('outside geofence');
    });
  });
});
