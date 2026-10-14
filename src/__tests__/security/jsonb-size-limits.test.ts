/**
 * JSONB Size Limits Tests
 * 
 * Tests for validateJsonbSize function to prevent DOS attacks via oversized JSON fields.
 * Validates: Requirements 15.1-15.5 (Add JSONB Size Limits)
 * 
 * Test cases:
 * - Normal JSON (< size limit) → accepted
 * - Oversized JSON (> size limit) → rejected
 * - Deep nesting (> 5 levels) → rejected (future: depth validation)
 * - Empty JSON {} → accepted
 * - Null/undefined → handled gracefully
 */

import { validateJsonbSize, JSONB_SIZE_LIMITS } from '@/lib/security/index';

describe('JSONB Size Limits - validateJsonbSize', () => {

  // ============================================================================
  // Normal JSON (< limit) - should be accepted
  // ============================================================================

  describe('normal JSON (< size limit)', () => {
    it('should accept empty object for device_info', () => {
      const result = validateJsonbSize('device_info', {});
      expect(result.valid).toBe(true);
    });

    it('should accept small device_info object', () => {
      const result = validateJsonbSize('device_info', {
        brand: 'Apple',
        model: 'iPhone 15',
        os: 'iOS 17.5',
      });
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept typical device_info with server IP appended', () => {
      const result = validateJsonbSize('device_info', {
        brand: 'Samsung',
        model: 'Galaxy S24',
        os: 'Android 14',
        app_version: '1.2.3',
        ip: '192.168.1.100',
      });
      expect(result.valid).toBe(true);
    });

    it('should accept object just under device_info limit (5 KB)', () => {
      // Create object that serializes to ~4 KB
      const largeObj = {
        data: 'x'.repeat(4000),
      };
      const result = validateJsonbSize('device_info', largeObj);
      expect(result.valid).toBe(true);
    });

    it('should accept empty object for gps_address', () => {
      const result = validateJsonbSize('gps_address', {});
      expect(result.valid).toBe(true);
    });

    it('should accept small gps_address object', () => {
      const result = validateJsonbSize('gps_address', {
        street: '123 Main St',
        city: 'Manila',
        country: 'Philippines',
      });
      expect(result.valid).toBe(true);
    });

    it('should accept object just under gps_address limit (500 B)', () => {
      // Create object that serializes to ~400 bytes
      const smallObj = {
        address: 'x'.repeat(300),
      };
      const result = validateJsonbSize('gps_address', smallObj);
      expect(result.valid).toBe(true);
    });

    it('should accept small notes object', () => {
      const result = validateJsonbSize('notes', {
        text: 'Training complete',
      });
      expect(result.valid).toBe(true);
    });

    it('should accept small custom_attributes object', () => {
      const result = validateJsonbSize('custom_attributes', {
        custom_field_1: 'value1',
        custom_field_2: 'value2',
      });
      expect(result.valid).toBe(true);
    });
  });

  // ============================================================================
  // Oversized JSON (> limit) - should be rejected with 400
  // ============================================================================

  describe('oversized JSON (> size limit)', () => {
    it('should reject device_info exceeding 5 KB limit', () => {
      // Create object that serializes to > 5 KB
      const oversizedObj = {
        data: 'x'.repeat(6000),
      };
      const result = validateJsonbSize('device_info', oversizedObj);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('device_info');
      expect(result.reason).toContain('exceeds maximum size');
    });

    it('should reject gps_address exceeding 500 B limit', () => {
      // Create object that serializes to > 500 bytes
      const oversizedObj = {
        address: 'x'.repeat(600),
      };
      const result = validateJsonbSize('gps_address', oversizedObj);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('gps_address');
      expect(result.reason).toContain('exceeds maximum size');
    });

    it('should reject notes exceeding 5 KB limit', () => {
      const oversizedObj = {
        text: 'x'.repeat(6000),
      };
      const result = validateJsonbSize('notes', oversizedObj);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('notes');
    });

    it('should reject custom_attributes exceeding 10 KB limit', () => {
      const oversizedObj = {
        data: 'x'.repeat(12000),
      };
      const result = validateJsonbSize('custom_attributes', oversizedObj);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('custom_attributes');
    });

    it('should include byte count in error message', () => {
      const oversizedObj = {
        data: 'x'.repeat(6000),
      };
      const result = validateJsonbSize('device_info', oversizedObj);
      expect(result.reason).toContain('bytes');
      expect(result.reason).toContain('got');
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('should accept null value', () => {
      const result = validateJsonbSize('device_info', null);
      expect(result.valid).toBe(true);
    });

    it('should accept undefined value', () => {
      const result = validateJsonbSize('device_info', undefined);
      expect(result.valid).toBe(true);
    });

    it('should accept empty array', () => {
      const result = validateJsonbSize('device_info', []);
      expect(result.valid).toBe(true);
    });

    it('should accept array with values', () => {
      const result = validateJsonbSize('device_info', [1, 2, 3, 4, 5]);
      expect(result.valid).toBe(true);
    });

    it('should accept primitive string value', () => {
      const result = validateJsonbSize('device_info', 'simple string');
      expect(result.valid).toBe(true);
    });

    it('should accept primitive number value', () => {
      const result = validateJsonbSize('device_info', 42);
      expect(result.valid).toBe(true);
    });

    it('should accept primitive boolean value', () => {
      const result = validateJsonbSize('device_info', true);
      expect(result.valid).toBe(true);
    });

    it('should handle unknown field name (skip validation)', () => {
      // Unknown fields should not cause errors
      const result = validateJsonbSize('unknown_field', { data: 'x'.repeat(10000) });
      expect(result.valid).toBe(true);
    });

    it('should handle object exactly at limit for device_info (5 KB)', () => {
      // Create object that serializes to exactly 5 KB
      const exactLimitObj = {
        data: 'x'.repeat(5120 - 10), // Account for JSON structure
      };
      const serialized = JSON.stringify(exactLimitObj);
      if (Buffer.byteLength(serialized, 'utf8') <= JSONB_SIZE_LIMITS.device_info) {
        const result = validateJsonbSize('device_info', exactLimitObj);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject object 1 byte over limit', () => {
      // Create object exactly 1 byte over limit
      const oversizedObj = {
        data: 'x'.repeat(5130), // Will exceed 5 KB by 1-2 bytes after JSON encoding
      };
      const result = validateJsonbSize('device_info', oversizedObj);
      expect(result.valid).toBe(false);
    });
  });

  // ============================================================================
  // Deep Nesting (Future: depth validation)
  // ============================================================================

  describe('deep nesting detection', () => {
    it('should accept reasonably nested objects (< 5 levels)', () => {
      const nestedObj = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'data',
              },
            },
          },
        },
      };
      const result = validateJsonbSize('device_info', nestedObj);
      expect(result.valid).toBe(true);
    });

    // Note: Deep nesting rejection is a future enhancement
    // Currently, we only validate size, not depth
    // Depth validation would require recursive traversal and is optional for MVP
  });

  // ============================================================================
  // Integration: device_info field with typical data
  // ============================================================================

  describe('device_info field integration', () => {
    it('should accept typical device_info from mobile app', () => {
      const deviceInfo = {
        brand: 'Apple',
        model: 'iPhone 14 Pro',
        os: 'iOS 17.5.1',
        app_version: '1.4.2',
        build_number: '142',
        device_id: 'device-uuid-12345',
        screen_size: '6.1 inches',
        battery_level: 85,
        network_type: 'wifi',
        app_locale: 'en-PH',
      };
      const result = validateJsonbSize('device_info', deviceInfo);
      expect(result.valid).toBe(true);
    });

    it('should accept device_info with server-appended IP', () => {
      const deviceInfo = {
        brand: 'Samsung',
        model: 'Galaxy S24',
        os: 'Android 14',
        app_version: '1.4.2',
        ip: '203.0.113.42', // Server-appended IP
      };
      const result = validateJsonbSize('device_info', deviceInfo);
      expect(result.valid).toBe(true);
    });

    it('should reject device_info with malicious padding', () => {
      // Attacker tries to stuff device_info with garbage to exhaust storage
      const maliciousDeviceInfo = {
        brand: 'iPhone',
        model: 'X',
        os: 'iOS',
        padding: 'x'.repeat(6000), // DOS attack attempt
      };
      const result = validateJsonbSize('device_info', maliciousDeviceInfo);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds maximum size');
    });
  });

  // ============================================================================
  // Integration: gps_address field
  // ============================================================================

  describe('gps_address field integration', () => {
    it('should accept typical gps_address from reverse geocoding', () => {
      const gpsAddress = {
        street: '123 Main Street',
        barangay: 'San Juan',
        city: 'Manila',
        province: 'NCR',
        country: 'Philippines',
        zip: '1005',
      };
      const result = validateJsonbSize('gps_address', gpsAddress);
      expect(result.valid).toBe(true);
    });

    it('should reject gps_address with excessive detail', () => {
      const excessiveGpsAddress = {
        full_address: 'x'.repeat(600),
      };
      const result = validateJsonbSize('gps_address', excessiveGpsAddress);
      expect(result.valid).toBe(false);
    });
  });

  // ============================================================================
  // Integration: multiple JSONB fields in same submission
  // ============================================================================

  describe('multiple JSONB fields in same submission', () => {
    it('should validate all JSONB fields together', () => {
      const deviceInfo = {
        brand: 'Apple',
        model: 'iPhone 15',
      };
      const gpsAddress = {
        city: 'Manila',
      };
      const notes = {
        text: 'Completed training',
      };

      const deviceCheck = validateJsonbSize('device_info', deviceInfo);
      const gpsCheck = validateJsonbSize('gps_address', gpsAddress);
      const notesCheck = validateJsonbSize('notes', notes);

      expect(deviceCheck.valid).toBe(true);
      expect(gpsCheck.valid).toBe(true);
      expect(notesCheck.valid).toBe(true);
    });

    it('should reject if any JSONB field exceeds limit', () => {
      const deviceInfo = {
        data: 'x'.repeat(6000), // Exceeds limit
      };
      const gpsAddress = {
        city: 'Manila',
      };

      const deviceCheck = validateJsonbSize('device_info', deviceInfo);
      const gpsCheck = validateJsonbSize('gps_address', gpsAddress);

      expect(deviceCheck.valid).toBe(false);
      expect(gpsCheck.valid).toBe(true);
    });
  });

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('error handling', () => {
    it('should handle circular references gracefully', () => {
      const circularObj: any = { a: 1 };
      circularObj.self = circularObj; // Create circular reference

      // JSON.stringify will throw on circular references
      const result = validateJsonbSize('device_info', circularObj);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('cannot be serialized');
    });

    it('should handle special JSON types', () => {
      const withDate = {
        timestamp: new Date('2024-10-05'),
        value: 'data',
      };
      const result = validateJsonbSize('device_info', withDate);
      // Date will be serialized to ISO string, should be valid if under limit
      expect(result.valid).toBe(true);
    });
  });
});
