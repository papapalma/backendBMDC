/**
 * CMS Sanitization Service
 * Handles sanitization of all user input to prevent XSS and injection attacks
 *
 * Requirements: 14.2, 14.3
 */

import { SanitizationError } from '@/lib/cms-errors';

export class CMSSanitizationService {
  // Patterns that indicate potential XSS or injection attacks
  private static readonly XSS_PATTERNS = [
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /on\w+\s*=/gi, // Event handlers like onclick=, onerror=
    /javascript:/gi,
    /vbscript:/gi,
    /<embed[^>]*>/gi,
    /<object[^>]*>/gi,
  ];

  // SQL injection patterns
  private static readonly SQL_INJECTION_PATTERNS = [
    /(\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
    /(-{2}|\/\*|\*\/|;)/,
    /(--|\||&&)/,
  ];

  // CSS injection patterns
  private static readonly CSS_INJECTION_PATTERNS = [
    /expression\s*\(/gi,
    /javascript:/gi,
    /@import/gi,
    /<style[^>]*>/gi,
    /<\/style>/gi,
  ];

  /**
   * Sanitize string input to prevent XSS attacks
   * Removes or escapes potentially dangerous HTML/JavaScript
   */
  static sanitizeString(
    input: string,
    maxLength: number = 2000,
    fieldName?: string
  ): string {
    if (typeof input !== 'string') {
      throw new SanitizationError(
        `Input must be a string`,
        fieldName,
        'TYPE_ERROR'
      );
    }

    // Trim whitespace
    let sanitized = input.trim();

    // Check length
    if (sanitized.length > maxLength) {
      throw new SanitizationError(
        `Input exceeds maximum length of ${maxLength} characters`,
        fieldName,
        'LENGTH_ERROR'
      );
    }

    // Check for XSS patterns
    for (const pattern of this.XSS_PATTERNS) {
      if (pattern.test(sanitized)) {
        throw new SanitizationError(
          `Input contains potentially malicious content (${pattern.source})`,
          fieldName,
          'XSS_PATTERN'
        );
      }
    }

    // Escape HTML entities
    sanitized = this.escapeHtml(sanitized);

    return sanitized;
  }

  /**
   * Sanitize CSS value to prevent CSS injection
   * Validates against expression() and javascript: protocol
   */
  static sanitizeCSSValue(
    input: string,
    fieldName?: string
  ): string {
    if (typeof input !== 'string') {
      throw new SanitizationError(
        `CSS value must be a string`,
        fieldName,
        'TYPE_ERROR'
      );
    }

    const sanitized = input.trim();

    // Check length
    if (sanitized.length > 500) {
      throw new SanitizationError(
        `CSS value exceeds maximum length of 500 characters`,
        fieldName,
        'LENGTH_ERROR'
      );
    }

    // Check for CSS injection patterns
    for (const pattern of this.CSS_INJECTION_PATTERNS) {
      if (pattern.test(sanitized)) {
        throw new SanitizationError(
          `CSS value contains potentially dangerous pattern`,
          fieldName,
          'CSS_INJECTION'
        );
      }
    }

    return sanitized;
  }

  /**
   * Sanitize URL to prevent javascript: and data: protocols
   */
  static sanitizeUrl(
    input: string,
    fieldName?: string
  ): string {
    if (typeof input !== 'string') {
      throw new SanitizationError(
        `URL must be a string`,
        fieldName,
        'TYPE_ERROR'
      );
    }

    const sanitized = input.trim();

    // Check length
    if (sanitized.length > 2048) {
      throw new SanitizationError(
        `URL exceeds maximum length of 2048 characters`,
        fieldName,
        'LENGTH_ERROR'
      );
    }

    // Prevent dangerous protocols
    const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
    const lowerUrl = sanitized.toLowerCase();
    
    for (const protocol of dangerousProtocols) {
      if (lowerUrl.startsWith(protocol)) {
        throw new SanitizationError(
          `URL contains dangerous protocol: ${protocol}`,
          fieldName,
          'DANGEROUS_PROTOCOL'
        );
      }
    }

    // Validate URL format
    try {
      const url = new URL(sanitized);
      return sanitized;
    } catch {
      throw new SanitizationError(
        `Invalid URL format`,
        fieldName,
        'INVALID_URL'
      );
    }
  }

  /**
   * Sanitize color value (hex, RGB, HSL)
   * Prevents any injection through color values
   */
  static sanitizeColor(
    input: string,
    fieldName?: string
  ): string {
    if (typeof input !== 'string') {
      throw new SanitizationError(
        `Color must be a string`,
        fieldName,
        'TYPE_ERROR'
      );
    }

    const sanitized = input.trim();

    // Check length (colors should be short)
    if (sanitized.length > 50) {
      throw new SanitizationError(
        `Color value exceeds maximum length`,
        fieldName,
        'LENGTH_ERROR'
      );
    }

    // Allow only color-related characters and patterns
    // Hex: #RRGGBB
    // RGB: rgb(r,g,b) or rgba(r,g,b,a)
    // HSL: hsl(h,s%,l%) or hsla(h,s%,l%,a)
    const colorRegex = /^(#[0-9A-Fa-f]{6}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)|hsla?\(\s*\d+\s*,\s*\d+%?\s*,\s*\d+%?\s*(?:,\s*[\d.]+\s*)?\))$/;

    if (!colorRegex.test(sanitized)) {
      throw new SanitizationError(
        `Invalid color format`,
        fieldName,
        'INVALID_FORMAT'
      );
    }

    // Check for any dangerous patterns even within valid color strings
    for (const pattern of this.XSS_PATTERNS) {
      if (pattern.test(sanitized)) {
        throw new SanitizationError(
          `Color value contains potentially dangerous content`,
          fieldName,
          'DANGEROUS_CONTENT'
        );
      }
    }

    return sanitized;
  }

  /**
   * Sanitize numeric input to ensure it's safe
   * Prevents injection through numeric values
   */
  static sanitizeNumeric(
    input: any,
    fieldName?: string,
    min?: number,
    max?: number
  ): number {
    // Allow only numbers
    if (typeof input === 'string') {
      if (!/^-?\d+(\.\d+)?$/.test(input)) {
        throw new SanitizationError(
          `Numeric input contains invalid characters`,
          fieldName,
          'INVALID_FORMAT'
        );
      }
      input = parseFloat(input);
    }

    if (!Number.isFinite(input)) {
      throw new SanitizationError(
        `Input must be a valid number`,
        fieldName,
        'INVALID_NUMBER'
      );
    }

    if (min !== undefined && input < min) {
      throw new SanitizationError(
        `Numeric value must be at least ${min}`,
        fieldName,
        'OUT_OF_RANGE'
      );
    }

    if (max !== undefined && input > max) {
      throw new SanitizationError(
        `Numeric value must not exceed ${max}`,
        fieldName,
        'OUT_OF_RANGE'
      );
    }

    return input;
  }

  /**
   * Sanitize font family name
   * Prevents injection through font names
   */
  static sanitizeFontFamily(
    input: string,
    fieldName?: string
  ): string {
    if (typeof input !== 'string') {
      throw new SanitizationError(
        `Font family must be a string`,
        fieldName,
        'TYPE_ERROR'
      );
    }

    const sanitized = input.trim();

    // Check length
    if (sanitized.length > 100) {
      throw new SanitizationError(
        `Font family name exceeds maximum length`,
        fieldName,
        'LENGTH_ERROR'
      );
    }

    // Only allow alphanumeric, spaces, hyphens, and quotes for font names
    // Examples: "Poppins", "Open Sans", 'Helvetica Neue', sans-serif
    const fontRegex = /^['"]?[a-zA-Z0-9\s\-,]+['"]?$/;

    if (!fontRegex.test(sanitized)) {
      throw new SanitizationError(
        `Font family contains invalid characters`,
        fieldName,
        'INVALID_FORMAT'
      );
    }

    // Check for SQL injection patterns
    for (const pattern of this.SQL_INJECTION_PATTERNS) {
      if (pattern.test(sanitized)) {
        throw new SanitizationError(
          `Font family contains SQL keywords`,
          fieldName,
          'SQL_INJECTION'
        );
      }
    }

    return sanitized;
  }

  /**
   * Sanitize email address
   */
  static sanitizeEmail(
    input: string,
    fieldName?: string
  ): string {
    if (typeof input !== 'string') {
      throw new SanitizationError(
        `Email must be a string`,
        fieldName,
        'TYPE_ERROR'
      );
    }

    const sanitized = input.trim().toLowerCase();

    // Check length
    if (sanitized.length > 255) {
      throw new SanitizationError(
        `Email exceeds maximum length`,
        fieldName,
        'LENGTH_ERROR'
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitized)) {
      throw new SanitizationError(
        `Invalid email format`,
        fieldName,
        'INVALID_FORMAT'
      );
    }

    return sanitized;
  }

  /**
   * Sanitize phone number
   */
  static sanitizePhone(
    input: string,
    fieldName?: string
  ): string {
    if (typeof input !== 'string') {
      throw new SanitizationError(
        `Phone must be a string`,
        fieldName,
        'TYPE_ERROR'
      );
    }

    const sanitized = input.trim();

    // Check length
    if (sanitized.length > 20) {
      throw new SanitizationError(
        `Phone number exceeds maximum length`,
        fieldName,
        'LENGTH_ERROR'
      );
    }

    // Only allow digits, +, -, space, (), .
    const phoneRegex = /^[0-9+\-\s().]*/;
    if (!phoneRegex.test(sanitized)) {
      throw new SanitizationError(
        `Phone number contains invalid characters`,
        fieldName,
        'INVALID_FORMAT'
      );
    }

    return sanitized;
  }

  /**
   * Sanitize object by applying sanitization to all string values
   * Recursively processes nested objects
   */
  static sanitizeObject(
    obj: any,
    maxDepth: number = 5,
    currentDepth: number = 0
  ): any {
    // Prevent deep recursion
    if (currentDepth >= maxDepth) {
      return obj;
    }

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      // Don't throw on sanitization errors for object sanitization
      // Just return the original value if it contains patterns
      try {
        return this.sanitizeString(obj);
      } catch {
        // If sanitization fails, return sanitized version without dangerous patterns
        return obj.replace(/<[^>]*>/g, '');
      }
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item, maxDepth, currentDepth + 1));
    }

    if (typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = this.sanitizeObject(value, maxDepth, currentDepth + 1);
      }
      return sanitized;
    }

    return obj;
  }

  /**
   * Helper: Escape HTML entities
   * Converts characters that could be interpreted as HTML to their entity equivalents
   */
  private static escapeHtml(text: string): string {
    const htmlEscapeMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char] || char);
  }

  /**
   * Check if string contains SQL injection attempts
   */
  static containsSQLInjection(input: string): boolean {
    for (const pattern of this.SQL_INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if string contains XSS attempts
   */
  static containsXSS(input: string): boolean {
    for (const pattern of this.XSS_PATTERNS) {
      if (pattern.test(input)) {
        return true;
      }
    }
    return false;
  }
}
