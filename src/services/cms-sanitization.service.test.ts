/**
 * Unit Tests for CMSSanitizationService
 * Tests XSS prevention, injection detection, and input sanitization
 *
 * Requirements: 14.2, 14.3
 */

import { CMSSanitizationService } from './cms-sanitization.service';
import { SanitizationError } from '@/lib/cms-errors';

describe('CMSSanitizationService', () => {
  describe('String Sanitization - XSS Prevention', () => {
    it('should accept safe strings', () => {
      const result = CMSSanitizationService.sanitizeString('Hello World');
      expect(result).toBe('Hello World');
    });

    it('should reject script tags', () => {
      expect(() => {
        CMSSanitizationService.sanitizeString('<script>alert("XSS")</script>');
      }).toThrow(SanitizationError);
    });

    it('should reject iframe tags', () => {
      expect(() => {
        CMSSanitizationService.sanitizeString('<iframe src="evil.com"></iframe>');
      }).toThrow(SanitizationError);
    });

    it('should reject event handlers', () => {
      expect(() => {
        CMSSanitizationService.sanitizeString('<div onclick="alert(\'XSS\')">Click</div>');
      }).toThrow(SanitizationError);
    });

    it('should reject onerror handler', () => {
      expect(() => {
        CMSSanitizationService.sanitizeString('<img onerror="alert(\'XSS\')" />');
      }).toThrow(SanitizationError);
    });

    it('should reject javascript: protocol', () => {
      expect(() => {
        CMSSanitizationService.sanitizeString('javascript:alert("XSS")');
      }).toThrow(SanitizationError);
    });

    it('should reject vbscript: protocol', () => {
      expect(() => {
        CMSSanitizationService.sanitizeString('vbscript:msgbox("XSS")');
      }).toThrow(SanitizationError);
    });

    it('should reject embed tags', () => {
      expect(() => {
        CMSSanitizationService.sanitizeString('<embed src="evil.swf" />');
      }).toThrow(SanitizationError);
    });

    it('should reject object tags', () => {
      expect(() => {
        CMSSanitizationService.sanitizeString('<object data="evil.swf"></object>');
      }).toThrow(SanitizationError);
    });

    it('should escape HTML entities', () => {
      const result = CMSSanitizationService.sanitizeString('A < B & C > D');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
      expect(result).toContain('&amp;');
    });

    it('should reject strings exceeding max length', () => {
      const longString = 'A'.repeat(2001);
      expect(() => {
        CMSSanitizationService.sanitizeString(longString);
      }).toThrow(SanitizationError);
    });

    it('should reject non-string input', () => {
      expect(() => {
        CMSSanitizationService.sanitizeString(123 as any);
      }).toThrow(SanitizationError);
    });
  });

  describe('Color Sanitization', () => {
    it('should accept valid hex colors', () => {
      const result = CMSSanitizationService.sanitizeColor('#3B82F6');
      expect(result).toBe('#3B82F6');
    });

    it('should accept valid RGB colors', () => {
      const result = CMSSanitizationService.sanitizeColor('rgb(59, 130, 246)');
      expect(result).toBe('rgb(59, 130, 246)');
    });

    it('should accept valid RGBA colors', () => {
      const result = CMSSanitizationService.sanitizeColor('rgba(59, 130, 246, 0.5)');
      expect(result).toBe('rgba(59, 130, 246, 0.5)');
    });

    it('should accept valid HSL colors', () => {
      const result = CMSSanitizationService.sanitizeColor('hsl(217, 91%, 60%)');
      expect(result).toBe('hsl(217, 91%, 60%)');
    });

    it('should reject invalid color format', () => {
      expect(() => {
        CMSSanitizationService.sanitizeColor('not-a-color');
      }).toThrow(SanitizationError);
    });

    it('should reject colors with injection attempts', () => {
      expect(() => {
        CMSSanitizationService.sanitizeColor('#3B82F6<script>');
      }).toThrow(SanitizationError);
    });

    it('should reject colors exceeding length limit', () => {
      expect(() => {
        CMSSanitizationService.sanitizeColor('#' + 'A'.repeat(100));
      }).toThrow(SanitizationError);
    });
  });

  describe('URL Sanitization', () => {
    it('should accept valid HTTPS URLs', () => {
      const result = CMSSanitizationService.sanitizeUrl('https://example.com/page');
      expect(result).toBe('https://example.com/page');
    });

    it('should accept valid HTTP URLs', () => {
      const result = CMSSanitizationService.sanitizeUrl('http://example.com');
      expect(result).toBe('http://example.com');
    });

    it('should reject javascript: protocol', () => {
      expect(() => {
        CMSSanitizationService.sanitizeUrl('javascript:alert("XSS")');
      }).toThrow(SanitizationError);
    });

    it('should reject data: protocol', () => {
      expect(() => {
        CMSSanitizationService.sanitizeUrl('data:text/html,<script>alert("XSS")</script>');
      }).toThrow(SanitizationError);
    });

    it('should reject vbscript: protocol', () => {
      expect(() => {
        CMSSanitizationService.sanitizeUrl('vbscript:msgbox("XSS")');
      }).toThrow(SanitizationError);
    });

    it('should reject file: protocol', () => {
      expect(() => {
        CMSSanitizationService.sanitizeUrl('file:///etc/passwd');
      }).toThrow(SanitizationError);
    });

    it('should reject invalid URL format', () => {
      expect(() => {
        CMSSanitizationService.sanitizeUrl('not a url');
      }).toThrow(SanitizationError);
    });

    it('should reject URLs exceeding max length', () => {
      const longUrl = 'https://example.com/' + 'A'.repeat(2500);
      expect(() => {
        CMSSanitizationService.sanitizeUrl(longUrl);
      }).toThrow(SanitizationError);
    });
  });

  describe('CSS Value Sanitization', () => {
    it('should accept valid CSS values', () => {
      const result = CMSSanitizationService.sanitizeCSSValue('1200px');
      expect(result).toBe('1200px');
    });

    it('should reject expression() function', () => {
      expect(() => {
        CMSSanitizationService.sanitizeCSSValue('expression(alert("XSS"))');
      }).toThrow(SanitizationError);
    });

    it('should reject javascript: in CSS', () => {
      expect(() => {
        CMSSanitizationService.sanitizeCSSValue('javascript:alert("XSS")');
      }).toThrow(SanitizationError);
    });

    it('should reject @import in CSS', () => {
      expect(() => {
        CMSSanitizationService.sanitizeCSSValue('@import url("evil.css")');
      }).toThrow(SanitizationError);
    });

    it('should reject style tags in CSS', () => {
      expect(() => {
        CMSSanitizationService.sanitizeCSSValue('<style>body { color: red; }</style>');
      }).toThrow(SanitizationError);
    });
  });

  describe('Numeric Sanitization', () => {
    it('should accept valid numbers', () => {
      const result = CMSSanitizationService.sanitizeNumeric('42', undefined, 0, 100);
      expect(result).toBe(42);
    });

    it('should accept negative numbers', () => {
      const result = CMSSanitizationService.sanitizeNumeric('-10', undefined, -100, 0);
      expect(result).toBe(-10);
    });

    it('should accept floating point numbers', () => {
      const result = CMSSanitizationService.sanitizeNumeric('3.14', undefined, 0, 10);
      expect(result).toBe(3.14);
    });

    it('should reject non-numeric strings', () => {
      expect(() => {
        CMSSanitizationService.sanitizeNumeric('abc123', undefined, 0, 100);
      }).toThrow(SanitizationError);
    });

    it('should reject values below minimum', () => {
      expect(() => {
        CMSSanitizationService.sanitizeNumeric('5', undefined, 10, 100);
      }).toThrow(SanitizationError);
    });

    it('should reject values exceeding maximum', () => {
      expect(() => {
        CMSSanitizationService.sanitizeNumeric('150', undefined, 0, 100);
      }).toThrow(SanitizationError);
    });

    it('should reject non-finite numbers', () => {
      expect(() => {
        CMSSanitizationService.sanitizeNumeric(Infinity);
      }).toThrow(SanitizationError);
    });
  });

  describe('Font Family Sanitization', () => {
    it('should accept valid font families', () => {
      const result = CMSSanitizationService.sanitizeFontFamily('Poppins');
      expect(result).toBe('Poppins');
    });

    it('should accept quoted font families', () => {
      const result = CMSSanitizationService.sanitizeFontFamily('"Open Sans"');
      expect(result).toBe('"Open Sans"');
    });

    it('should accept font family lists', () => {
      const result = CMSSanitizationService.sanitizeFontFamily('Poppins, sans-serif');
      expect(result).toBe('Poppins, sans-serif');
    });

    it('should reject font families with special characters', () => {
      expect(() => {
        CMSSanitizationService.sanitizeFontFamily('Font@Name!#$');
      }).toThrow(SanitizationError);
    });

    it('should reject font families with SQL keywords', () => {
      expect(() => {
        CMSSanitizationService.sanitizeFontFamily('SELECT * FROM fonts');
      }).toThrow(SanitizationError);
    });

    it('should reject font families exceeding max length', () => {
      expect(() => {
        CMSSanitizationService.sanitizeFontFamily('A'.repeat(101));
      }).toThrow(SanitizationError);
    });
  });

  describe('Email Sanitization', () => {
    it('should accept valid emails', () => {
      const result = CMSSanitizationService.sanitizeEmail('contact@example.com');
      expect(result).toBe('contact@example.com');
    });

    it('should lowercase emails', () => {
      const result = CMSSanitizationService.sanitizeEmail('Contact@EXAMPLE.COM');
      expect(result).toBe('contact@example.com');
    });

    it('should reject invalid email format', () => {
      expect(() => {
        CMSSanitizationService.sanitizeEmail('not-an-email');
      }).toThrow(SanitizationError);
    });

    it('should reject emails exceeding max length', () => {
      expect(() => {
        CMSSanitizationService.sanitizeEmail('a'.repeat(250) + '@example.com');
      }).toThrow(SanitizationError);
    });
  });

  describe('Phone Sanitization', () => {
    it('should accept valid phone numbers', () => {
      const result = CMSSanitizationService.sanitizePhone('+1-555-0000');
      expect(result).toBe('+1-555-0000');
    });

    it('should accept formatted phones', () => {
      const result = CMSSanitizationService.sanitizePhone('(555) 123-4567');
      expect(result).toBe('(555) 123-4567');
    });

    it('should reject invalid phone characters', () => {
      expect(() => {
        CMSSanitizationService.sanitizePhone('555@@@1234');
      }).toThrow(SanitizationError);
    });

    it('should reject phones exceeding max length', () => {
      expect(() => {
        CMSSanitizationService.sanitizePhone('+' + '1'.repeat(25));
      }).toThrow(SanitizationError);
    });
  });

  describe('SQL Injection Detection', () => {
    it('should detect UNION SELECT injection', () => {
      const result = CMSSanitizationService.containsSQLInjection('UNION SELECT * FROM users');
      expect(result).toBe(true);
    });

    it('should detect INSERT injection', () => {
      const result = CMSSanitizationService.containsSQLInjection("'; INSERT INTO users");
      expect(result).toBe(true);
    });

    it('should detect DELETE injection', () => {
      const result = CMSSanitizationService.containsSQLInjection("'; DELETE FROM users");
      expect(result).toBe(true);
    });

    it('should not flag safe strings', () => {
      const result = CMSSanitizationService.containsSQLInjection('Hello World');
      expect(result).toBe(false);
    });
  });

  describe('XSS Detection', () => {
    it('should detect script tags', () => {
      const result = CMSSanitizationService.containsXSS('<script>alert("XSS")</script>');
      expect(result).toBe(true);
    });

    it('should detect event handlers', () => {
      const result = CMSSanitizationService.containsXSS('onclick="alert(\'XSS\')"');
      expect(result).toBe(true);
    });

    it('should detect javascript: protocol', () => {
      const result = CMSSanitizationService.containsXSS('javascript:void(0)');
      expect(result).toBe(true);
    });

    it('should not flag safe content', () => {
      const result = CMSSanitizationService.containsXSS('Just some normal text');
      expect(result).toBe(false);
    });
  });

  describe('Object Sanitization', () => {
    it('should sanitize string values in objects', () => {
      const obj = {
        title: 'Welcome',
        description: 'Safe content',
      };

      const result = CMSSanitizationService.sanitizeObject(obj);
      expect(result.title).toBe('Welcome');
      expect(result.description).toBe('Safe content');
    });

    it('should handle nested objects', () => {
      const obj = {
        hero: {
          title: 'Welcome',
          subtitle: 'Join us',
        },
      };

      const result = CMSSanitizationService.sanitizeObject(obj);
      expect(result.hero.title).toBe('Welcome');
      expect(result.hero.subtitle).toBe('Join us');
    });

    it('should handle arrays', () => {
      const obj = {
        items: ['Item 1', 'Item 2', 'Item 3'],
      };

      const result = CMSSanitizationService.sanitizeObject(obj);
      expect(result.items.length).toBe(3);
    });

    it('should preserve numeric and boolean values', () => {
      const obj = {
        count: 42,
        enabled: true,
        ratio: 3.14,
      };

      const result = CMSSanitizationService.sanitizeObject(obj);
      expect(result.count).toBe(42);
      expect(result.enabled).toBe(true);
      expect(result.ratio).toBe(3.14);
    });

    it('should remove XSS from nested strings', () => {
      const obj = {
        content: {
          text: '<script>alert(1)</script>',
        },
      };

      const result = CMSSanitizationService.sanitizeObject(obj);
      expect(result.content.text).not.toContain('<script>');
    });
  });
});
