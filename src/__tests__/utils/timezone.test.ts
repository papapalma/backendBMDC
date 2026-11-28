/**
 * UTC Timezone Tests
 * 
 * Validates that:
 * - All timestamps are created in UTC
 * - API responses return ISO 8601 UTC strings
 * - Querying date ranges works across timezones
 * - DST transitions don't cause bugs
 * 
 * Validates: Requirements 13.1-13.5
 */

import {
  createUTCDate,
  formatUTC,
  isValidUTCTimestamp,
  parseUTCTimestamp,
  getUTCNow,
  calculateDateRangeUTC,
} from '@/lib/timezone';

describe('UTC Timezone Utilities', () => {
  describe('createUTCDate', () => {
    it('should create a date in UTC from year, month, day', () => {
      // 2024-01-15 00:00:00 UTC
      const date = createUTCDate(2024, 0, 15);
      
      expect(date.getUTCFullYear()).toBe(2024);
      expect(date.getUTCMonth()).toBe(0); // January
      expect(date.getUTCDate()).toBe(15);
      expect(date.getUTCHours()).toBe(0);
      expect(date.getUTCMinutes()).toBe(0);
      expect(date.getUTCSeconds()).toBe(0);
    });

    it('should create a date with full parameters', () => {
      // 2024-06-15 14:30:45 UTC
      const date = createUTCDate(2024, 5, 15, 14, 30, 45);
      
      expect(date.getUTCFullYear()).toBe(2024);
      expect(date.getUTCMonth()).toBe(5); // June
      expect(date.getUTCDate()).toBe(15);
      expect(date.getUTCHours()).toBe(14);
      expect(date.getUTCMinutes()).toBe(30);
      expect(date.getUTCSeconds()).toBe(45);
    });

    it('should not be affected by local timezone', () => {
      const date = createUTCDate(2024, 0, 15, 12, 0, 0);
      const isoString = date.toISOString();
      
      // Should always be 12:00:00Z in ISO string regardless of local TZ
      expect(isoString).toMatch(/T12:00:00\.000Z$/);
    });
  });

  describe('formatUTC', () => {
    it('should format UTC date as ISO 8601 string', () => {
      const date = createUTCDate(2024, 0, 15, 14, 30, 45);
      const formatted = formatUTC(date);
      
      expect(formatted).toBe('2024-01-15T14:30:45Z');
    });

    it('should handle midnight UTC', () => {
      const date = createUTCDate(2024, 11, 31, 0, 0, 0);
      const formatted = formatUTC(date);
      
      expect(formatted).toBe('2024-12-31T00:00:00Z');
    });

    it('should handle end of day UTC', () => {
      const date = createUTCDate(2024, 0, 1, 23, 59, 59);
      const formatted = formatUTC(date);
      
      expect(formatted).toBe('2024-01-01T23:59:59Z');
    });
  });

  describe('isValidUTCTimestamp', () => {
    it('should accept valid ISO 8601 UTC timestamp', () => {
      expect(isValidUTCTimestamp('2024-01-15T14:30:45Z')).toBe(true);
    });

    it('should accept ISO with milliseconds', () => {
      expect(isValidUTCTimestamp('2024-01-15T14:30:45.123Z')).toBe(true);
    });

    it('should accept without seconds', () => {
      expect(isValidUTCTimestamp('2024-01-15T14:30Z')).toBe(true);
    });

    it('should reject non-UTC timezone offset', () => {
      expect(isValidUTCTimestamp('2024-01-15T14:30:45-05:00')).toBe(false);
    });

    it('should reject invalid format', () => {
      expect(isValidUTCTimestamp('2024-01-15 14:30:45')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidUTCTimestamp('')).toBe(false);
    });
  });

  describe('parseUTCTimestamp', () => {
    it('should parse valid ISO 8601 UTC timestamp', () => {
      const date = parseUTCTimestamp('2024-01-15T14:30:45Z');
      
      expect(date).not.toBeNull();
      expect(date?.getUTCFullYear()).toBe(2024);
      expect(date?.getUTCMonth()).toBe(0);
      expect(date?.getUTCDate()).toBe(15);
      expect(date?.getUTCHours()).toBe(14);
    });

    it('should return null for invalid timestamp', () => {
      expect(parseUTCTimestamp('invalid')).toBeNull();
    });

    it('should handle milliseconds', () => {
      const date = parseUTCTimestamp('2024-01-15T14:30:45.500Z');
      
      expect(date).not.toBeNull();
      expect(date?.getUTCMilliseconds()).toBe(500);
    });
  });

  describe('getUTCNow', () => {
    it('should return current time in UTC', () => {
      const now = getUTCNow();
      
      expect(now).toBeInstanceOf(Date);
      expect(now.toISOString()).toMatch(/Z$/);
    });

    it('should return consistent time for immediate calls', () => {
      const now1 = getUTCNow();
      const now2 = getUTCNow();
      
      // Should be within 10ms (very fast)
      expect(Math.abs(now2.getTime() - now1.getTime())).toBeLessThan(10);
    });

    it('should be independent of local timezone', () => {
      const now = getUTCNow();
      const isoString = now.toISOString();
      
      // ISO string should end with Z (UTC)
      expect(isoString).toMatch(/Z$/);
    });
  });

  describe('calculateDateRangeUTC', () => {
    it('should calculate date range for single day', () => {
      const range = calculateDateRangeUTC(
        createUTCDate(2024, 0, 15),
        'day'
      );
      
      expect(range.start.toISOString()).toMatch(/2024-01-15T00:00:00/);
      expect(range.end.toISOString()).toMatch(/2024-01-15T23:59:59/);
    });

    it('should calculate date range for week', () => {
      // Monday, January 15, 2024
      const range = calculateDateRangeUTC(
        createUTCDate(2024, 0, 15),
        'week'
      );
      
      // Range should span 7 days
      const daysDiff = Math.ceil(
        (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(daysDiff).toBe(7);
    });

    it('should calculate date range for month', () => {
      const range = calculateDateRangeUTC(
        createUTCDate(2024, 0, 15),
        'month'
      );
      
      // Should cover all of January 2024
      expect(range.start.toISOString()).toMatch(/2024-01-01T00:00:00/);
      expect(range.end.toISOString()).toMatch(/2024-01-31T23:59:59/);
    });

    it('should handle DST month boundary (March)', () => {
      // March has DST transition in many regions
      const range = calculateDateRangeUTC(
        createUTCDate(2024, 2, 15),
        'month'
      );
      
      // UTC doesn't have DST, so should work fine
      expect(range.start.getUTCMonth()).toBe(2); // March
      expect(range.end.getUTCMonth()).toBe(2); // March
    });

    it('should handle year boundary', () => {
      const range = calculateDateRangeUTC(
        createUTCDate(2024, 11, 31),
        'day'
      );
      
      expect(range.start.toISOString()).toMatch(/2024-12-31T00:00:00/);
      expect(range.end.toISOString()).toMatch(/2024-12-31T23:59:59/);
    });
  });

  describe('Integration: API Response Format', () => {
    it('should format created_at as ISO 8601 UTC in API response', () => {
      const now = getUTCNow();
      const formatted = formatUTC(now);
      
      // Should be ISO 8601 with Z suffix (UTC)
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it('should parse ISO 8601 timestamp from database', () => {
      const dbTimestamp = '2024-01-15T14:30:45Z';
      const parsed = parseUTCTimestamp(dbTimestamp);
      
      expect(parsed).not.toBeNull();
      expect(formatUTC(parsed!)).toBe(dbTimestamp);
    });
  });

  describe('Integration: Cross-Timezone Querying', () => {
    it('should query date range correctly regardless of local timezone', () => {
      // Query attendance from 2024-01-15 00:00:00 UTC to 2024-01-15 23:59:59 UTC
      const range = calculateDateRangeUTC(
        createUTCDate(2024, 0, 15),
        'day'
      );
      
      // These times should be correct in UTC
      expect(range.start.toISOString()).toContain('2024-01-15T00:00:00');
      expect(range.end.toISOString()).toContain('2024-01-15T23:59:59');
    });

    it('should handle session querying across timezones', () => {
      // Morning session: 06:00-12:00 UTC
      const morningStart = createUTCDate(2024, 0, 15, 6, 0, 0);
      const morningEnd = createUTCDate(2024, 0, 15, 12, 0, 0);
      
      // Afternoon session: 13:00-18:00 UTC
      const afternoonStart = createUTCDate(2024, 0, 15, 13, 0, 0);
      const afternoonEnd = createUTCDate(2024, 0, 15, 18, 0, 0);
      
      // Sessions should not overlap
      expect(morningEnd.getTime()).toBeLessThan(afternoonStart.getTime());
    });
  });

  describe('Integration: DST Edge Cases', () => {
    it('should handle spring forward transition date (UTC unaffected)', () => {
      // March 10, 2024 is DST transition in US
      // But UTC doesn't change
      const date = createUTCDate(2024, 2, 10, 12, 0, 0);
      const iso = date.toISOString();
      
      expect(iso).toContain('2024-03-10T12:00:00');
      expect(iso).toContain('Z');
    });

    it('should handle fall back transition date (UTC unaffected)', () => {
      // November 3, 2024 is DST transition in US
      // But UTC doesn't change
      const date = createUTCDate(2024, 10, 3, 12, 0, 0);
      const iso = date.toISOString();
      
      expect(iso).toContain('2024-11-03T12:00:00');
      expect(iso).toContain('Z');
    });

    it('should calculate correct date ranges across DST boundary', () => {
      // Calculate range around March DST transition
      const range = calculateDateRangeUTC(
        createUTCDate(2024, 2, 10),
        'day'
      );
      
      // DST shouldn't affect UTC calculations
      const durationMs = range.end.getTime() - range.start.getTime();
      const durationDays = durationMs / (1000 * 60 * 60 * 24);
      
      expect(durationDays).toBeCloseTo(1, 1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle leap year date', () => {
      // Feb 29, 2024 (leap year)
      const date = createUTCDate(2024, 1, 29, 12, 0, 0);
      
      expect(date.getUTCDate()).toBe(29);
      expect(date.getUTCMonth()).toBe(1);
    });

    it('should handle last millisecond of year', () => {
      const date = createUTCDate(2024, 11, 31, 23, 59, 59, 999);
      const iso = date.toISOString();
      
      expect(iso).toContain('2024-12-31T23:59:59');
    });

    it('should handle first millisecond of year', () => {
      const date = createUTCDate(2024, 0, 1, 0, 0, 0, 0);
      const iso = date.toISOString();
      
      expect(iso).toContain('2024-01-01T00:00:00');
    });
  });
});
