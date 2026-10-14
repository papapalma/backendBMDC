/**
 * Philippine Timezone Tests
 *
 * Validates that:
 * - All session window checks use Philippine Time (PHT, UTC+8)
 * - Calendar calculations use PHT dates
 * - Cross-timezone boundaries are handled correctly
 * - DST transitions don't affect calculations (Philippines has no DST)
 * - Today's date in PHT is correctly calculated
 *
 * Validates: Requirements 13.1-13.5
 */

import {
  getNowInPHT,
  createPHTDate,
  getPHTDateComponents,
  getNowHHMMInPHT,
  calculateDateRangeInPHT,
  formatPHT,
  createUTCDate,
  formatUTC,
} from '@/lib/timezone';

describe('Philippine Timezone (PHT, UTC+8)', () => {
  describe('getNowInPHT', () => {
    it('should return current Date object', () => {
      const now = getNowInPHT();
      expect(now).toBeInstanceOf(Date);
      expect(!isNaN(now.getTime())).toBe(true);
    });

    it('should match getUTCNow (both return same underlying UTC time)', () => {
      const phtNow = getNowInPHT();
      const utcNow = new Date();
      // Should be very close (within 10ms)
      expect(Math.abs(phtNow.getTime() - utcNow.getTime())).toBeLessThan(10);
    });
  });

  describe('createPHTDate', () => {
    it('should create a PHT date with year, month, day', () => {
      // 2024-01-15 00:00:00 PHT = 2024-01-14 16:00:00 UTC
      const phtDate = createPHTDate(2024, 0, 15);
      const components = getPHTDateComponents(phtDate);

      expect(components.year).toBe(2024);
      expect(components.month).toBe(0); // January
      expect(components.date).toBe(15);
      expect(components.hours).toBe(0);
      expect(components.minutes).toBe(0);
      expect(components.seconds).toBe(0);
    });

    it('should create PHT date with full parameters', () => {
      // 2024-06-15 14:30:45 PHT = 2024-06-15 06:30:45 UTC
      const phtDate = createPHTDate(2024, 5, 15, 14, 30, 45);
      const components = getPHTDateComponents(phtDate);

      expect(components.year).toBe(2024);
      expect(components.month).toBe(5); // June
      expect(components.date).toBe(15);
      expect(components.hours).toBe(14);
      expect(components.minutes).toBe(30);
      expect(components.seconds).toBe(45);
    });

    it('should store internally as UTC but display as PHT', () => {
      // 2024-01-15 14:30:00 PHT
      const phtDate = createPHTDate(2024, 0, 15, 14, 30, 0);

      // Underlying UTC time should be 8 hours earlier
      const utcComponents = {
        year: phtDate.getUTCFullYear(),
        month: phtDate.getUTCMonth(),
        date: phtDate.getUTCDate(),
        hours: phtDate.getUTCHours(),
      };

      // UTC should be 2024-01-15 06:30:00 (8 hours earlier)
      expect(utcComponents.hours).toBe(6);
      expect(utcComponents.date).toBe(15);

      // But when we extract PHT components, should be 14:30
      const phtComponents = getPHTDateComponents(phtDate);
      expect(phtComponents.hours).toBe(14);
    });

    it('should handle PHT tomorrow crossing UTC date boundary', () => {
      // 2024-01-15 00:00:00 PHT (midnight in Philippines)
      // = 2024-01-14 16:00:00 UTC (previous UTC day)
      const phtDate = createPHTDate(2024, 0, 15);

      // PHT date should be 15
      const phtComponents = getPHTDateComponents(phtDate);
      expect(phtComponents.date).toBe(15);

      // But underlying UTC date is 14
      expect(phtDate.getUTCDate()).toBe(14);
    });

    it('should handle midnight roll-over correctly', () => {
      // 2024-01-15 00:00:00 PHT
      const start = createPHTDate(2024, 0, 15, 0, 0, 0);
      // 2024-01-15 23:59:59 PHT
      const end = createPHTDate(2024, 0, 15, 23, 59, 59);

      // Both should show date 15 in PHT
      expect(getPHTDateComponents(start).date).toBe(15);
      expect(getPHTDateComponents(end).date).toBe(15);

      // Start should be 8 hours before end
      const diffSeconds = (end.getTime() - start.getTime()) / 1000;
      expect(diffSeconds).toBeCloseTo(23 * 3600 + 59 * 60 + 59, -1);
    });
  });

  describe('getPHTDateComponents', () => {
    it('should extract correct PHT date from UTC date', () => {
      // Create UTC: 2024-01-15 06:30:45 UTC
      // This is: 2024-01-15 14:30:45 PHT (add 8 hours)
      const utcDate = createUTCDate(2024, 0, 15, 6, 30, 45);
      const components = getPHTDateComponents(utcDate);

      expect(components.year).toBe(2024);
      expect(components.month).toBe(0);
      expect(components.date).toBe(15);
      expect(components.hours).toBe(14);
      expect(components.minutes).toBe(30);
      expect(components.seconds).toBe(45);
    });

    it('should handle day boundary crossing backward (UTC early morning)', () => {
      // UTC: 2024-01-15 01:00:00 (early morning)
      // PHT: 2024-01-15 09:00:00
      const utcDate = createUTCDate(2024, 0, 15, 1, 0, 0);
      const components = getPHTDateComponents(utcDate);

      expect(components.date).toBe(15); // Same PHT day
      expect(components.hours).toBe(9);
    });

    it('should handle day boundary crossing forward (UTC late night)', () => {
      // UTC: 2024-01-14 16:00:00 (late evening before PHT midnight)
      // PHT: 2024-01-15 00:00:00 (midnight in Philippines)
      const utcDate = createUTCDate(2024, 0, 14, 16, 0, 0);
      const components = getPHTDateComponents(utcDate);

      expect(components.date).toBe(15); // Next PHT day
      expect(components.hours).toBe(0);
      expect(components.minutes).toBe(0);
    });

    it('should include day of week correctly', () => {
      // 2024-01-15 is a Monday in PHT
      const utcDate = createUTCDate(2024, 0, 15, 6, 0, 0);
      const components = getPHTDateComponents(utcDate);

      // Monday = 1 (0=Sunday, 1=Monday, etc.)
      expect(components.day).toBe(1);
    });
  });

  describe('getNowHHMMInPHT', () => {
    it('should return time string in HH:MM format', () => {
      const timeStr = getNowHHMMInPHT();
      expect(typeof timeStr).toBe('string');
      expect(timeStr).toMatch(/^\d{2}:\d{2}$/);
    });

    it('should return valid hours (00-23) and minutes (00-59)', () => {
      const timeStr = getNowHHMMInPHT();
      const [hours, minutes] = timeStr.split(':').map(Number);

      expect(hours).toBeGreaterThanOrEqual(0);
      expect(hours).toBeLessThanOrEqual(23);
      expect(minutes).toBeGreaterThanOrEqual(0);
      expect(minutes).toBeLessThanOrEqual(59);
    });

    it('should be in PHT (UTC+8)', () => {
      const phtTime = getNowHHMMInPHT();
      const utcNow = new Date();
      const utcHours = utcNow.getUTCHours();
      const utcMinutes = utcNow.getUTCMinutes();

      const [phtHours, phtMinutes] = phtTime.split(':').map(Number);
      const utcHoursStr = `${String(utcHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')}`;
      const [utcHoursFormatted, utcMinutesFormatted] = utcHoursStr.split(':').map(Number);

      // PHT should be roughly 8 hours ahead of UTC
      let expectedPHTHours = utcHoursFormatted + 8;
      if (expectedPHTHours >= 24) {
        expectedPHTHours -= 24;
      }

      // Allow small difference due to execution time
      const hoursDiff = (phtHours - expectedPHTHours + 24) % 24;
      expect(hoursDiff).toBeLessThanOrEqual(1);
    });
  });

  describe('calculateDateRangeInPHT', () => {
    it('should calculate single day range in PHT', () => {
      // 2024-01-15 PHT
      const phtDate = createPHTDate(2024, 0, 15);
      const range = calculateDateRangeInPHT(phtDate, 'day');

      const startComponents = getPHTDateComponents(range.start);
      const endComponents = getPHTDateComponents(range.end);

      // Start: 2024-01-15 00:00:00 PHT
      expect(startComponents.year).toBe(2024);
      expect(startComponents.month).toBe(0);
      expect(startComponents.date).toBe(15);
      expect(startComponents.hours).toBe(0);
      expect(startComponents.minutes).toBe(0);
      expect(startComponents.seconds).toBe(0);

      // End: 2024-01-15 23:59:59 PHT
      expect(endComponents.year).toBe(2024);
      expect(endComponents.month).toBe(0);
      expect(endComponents.date).toBe(15);
      expect(endComponents.hours).toBe(23);
      expect(endComponents.minutes).toBe(59);
      expect(endComponents.seconds).toBe(59);
    });

    it('should calculate week range covering 7 days', () => {
      // 2024-01-15 (Monday) PHT
      const phtDate = createPHTDate(2024, 0, 15);
      const range = calculateDateRangeInPHT(phtDate, 'week');

      // Week should be approximately 7 days
      const durationMs = range.end.getTime() - range.start.getTime();
      const durationDays = durationMs / (1000 * 60 * 60 * 24);

      expect(durationDays).toBeCloseTo(7, 0);
    });

    it('should calculate month range covering entire calendar month', () => {
      // 2024-01-15 PHT (January)
      const phtDate = createPHTDate(2024, 0, 15);
      const range = calculateDateRangeInPHT(phtDate, 'month');

      const startComponents = getPHTDateComponents(range.start);
      const endComponents = getPHTDateComponents(range.end);

      // Should cover January (month 0)
      expect(startComponents.month).toBe(0);
      expect(endComponents.month).toBe(0);

      // Start on 1st
      expect(startComponents.date).toBe(1);
      expect(startComponents.hours).toBe(0);

      // End on 31st (January has 31 days)
      expect(endComponents.date).toBe(31);
      expect(endComponents.hours).toBe(23);
    });

    it('should handle Feb 29 leap year correctly', () => {
      // 2024 is a leap year
      // 2024-02-29 PHT
      const phtDate = createPHTDate(2024, 1, 29);
      const range = calculateDateRangeInPHT(phtDate, 'month');

      const endComponents = getPHTDateComponents(range.end);

      // February 2024 ends on 29th (leap year)
      expect(endComponents.date).toBe(29);
    });

    it('should handle non-leap year February', () => {
      // 2023 is not a leap year
      // 2023-02-15 PHT
      const phtDate = createPHTDate(2023, 1, 15);
      const range = calculateDateRangeInPHT(phtDate, 'month');

      const endComponents = getPHTDateComponents(range.end);

      // February 2023 ends on 28th
      expect(endComponents.date).toBe(28);
    });

    it('should handle year boundary', () => {
      // 2024-12-31 (New Year's Eve) PHT
      const phtDate = createPHTDate(2024, 11, 31);
      const range = calculateDateRangeInPHT(phtDate, 'day');

      const endComponents = getPHTDateComponents(range.end);

      // Should stay in December
      expect(endComponents.month).toBe(11);
      expect(endComponents.date).toBe(31);
    });
  });

  describe('formatPHT', () => {
    it('should format PHT date as ISO string with +08:00 offset', () => {
      // 2024-01-15 14:30:45 PHT
      const phtDate = createPHTDate(2024, 0, 15, 14, 30, 45);
      const formatted = formatPHT(phtDate);

      expect(formatted).toBe('2024-01-15T14:30:45+08:00');
    });

    it('should format midnight correctly', () => {
      const phtDate = createPHTDate(2024, 0, 15, 0, 0, 0);
      const formatted = formatPHT(phtDate);

      expect(formatted).toBe('2024-01-15T00:00:00+08:00');
    });

    it('should format end of day correctly', () => {
      const phtDate = createPHTDate(2024, 0, 15, 23, 59, 59);
      const formatted = formatPHT(phtDate);

      expect(formatted).toBe('2024-01-15T23:59:59+08:00');
    });
  });

  describe('Integration: Cross-Timezone Boundaries', () => {
    it('PHT tomorrow equals UTC today (early morning)', () => {
      // Create UTC: 2024-01-15 01:00:00 UTC (January 15 morning UTC)
      // This is: 2024-01-15 09:00:00 PHT (January 15 morning PHT)
      const utcDate = createUTCDate(2024, 0, 15, 1, 0, 0);
      const phtComponents = getPHTDateComponents(utcDate);

      // PHT should be same date as UTC (01:00 UTC + 8 = 09:00 PHT)
      expect(phtComponents.date).toBe(15);
    });

    it('PHT yesterday equals UTC today (late evening)', () => {
      // Create UTC: 2024-01-15 16:00:00 UTC (January 15 evening UTC)
      // This is: 2024-01-16 00:00:00 PHT (January 16 midnight PHT)
      const utcDate = createUTCDate(2024, 0, 15, 16, 0, 0);
      const phtComponents = getPHTDateComponents(utcDate);

      // PHT should be next day
      expect(phtComponents.date).toBe(16);
      expect(phtComponents.hours).toBe(0);
    });

    it('Session window checks use PHT times correctly', () => {
      // Session opens at 06:00 PHT
      // Check at 2024-01-15 15:00:00 UTC = 2024-01-15 23:00:00 PHT (11 PM)
      const utcCheckTime = createUTCDate(2024, 0, 15, 15, 0, 0);
      const phtComponents = getPHTDateComponents(utcCheckTime);

      expect(phtComponents.hours).toBe(23);
      expect(phtComponents.minutes).toBe(0);

      // Session window 06:00-12:00 PHT is closed at 23:00 PHT
      const currentMinutes = phtComponents.hours * 60 + phtComponents.minutes;
      const windowOpenMinutes = 6 * 60;
      const windowCloseMinutes = 12 * 60;

      expect(currentMinutes).toBeGreaterThan(windowCloseMinutes);
    });

    it('Should handle DST transitions (Philippines has no DST)', () => {
      // March 10, 2024 is DST transition in US (UTC-5 → UTC-4)
      // But Philippines doesn't observe DST, always UTC+8
      const ustDate = createUTCDate(2024, 2, 10, 12, 0, 0);
      const phtComponents = getPHTDateComponents(ustDate);

      // Should still be 12:00 UTC + 8 = 20:00 PHT
      expect(phtComponents.hours).toBe(20);
    });
  });

  describe('Integration: Calendar Display in PHT', () => {
    it('should get correct calendar dates in PHT', () => {
      // Reference date in PHT: 2024-01-15 (any time)
      const phtDate = createPHTDate(2024, 0, 15, 12, 0, 0);
      const range = calculateDateRangeInPHT(phtDate, 'day');

      const startISO = formatUTC(range.start);
      const endISO = formatUTC(range.end);

      // Start should be at UTC time corresponding to PHT 00:00:00
      // 2024-01-15 00:00:00 PHT = 2024-01-14 16:00:00 UTC
      expect(startISO).toContain('2024-01-14');
      expect(startISO).toContain('16:00:00');

      // End should be at UTC time corresponding to PHT 23:59:59
      // 2024-01-15 23:59:59 PHT = 2024-01-15 15:59:59 UTC
      expect(endISO).toContain('2024-01-15');
      expect(endISO).toContain('15:59:59');
    });
  });

  describe('Edge Cases', () => {
    it('should handle year 2000 leap year', () => {
      const phtDate = createPHTDate(2000, 1, 29);
      const components = getPHTDateComponents(phtDate);

      expect(components.year).toBe(2000);
      expect(components.date).toBe(29);
    });

    it('should handle year 1900 non-leap year', () => {
      // 1900 is NOT a leap year (divisible by 100 but not 400)
      const phtDate = createPHTDate(1900, 1, 28);
      const components = getPHTDateComponents(phtDate);

      expect(components.year).toBe(1900);
      expect(components.date).toBe(28);
    });

    it('should handle far future dates', () => {
      const phtDate = createPHTDate(2099, 11, 31, 23, 59, 59);
      const components = getPHTDateComponents(phtDate);

      expect(components.year).toBe(2099);
      expect(components.month).toBe(11); // December
      expect(components.date).toBe(31);
    });
  });
});
