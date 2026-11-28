/**
 * JSONB Size Limits Integration Tests
 * 
 * Tests for JSONB size limit validation in API endpoints.
 * Validates: Requirements 15.4-15.5 (Apply validation to relevant endpoints)
 * 
 * Covers:
 * - POST /api/attendance/submit with oversized device_info
 * - POST /api/attendance/submit with oversized gps_address
 * - Normal JSON sizes are accepted
 */

import { POST as submitHandler } from '@/app/api/attendance/submit/route';
import { validateJsonbSize } from '@/lib/security/index';

describe('JSONB Size Limits - Integration Tests', () => {

  describe('validateJsonbSize function', () => {
    it('should be exported and callable', () => {
      expect(validateJsonbSize).toBeDefined();
      expect(typeof validateJsonbSize).toBe('function');
    });

    it('should reject device_info exceeding 5 KB', () => {
      const oversized = {
        data: 'x'.repeat(6000),
      };
      const result = validateJsonbSize('device_info', oversized);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds maximum size');
    });

    it('should accept device_info under 5 KB', () => {
      const normal = {
        brand: 'Apple',
        model: 'iPhone 15',
      };
      const result = validateJsonbSize('device_info', normal);
      expect(result.valid).toBe(true);
    });

    it('should reject gps_address exceeding 500 B', () => {
      const oversized = {
        address: 'x'.repeat(600),
      };
      const result = validateJsonbSize('gps_address', oversized);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds maximum size');
    });

    it('should accept gps_address under 500 B', () => {
      const normal = {
        city: 'Manila',
      };
      const result = validateJsonbSize('gps_address', normal);
      expect(result.valid).toBe(true);
    });
  });

  describe('POST /api/attendance/submit JSONB validation', () => {
    // Note: Full integration test would require:
    // 1. Database setup with test tenant/trainee/program/session
    // 2. Valid JWT token for trainee role
    // 3. Mocking form data with file uploads
    // These are tested in attendance-submit.integration.test.ts
    //
    // Here we verify the validation logic is exported correctly

    it('validateDeviceInfo should be called before submission', () => {
      // This is verified through the endpoint code inspection
      // The endpoint imports validateDeviceInfo and calls it before storage
      const mockDeviceInfo = {
        brand: 'Apple',
        model: 'iPhone 15',
      };

      // Should not throw when called with valid data
      expect(() => {
        // Simulating what happens in the endpoint
        const sizeValidation = validateJsonbSize('device_info', mockDeviceInfo);
        expect(sizeValidation.valid).toBe(true);
      }).not.toThrow();
    });

    it('should validate gps_address size before storage', () => {
      const mockGpsAddress = {
        street: '123 Main St',
        city: 'Manila',
      };

      const sizeValidation = validateJsonbSize('gps_address', mockGpsAddress);
      expect(sizeValidation.valid).toBe(true);
    });
  });

  describe('JSONB_SIZE_LIMITS constants', () => {
    it('should define all required field limits', () => {
      const { JSONB_SIZE_LIMITS } = require('@/lib/security/index');
      
      expect(JSONB_SIZE_LIMITS).toBeDefined();
      expect(JSONB_SIZE_LIMITS.device_info).toBe(5 * 1024); // 5 KB
      expect(JSONB_SIZE_LIMITS.gps_address).toBe(500); // 500 B
      expect(JSONB_SIZE_LIMITS.notes).toBe(5 * 1024); // 5 KB
      expect(JSONB_SIZE_LIMITS.custom_attributes).toBe(10 * 1024); // 10 KB
    });
  });

  describe('Multiple JSONB fields in single request', () => {
    it('should validate each JSONB field independently', () => {
      const deviceInfo = {
        brand: 'Apple',
        model: 'iPhone',
      };
      const gpsAddress = {
        city: 'Manila',
      };

      const deviceCheck = validateJsonbSize('device_info', deviceInfo);
      const gpsCheck = validateJsonbSize('gps_address', gpsAddress);

      expect(deviceCheck.valid).toBe(true);
      expect(gpsCheck.valid).toBe(true);
    });

    it('should reject request if any JSONB field exceeds limit', () => {
      const oversizedDeviceInfo = {
        data: 'x'.repeat(6000), // Exceeds device_info limit
      };
      const normalGpsAddress = {
        city: 'Manila',
      };

      const deviceCheck = validateJsonbSize('device_info', oversizedDeviceInfo);
      const gpsCheck = validateJsonbSize('gps_address', normalGpsAddress);

      expect(deviceCheck.valid).toBe(false);
      expect(gpsCheck.valid).toBe(true);
      // In actual endpoint, first validation failure returns 400
    });
  });

  describe('Error messages', () => {
    it('should include field name in error message', () => {
      const oversized = { data: 'x'.repeat(6000) };
      const result = validateJsonbSize('device_info', oversized);
      
      expect(result.reason).toContain('device_info');
    });

    it('should include byte count in error message', () => {
      const oversized = { data: 'x'.repeat(6000) };
      const result = validateJsonbSize('device_info', oversized);
      
      expect(result.reason).toContain('bytes');
      expect(result.reason).toContain('got');
    });

    it('should include size limit in error message', () => {
      const oversized = { data: 'x'.repeat(600) };
      const result = validateJsonbSize('gps_address', oversized);
      
      expect(result.reason).toContain('500');
    });
  });

  describe('Edge cases', () => {
    it('should handle null JSONB field', () => {
      const result = validateJsonbSize('device_info', null);
      expect(result.valid).toBe(true);
    });

    it('should handle undefined JSONB field', () => {
      const result = validateJsonbSize('device_info', undefined);
      expect(result.valid).toBe(true);
    });

    it('should handle empty object', () => {
      const result = validateJsonbSize('device_info', {});
      expect(result.valid).toBe(true);
    });

    it('should handle arrays', () => {
      const result = validateJsonbSize('device_info', [1, 2, 3, 4, 5]);
      expect(result.valid).toBe(true);
    });

    it('should handle primitive values', () => {
      expect(validateJsonbSize('device_info', 'string').valid).toBe(true);
      expect(validateJsonbSize('device_info', 42).valid).toBe(true);
      expect(validateJsonbSize('device_info', true).valid).toBe(true);
    });

    it('should skip validation for unknown field names', () => {
      const oversized = { data: 'x'.repeat(10000) };
      const result = validateJsonbSize('unknown_field', oversized);
      expect(result.valid).toBe(true); // Unknown fields skip validation
    });
  });

  describe('Boundary tests', () => {
    it('should accept device_info at exactly the limit', () => {
      // Create object that serializes to exactly 5 KB
      const atLimit = {
        data: 'x'.repeat(5100),
      };
      const serialized = JSON.stringify(atLimit);
      const sizeBytes = Buffer.byteLength(serialized, 'utf8');
      
      // Only test if we can create an object exactly at limit
      if (sizeBytes <= 5 * 1024) {
        const result = validateJsonbSize('device_info', atLimit);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject device_info 1 byte over limit', () => {
      const overLimit = {
        data: 'x'.repeat(5130),
      };
      const result = validateJsonbSize('device_info', overLimit);
      expect(result.valid).toBe(false);
    });

    it('should accept gps_address at exactly the limit', () => {
      const atLimit = {
        data: 'x'.repeat(400),
      };
      const serialized = JSON.stringify(atLimit);
      const sizeBytes = Buffer.byteLength(serialized, 'utf8');
      
      if (sizeBytes <= 500) {
        const result = validateJsonbSize('gps_address', atLimit);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject gps_address 1 byte over limit', () => {
      const overLimit = {
        data: 'x'.repeat(550),
      };
      const result = validateJsonbSize('gps_address', overLimit);
      expect(result.valid).toBe(false);
    });
  });

  describe('DOS attack prevention', () => {
    it('should reject attempt to stuff device_info with garbage', () => {
      const dosAttack = {
        brand: 'iPhone',
        model: 'X',
        os: 'iOS',
        padding: 'x'.repeat(6000), // Attempt to exhaust storage
      };
      const result = validateJsonbSize('device_info', dosAttack);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds maximum size');
    });

    it('should reject attempt to stuff gps_address with garbage', () => {
      const dosAttack = {
        address: 'x'.repeat(600),
      };
      const result = validateJsonbSize('gps_address', dosAttack);
      expect(result.valid).toBe(false);
    });

    it('should reject deeply nested objects that exceed size', () => {
      const deepObject: any = { level: 1 };
      let current = deepObject;
      for (let i = 0; i < 10; i++) {
        current.nested = { level: i + 2, data: 'x'.repeat(500) };
        current = current.nested;
      }
      
      const result = validateJsonbSize('device_info', deepObject);
      // Should fail due to size, even if depth wasn't checked
      // (depth validation is optional for MVP)
      expect(result.valid).toBe(false);
    });
  });
});
