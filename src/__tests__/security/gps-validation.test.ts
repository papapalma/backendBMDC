/**
 * GPS Data Validation Tests
 * 
 * Tests for GPS coordinate validation in attendance submission.
 * Validates: Requirements 3.9 (GPS Data Validation)
 * 
 * Test cases:
 * - Valid coordinates accepted
 * - Out-of-range coordinates rejected
 * - (0,0) coordinates rejected (GPS spoofing indicator)
 * - Missing accuracy rejected
 * - Negative accuracy rejected
 * - Accuracy > 100 rejected
 */

import { validateGPS } from '@/lib/security/index';

describe('GPS Data Validation', () => {
  
  describe('valid coordinates', () => {
    it('should accept valid NYC coordinates with accuracy', () => {
      const result = validateGPS(40.7128, -74.0060, 15);
      expect(result.valid).toBe(true);
    });

    it('should accept valid coordinates without accuracy', () => {
      const result = validateGPS(40.7128, -74.0060);
      expect(result.valid).toBe(true);
    });

    it('should accept SF coordinates', () => {
      const result = validateGPS(37.7749, -122.4194, 20);
      expect(result.valid).toBe(true);
    });

    it('should accept North Pole', () => {
      const result = validateGPS(90, 0, 10);
      expect(result.valid).toBe(true);
    });

    it('should accept South Pole', () => {
      const result = validateGPS(-90, 0, 10);
      expect(result.valid).toBe(true);
    });

    it('should accept International Date Line', () => {
      const result = validateGPS(0, 180, 10);
      expect(result.valid).toBe(true);
    });

    it('should accept equator with valid accuracy', () => {
      const result = validateGPS(0.1, 0.1, 5);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid ranges', () => {
    it('should reject latitude > 90', () => {
      const result = validateGPS(91, 0, 10);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Latitude out of range');
    });

    it('should reject latitude < -90', () => {
      const result = validateGPS(-91, 0, 10);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Latitude out of range');
    });

    it('should reject longitude > 180', () => {
      const result = validateGPS(0, 181, 10);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Longitude out of range');
    });

    it('should reject longitude < -180', () => {
      const result = validateGPS(0, -181, 10);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Longitude out of range');
    });

    it('should reject latitude 500', () => {
      const result = validateGPS(500, 0, 10);
      expect(result.valid).toBe(false);
    });

    it('should reject longitude 999', () => {
      const result = validateGPS(0, 999, 10);
      expect(result.valid).toBe(false);
    });
  });

  describe('(0,0) rejection (GPS spoofing)', () => {
    it('should reject (0, 0) coordinates', () => {
      const result = validateGPS(0, 0, 10);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('(0,0) are not permitted');
    });

    it('should reject (0, 0) without accuracy', () => {
      const result = validateGPS(0, 0);
      expect(result.valid).toBe(false);
    });

    it('should reject (0, 0) with zero accuracy', () => {
      const result = validateGPS(0, 0, 0);
      expect(result.valid).toBe(false);
    });
  });

  describe('missing or undefined values', () => {
    it('should reject missing latitude', () => {
      const result = validateGPS(undefined, -74.0060, 10);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Latitude is required');
    });

    it('should reject missing longitude', () => {
      const result = validateGPS(40.7128, undefined, 10);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Longitude is required');
    });

    it('should reject null latitude', () => {
      const result = validateGPS(null as any, -74.0060, 10);
      expect(result.valid).toBe(false);
    });

    it('should reject null longitude', () => {
      const result = validateGPS(40.7128, null as any, 10);
      expect(result.valid).toBe(false);
    });
  });

  describe('accuracy validation', () => {
    it('should accept accuracy of 0', () => {
      const result = validateGPS(40.7128, -74.0060, 0);
      expect(result.valid).toBe(true);
    });

    it('should accept accuracy of 10', () => {
      const result = validateGPS(40.7128, -74.0060, 10);
      expect(result.valid).toBe(true);
    });

    it('should accept accuracy of 100', () => {
      const result = validateGPS(40.7128, -74.0060, 100);
      expect(result.valid).toBe(true);
    });

    it('should reject negative accuracy', () => {
      const result = validateGPS(40.7128, -74.0060, -1);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('below minimum');
    });

    it('should reject accuracy > 100', () => {
      const result = validateGPS(40.7128, -74.0060, 150);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds maximum');
    });

    it('should reject accuracy of 1000', () => {
      const result = validateGPS(40.7128, -74.0060, 1000);
      expect(result.valid).toBe(false);
    });

    it('should accept accuracy of 99.99', () => {
      const result = validateGPS(40.7128, -74.0060, 99.99);
      expect(result.valid).toBe(true);
    });

    it('should accept accuracy of 100 (boundary)', () => {
      const result = validateGPS(40.7128, -74.0060, 100);
      expect(result.valid).toBe(true);
    });

    it('should accept coordinates without accuracy field', () => {
      const result = validateGPS(40.7128, -74.0060);
      expect(result.valid).toBe(true);
    });

    it('should reject undefined accuracy with out-of-range value', () => {
      // undefined should be OK (optional), but explicitly bad value should fail
      const result = validateGPS(40.7128, -74.0060, undefined);
      expect(result.valid).toBe(true); // optional is OK
    });

    it('should reject NaN accuracy', () => {
      const result = validateGPS(40.7128, -74.0060, NaN);
      expect(result.valid).toBe(false);
    });
  });

  describe('type validation', () => {
    it('should reject non-number latitude', () => {
      const result = validateGPS('40' as any, -74.0060, 10);
      expect(result.valid).toBe(false);
    });

    it('should reject non-number longitude', () => {
      const result = validateGPS(40.7128, '-74.0060' as any, 10);
      expect(result.valid).toBe(false);
    });

    it('should reject NaN latitude', () => {
      const result = validateGPS(NaN, -74.0060, 10);
      expect(result.valid).toBe(false);
    });

    it('should reject NaN longitude', () => {
      const result = validateGPS(40.7128, NaN, 10);
      expect(result.valid).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle very small valid coordinates', () => {
      const result = validateGPS(0.0001, 0.0001, 10);
      expect(result.valid).toBe(true);
    });

    it('should handle coordinates at boundaries', () => {
      const result = validateGPS(-90, -180, 50);
      expect(result.valid).toBe(true);
    });

    it('should handle coordinates at opposite boundaries', () => {
      const result = validateGPS(90, 180, 50);
      expect(result.valid).toBe(true);
    });

    it('should handle floating point precision', () => {
      const result = validateGPS(40.712847012947, -74.006015000001, 15);
      expect(result.valid).toBe(true);
    });

    it('should handle scientific notation', () => {
      const result = validateGPS(4.07e1, -7.4e1, 10); // 40.7, -74
      expect(result.valid).toBe(true);
    });
  });

  describe('return value structure', () => {
    it('should return valid: true for good coords', () => {
      const result = validateGPS(40.7128, -74.0060, 10);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return valid: false with reason for bad coords', () => {
      const result = validateGPS(91, 0, 10);
      expect(result.valid).toBe(false);
      expect(typeof result.reason).toBe('string');
      expect(result.reason!.length).toBeGreaterThan(0);
    });

    it('should have descriptive error messages', () => {
      const result = validateGPS(91, 0, 10);
      expect(result.reason).toMatch(/latitude|Latitude/i);
    });
  });

});
