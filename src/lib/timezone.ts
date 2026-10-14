/**
 * UTC Timezone Utilities
 * 
 * All functions operate exclusively in UTC to prevent timezone-related bugs
 * including daylight saving time issues and cross-timezone deployment failures.
 * 
 * Rule: Always use UTC for timestamps in the application.
 * - Database: TIMESTAMPTZ columns store UTC
 * - API: Always return ISO 8601 UTC strings (ending with Z)
 * - Code: Use getUTCNow() instead of new Date()
 * 
 * Ponytail: Using native Date.UTC() — no date library needed.
 */

/**
 * Create a UTC date from year, month, day, and optional time components
 * 
 * @param year - Full year (e.g., 2024)
 * @param month - Month (0-11, where 0 is January)
 * @param day - Day of month (1-31)
 * @param hours - Hours (0-23), optional, defaults to 0
 * @param minutes - Minutes (0-59), optional, defaults to 0
 * @param seconds - Seconds (0-59), optional, defaults to 0
 * @param milliseconds - Milliseconds (0-999), optional, defaults to 0
 * @returns Date object in UTC
 * 
 * Example:
 *   // 2024-01-15 14:30:45 UTC
 *   const date = createUTCDate(2024, 0, 15, 14, 30, 45);
 */
export function createUTCDate(
  year: number,
  month: number,
  day: number,
  hours: number = 0,
  minutes: number = 0,
  seconds: number = 0,
  milliseconds: number = 0
): Date {
  return new Date(Date.UTC(year, month, day, hours, minutes, seconds, milliseconds));
}

/**
 * Get current time in UTC
 * 
 * @returns Current Date object in UTC (as all JS dates are)
 * 
 * Example:
 *   const now = getUTCNow();
 *   console.log(now.toISOString()); // 2024-01-15T14:30:45.123Z
 */
export function getUTCNow(): Date {
  return new Date();
}

/**
 * Format a UTC date as ISO 8601 string without milliseconds
 * 
 * @param date - Date object to format
 * @returns ISO 8601 UTC string (e.g., "2024-01-15T14:30:45Z")
 * 
 * Example:
 *   const date = createUTCDate(2024, 0, 15, 14, 30, 45);
 *   formatUTC(date); // "2024-01-15T14:30:45Z"
 */
export function formatUTC(date: Date): string {
  const iso = date.toISOString();
  // Remove milliseconds: "2024-01-15T14:30:45.123Z" -> "2024-01-15T14:30:45Z"
  return iso.replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Check if a string is a valid UTC timestamp in ISO 8601 format
 * 
 * Valid formats:
 *   - 2024-01-15T14:30:45Z
 *   - 2024-01-15T14:30:45.123Z
 *   - 2024-01-15T14:30Z
 * 
 * Invalid formats:
 *   - 2024-01-15T14:30:45 (missing Z)
 *   - 2024-01-15T14:30:45-05:00 (non-UTC timezone)
 *   - 2024-01-15 14:30:45 (space instead of T)
 * 
 * @param timestamp - String to validate
 * @returns true if valid UTC ISO 8601, false otherwise
 */
export function isValidUTCTimestamp(timestamp: string): boolean {
  if (!timestamp || typeof timestamp !== 'string') return false;
  
  // Check format: YYYY-MM-DDTHH:MM:SS[.sss]Z
  const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z$/;
  if (!utcPattern.test(timestamp)) return false;
  
  // Verify it's a valid date
  try {
    const date = new Date(timestamp);
    return !isNaN(date.getTime());
  } catch {
    return false;
  }
}

/**
 * Parse an ISO 8601 UTC timestamp string into a Date object
 * 
 * @param timestamp - ISO 8601 UTC string (e.g., "2024-01-15T14:30:45Z")
 * @returns Date object, or null if invalid
 * 
 * Example:
 *   const date = parseUTCTimestamp('2024-01-15T14:30:45Z');
 *   if (date) console.log(date.getUTCHours()); // 14
 */
export function parseUTCTimestamp(timestamp: string): Date | null {
  if (!isValidUTCTimestamp(timestamp)) return null;
  
  const date = new Date(timestamp);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Date range information
 */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Calculate a UTC date range for querying
 * 
 * @param date - Reference date (will use UTC date components)
 * @param period - Period type: 'day', 'week', or 'month'
 * @returns Object with start and end dates (both inclusive, as ISO times)
 * 
 * Examples:
 *   // Single day: 2024-01-15 00:00:00 UTC to 2024-01-15 23:59:59 UTC
 *   const day = calculateDateRangeUTC(createUTCDate(2024, 0, 15), 'day');
 *   
 *   // Week: 7 consecutive days
 *   const week = calculateDateRangeUTC(createUTCDate(2024, 0, 15), 'week');
 *   
 *   // Month: entire calendar month in UTC
 *   const month = calculateDateRangeUTC(createUTCDate(2024, 0, 15), 'month');
 */
export function calculateDateRangeUTC(date: Date, period: 'day' | 'week' | 'month'): DateRange {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  let start: Date;
  let end: Date;

  if (period === 'day') {
    // Start: 00:00:00 UTC on this day
    start = createUTCDate(year, month, day, 0, 0, 0);
    // End: 23:59:59 UTC on this day
    end = createUTCDate(year, month, day, 23, 59, 59);
  } else if (period === 'week') {
    // Start: first day of week (Monday) at 00:00:00 UTC
    const dayOfWeek = date.getUTCDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startDay = day - daysToMonday;
    start = createUTCDate(year, month, startDay, 0, 0, 0);
    
    // End: 7 days later - 1 second (Sunday 23:59:59 UTC)
    const endDate = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1000);
    end = endDate;
  } else if (period === 'month') {
    // Start: 00:00:00 UTC on first day of month
    start = createUTCDate(year, month, 1, 0, 0, 0);
    // End: 23:59:59 UTC on last day of month
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    end = createUTCDate(year, month, lastDay, 23, 59, 59);
  } else {
    throw new Error(`Unknown period: ${period}`);
  }

  return { start, end };
}

/**
 * Convert a Date to ISO 8601 UTC string (same as toISOString)
 * Useful for API responses and database storage.
 * 
 * @param date - Date to convert
 * @returns ISO 8601 UTC string with milliseconds
 * 
 * Example:
 *   const date = getUTCNow();
 *   toISOUTC(date); // "2024-01-15T14:30:45.123Z"
 */
export function toISOUTC(date: Date): string {
  return date.toISOString();
}

/**
 * Get Unix timestamp (milliseconds since epoch) from a UTC date
 * 
 * @param date - Date to convert
 * @returns Unix timestamp in milliseconds
 * 
 * Example:
 *   const date = createUTCDate(2024, 0, 15, 14, 30, 45);
 *   const timestamp = toUnixMs(date); // 1705338645000
 */
export function toUnixMs(date: Date): number {
  return date.getTime();
}

/**
 * Create a Date from Unix timestamp (milliseconds)
 * 
 * @param timestampMs - Unix timestamp in milliseconds
 * @returns Date object
 * 
 * Example:
 *   const date = fromUnixMs(1705338645000);
 */
export function fromUnixMs(timestampMs: number): Date {
  return new Date(timestampMs);
}

/**
 * Add milliseconds to a UTC date
 * 
 * @param date - Base date
 * @param ms - Milliseconds to add
 * @returns New Date object
 * 
 * Example:
 *   const now = getUTCNow();
 *   const oneHourLater = addMillisecondsUTC(now, 60 * 60 * 1000);
 */
export function addMillisecondsUTC(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

/**
 * Calculate difference between two UTC dates in milliseconds
 * 
 * @param start - Start date
 * @param end - End date
 * @returns Difference in milliseconds (end - start)
 * 
 * Example:
 *   const diff = differenceMs(date1, date2);
 *   const seconds = diff / 1000;
 *   const hours = diff / (1000 * 60 * 60);
 */
export function differenceMs(start: Date, end: Date): number {
  return end.getTime() - start.getTime();
}

// ============================================================================
// Philippine Timezone (PHT, UTC+8) — No DST
// ============================================================================

/**
 * UTC offset for Philippine Time (PHT) in milliseconds
 * Philippines does not observe DST, always UTC+8
 * ponytail: hardcoded offset, no need for complex TZ library
 */
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

/**
 * Get current time converted to Philippine Time (UTC+8)
 * 
 * @returns Current Date object (internal value is UTC, displayed as PHT)
 * 
 * Example:
 *   const now = getNowInPHT();
 *   const components = getPHTDateComponents(now);
 *   console.log(components); // { year: 2024, month: 1, date: 15, hours: 22, ... }
 */
export function getNowInPHT(): Date {
  return new Date();
}

/**
 * Create a Date in Philippine Time, return as UTC Date object
 * 
 * Note: The returned Date object stores UTC internally. To work with PHT
 * date components (e.g., calendar calculations), use getPHTDateComponents().
 * 
 * @param year - Full year (e.g., 2024)
 * @param month - Month (0-11, where 0 is January)
 * @param day - Day of month (1-31)
 * @param hours - Hours in PHT (0-23), optional, defaults to 0
 * @param minutes - Minutes (0-59), optional, defaults to 0
 * @param seconds - Seconds (0-59), optional, defaults to 0
 * @returns Date object representing the PHT date/time (stored as UTC internally)
 * 
 * Example:
 *   // 2024-01-15 14:30:45 PHT
 *   const date = createPHTDate(2024, 0, 15, 14, 30, 45);
 *   const utcDate = date.toISOString(); // 2024-01-15T06:30:45.000Z (8 hours earlier)
 *   const phtDate = getPHTDateComponents(date); // { year: 2024, month: 0, date: 15, hours: 14, ... }
 */
export function createPHTDate(
  year: number,
  month: number,
  day: number,
  hours: number = 0,
  minutes: number = 0,
  seconds: number = 0
): Date {
  // Create UTC date, then subtract PHT offset to get the UTC representation
  // that will display as the desired PHT time
  const utcDate = createUTCDate(year, month, day, hours, minutes, seconds);
  return new Date(utcDate.getTime() - PHT_OFFSET_MS);
}

/**
 * Extract Philippine Time date/time components from a UTC Date
 * 
 * @param date - UTC Date object
 * @returns Object with PHT components { year, month, date, hours, minutes, seconds, milliseconds, day }
 * 
 * Example:
 *   const utcDate = new Date('2024-01-15T06:30:45Z');
 *   const pht = getPHTDateComponents(utcDate);
 *   console.log(pht.hours); // 14 (UTC+8)
 *   console.log(pht.date);  // 15
 */
export function getPHTDateComponents(date: Date): {
  year: number;
  month: number;
  date: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
  day: number; // 0 = Sunday, 6 = Saturday
} {
  // Adjust UTC time by PHT offset
  const phtTime = date.getTime() + PHT_OFFSET_MS;
  const phtDate = new Date(phtTime);

  return {
    year: phtDate.getUTCFullYear(),
    month: phtDate.getUTCMonth(),
    date: phtDate.getUTCDate(),
    hours: phtDate.getUTCHours(),
    minutes: phtDate.getUTCMinutes(),
    seconds: phtDate.getUTCSeconds(),
    milliseconds: phtDate.getUTCMilliseconds(),
    day: phtDate.getUTCDay(),
  };
}

/**
 * Get current time as HH:MM string in Philippine Time
 * 
 * @returns Time string in format "HH:MM" (e.g., "14:30")
 * 
 * Example:
 *   const timeStr = getNowHHMMInPHT();
 *   console.log(timeStr); // "14:30"
 */
export function getNowHHMMInPHT(): string {
  const now = getNowInPHT();
  const components = getPHTDateComponents(now);
  const h = String(components.hours).padStart(2, '0');
  const m = String(components.minutes).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Calculate a date range in Philippine Time for querying
 * 
 * @param date - Reference date (will use PHT date components)
 * @param period - Period type: 'day', 'week', or 'month'
 * @returns Object with start and end dates (both in UTC, but representing PHT range)
 * 
 * Examples:
 *   // Single PHT day: 2024-01-15 00:00:00 PHT to 2024-01-15 23:59:59 PHT
 *   const day = calculateDateRangeInPHT(createPHTDate(2024, 0, 15), 'day');
 *   
 *   // Week: 7 consecutive days in PHT calendar
 *   const week = calculateDateRangeInPHT(createPHTDate(2024, 0, 15), 'week');
 *   
 *   // Month: entire calendar month in PHT
 *   const month = calculateDateRangeInPHT(createPHTDate(2024, 0, 15), 'month');
 */
export function calculateDateRangeInPHT(
  date: Date,
  period: 'day' | 'week' | 'month'
): DateRange {
  const components = getPHTDateComponents(date);
  const year = components.year;
  const month = components.month;
  const dateOfMonth = components.date;

  let startPHT: Date;
  let endPHT: Date;

  if (period === 'day') {
    // PHT start: 00:00:00 PHT on this day
    startPHT = createPHTDate(year, month, dateOfMonth, 0, 0, 0);
    // PHT end: 23:59:59 PHT on this day
    endPHT = createPHTDate(year, month, dateOfMonth, 23, 59, 59);
  } else if (period === 'week') {
    // PHT start: first day of week (Monday) at 00:00:00 PHT
    const dayOfWeek = components.day;
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startDate = dateOfMonth - daysToMonday;
    startPHT = createPHTDate(year, month, startDate, 0, 0, 0);

    // PHT end: 7 days later - 1 second (Sunday 23:59:59 PHT)
    const endTime = startPHT.getTime() + 7 * 24 * 60 * 60 * 1000 - 1000;
    endPHT = new Date(endTime);
  } else if (period === 'month') {
    // PHT start: 00:00:00 PHT on first day of month
    startPHT = createPHTDate(year, month, 1, 0, 0, 0);

    // PHT end: 23:59:59 PHT on last day of month
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    endPHT = createPHTDate(year, month, lastDay, 23, 59, 59);
  } else {
    throw new Error(`Unknown period: ${period}`);
  }

  return { start: startPHT, end: endPHT };
}

/**
 * Format a PHT date as ISO 8601 string without milliseconds
 * 
 * @param date - UTC Date object to format as PHT
 * @returns ISO 8601 PHT string (e.g., "2024-01-15T14:30:45+08:00")
 * 
 * Example:
 *   const date = createPHTDate(2024, 0, 15, 14, 30, 45);
 *   formatPHT(date); // "2024-01-15T14:30:45+08:00"
 */
export function formatPHT(date: Date): string {
  const components = getPHTDateComponents(date);
  const year = String(components.year).padStart(4, '0');
  const month = String(components.month + 1).padStart(2, '0');
  const day = String(components.date).padStart(2, '0');
  const hours = String(components.hours).padStart(2, '0');
  const minutes = String(components.minutes).padStart(2, '0');
  const seconds = String(components.seconds).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`;
}
