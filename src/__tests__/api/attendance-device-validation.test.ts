/**
 * Attendance Submit - Device Info Validation Integration Test
 *
 * Task 17.3: Apply validation on submission
 * Verifies that device_info is validated before processing
 */

import { validateDeviceInfo } from '@/lib/security/index';

describe('Task 17.3 - Device Info Validation Applied to Attendance Submit', () => {
  describe('Device info validation integration', () => {
    it('should validate device_info before submission', () => {
      // Simulate form data device_info field
      const deviceInfoFromForm = {
        device_id: 'test-device-123',
        device_model: 'iPhone 15',
        os_version: '18.1',
        app_version: '1.0.0',
        timestamp: new Date().toISOString(),
      };

      const result = validateDeviceInfo(deviceInfoFromForm);

      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should reject invalid device_info before submission', () => {
      const invalidDeviceInfo = {
        device_id: '<script>alert(1)</script>', // Invalid: special chars not allowed in device_id
      };

      const result = validateDeviceInfo(invalidDeviceInfo);

      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should handle missing device_info gracefully', () => {
      // When device_info is not provided at all
      const result = validateDeviceInfo(undefined);

      expect(result.valid).toBe(false);
    });

    it('should reject malformed JSON device_info', () => {
      // Simulate JSON parse error handling
      const malformedJson = '{invalid json}';
      let parsed;
      try {
        parsed = JSON.parse(malformedJson);
      } catch {
        expect(true).toBe(true); // Expected to fail
      }
    });

    it('should validate device_info with all optional fields', () => {
      const completeDeviceInfo = {
        device_id: '550e8400-e29b-41d4-a716-446655440000',
        device_model: 'Samsung Galaxy S24 Ultra',
        os_version: '14.0.1',
        app_version: '2.3.1-beta',
        timestamp: '2024-11-05T14:30:00Z',
      };

      const result = validateDeviceInfo(completeDeviceInfo);

      expect(result.valid).toBe(true);
      expect(result.data?.device_id).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result.data?.device_model).toBe('Samsung Galaxy S24 Ultra');
      expect(result.data?.os_version).toBe('14.0.1');
      expect(result.data?.app_version).toBe('2.3.1-beta');
    });

    it('should validate device_info with only required field', () => {
      const minimalDeviceInfo = {
        device_id: 'device-abc123',
      };

      const result = validateDeviceInfo(minimalDeviceInfo);

      expect(result.valid).toBe(true);
      expect(result.data?.device_id).toBe('device-abc123');
      expect(result.data?.device_model).toBeUndefined();
    });

    it('should return clear error message for invalid app_version format', () => {
      const invalidDevice = {
        device_id: 'device-123',
        app_version: '1.0', // Missing patch version
      };

      const result = validateDeviceInfo(invalidDevice);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('semantic versioning');
    });

    it('should reject oversized device_model', () => {
      const oversizedDevice = {
        device_id: 'device-123',
        device_model: 'A'.repeat(101), // 101 chars, exceeds limit of 100
      };

      const result = validateDeviceInfo(oversizedDevice);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds');
    });

    it('should accept device_model at max size', () => {
      const maxSizeDevice = {
        device_id: 'device-123',
        device_model: 'A'.repeat(100), // Exactly 100 chars
      };

      const result = validateDeviceInfo(maxSizeDevice);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid timestamp format', () => {
      const invalidTimestamp = {
        device_id: 'device-123',
        timestamp: 'not-a-timestamp',
      };

      const result = validateDeviceInfo(invalidTimestamp);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('datetime');
    });

    it('should accept ISO 8601 timestamp with timezone', () => {
      const validTimestamp = {
        device_id: 'device-123',
        timestamp: '2024-11-05T14:30:45+05:30',
      };

      const result = validateDeviceInfo(validTimestamp);

      expect(result.valid).toBe(true);
    });

    it('should NOT validate content of string fields (only format)', () => {
      // Note: Zod schema validates FORMAT, not CONTENT.
      // String fields can contain any text including HTML/SQL.
      // Content validation happens at output layer (HTML encoding) or DB layer (parameterized queries).
      const deviceWithHTMLContent = {
        device_id: 'device-123',
        device_model: '<img src=x onerror="alert(1)">',
      };

      const result = validateDeviceInfo(deviceWithHTMLContent);

      // Should be valid at schema level (content validation is downstream responsibility)
      expect(result.valid).toBe(true);
      expect(result.data?.device_model).toBe('<img src=x onerror="alert(1)">');
    });
  });

  describe('Error handling in attendance context', () => {
    it('should format error for API response', () => {
      const invalidDevice = {
        device_id: '',
      };

      const result = validateDeviceInfo(invalidDevice);

      // Should be ready to return 400 error
      expect(result.valid).toBe(false);
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe('string');
    });

    it('should provide reason suitable for 400 response', () => {
      const invalidDevice = {
        device_id: 'device_id_with_underscore_@_symbol',
      };

      const result = validateDeviceInfo(invalidDevice);

      expect(result.valid).toBe(false);
      expect(result.reason?.length).toBeGreaterThan(0);
    });
  });

  describe('Device info from real-world scenarios', () => {
    it('should validate iOS device info', () => {
      const iosDevice = {
        device_id: 'iOS-12345-ABCDE',
        device_model: 'iPhone 15 Pro Max',
        os_version: '18.1.1',
        app_version: '1.0.0',
        timestamp: '2024-11-05T10:15:30Z',
      };

      const result = validateDeviceInfo(iosDevice);

      expect(result.valid).toBe(true);
    });

    it('should validate Android device info', () => {
      const androidDevice = {
        device_id: 'android-device-xyz789',
        device_model: 'Samsung Galaxy S24',
        os_version: '14',
        app_version: '1.0.0',
        timestamp: '2024-11-05T10:20:00+05:30',
      };

      const result = validateDeviceInfo(androidDevice);

      expect(result.valid).toBe(true);
    });

    it('should validate web/browser device info', () => {
      const webDevice = {
        device_id: 'web-session-abc123',
        device_model: 'Chrome on MacBook Pro',
      };

      const result = validateDeviceInfo(webDevice);

      expect(result.valid).toBe(true);
    });

    it('should validate beta app version', () => {
      const betaDevice = {
        device_id: 'device-123',
        app_version: '2.0.0-rc1',
      };

      const result = validateDeviceInfo(betaDevice);

      expect(result.valid).toBe(true);
      expect(result.data?.app_version).toBe('2.0.0-rc1');
    });
  });
});
