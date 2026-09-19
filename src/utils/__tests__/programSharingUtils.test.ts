/**
 * Tests for Program Sharing Utilities
 * 
 * Validates link generation, validation, and formatting functions
 */

import {
  generateShareableLink,
  constructShareLink,
  extractProgramIdFromUrl,
  isValidUUID,
  validateShareLinkStructure,
  sanitizeOGDescription,
  createInvalidProgramResult,
  createValidProgramResult,
  isValidEnrollmentSource,
} from '../programSharingUtils';

describe('Program Sharing Utilities', () => {
  const validProgramId = 'a1b2c3d4-e5f6-4a18-b9d0-c1a2b3c4d5e6';
  const invalidProgramId = 'not-a-uuid';
  const baseUrl = 'https://bmdc.online';

  describe('isValidUUID', () => {
    it('should validate correct UUID format', () => {
      expect(isValidUUID(validProgramId)).toBe(true);
    });

    it('should reject invalid UUID formats', () => {
      expect(isValidUUID(invalidProgramId)).toBe(false);
      expect(isValidUUID('')).toBe(false);
      expect(isValidUUID('12345')).toBe(false);
    });
  });

  describe('generateShareableLink', () => {
    it('should generate a valid shareable link', () => {
      const link = generateShareableLink(
        validProgramId,
        'TypeScript Training',
        'Learn TypeScript basics'
      );

      expect(link).toBeDefined();
      expect(link.url).toContain(validProgramId);
      expect(link.programId).toBe(validProgramId);
      expect(link.generatedAt).toBeDefined();
      expect(link.og).toBeDefined();
      expect(link.og.title).toBe('TypeScript Training');
    });

    it('should throw error for invalid program ID', () => {
      expect(() => {
        generateShareableLink(invalidProgramId, 'Program Name');
      }).toThrow('Invalid program ID');
    });

    it('should generate expiration date if configured', () => {
      const link = generateShareableLink(
        validProgramId,
        'Program',
        undefined,
        { expirationDays: 30 }
      );

      expect(link.expiresAt).toBeDefined();
    });

    it('should not set expiration if expirationDays is null', () => {
      const link = generateShareableLink(
        validProgramId,
        'Program',
        undefined,
        { expirationDays: null }
      );

      expect(link.expiresAt).toBeUndefined();
    });
  });

  describe('constructShareLink', () => {
    it('should construct correct share link URL', () => {
      const url = constructShareLink(validProgramId, {
        baseUrl,
        sharePath: '/share',
        paramName: 'program_id',
      });

      expect(url).toBe(
        `${baseUrl}/share?program_id=${validProgramId}`
      );
    });

    it('should handle custom param names', () => {
      const url = constructShareLink(validProgramId, {
        baseUrl,
        sharePath: '/share',
        paramName: 'pid',
      });

      expect(url).toContain(`pid=${validProgramId}`);
    });
  });

  describe('extractProgramIdFromUrl', () => {
    it('should extract program ID from valid URL', () => {
      const url = `https://bmdc.online/share?program_id=${validProgramId}`;
      const extracted = extractProgramIdFromUrl(url);

      expect(extracted).toBe(validProgramId);
    });

    it('should return null for invalid URL', () => {
      const extracted = extractProgramIdFromUrl('not-a-url');

      expect(extracted).toBeNull();
    });

    it('should return null if program_id is missing', () => {
      const url = 'https://bmdc.online/share?other_param=value';
      const extracted = extractProgramIdFromUrl(url);

      expect(extracted).toBeNull();
    });

    it('should support custom param names', () => {
      const url = `https://bmdc.online/share?pid=${validProgramId}`;
      const extracted = extractProgramIdFromUrl(url, 'pid');

      expect(extracted).toBe(validProgramId);
    });
  });

  describe('validateShareLinkStructure', () => {
    it('should validate correct share link structure', () => {
      const url = `https://bmdc.online/share?program_id=${validProgramId}`;
      const result = validateShareLinkStructure(url);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject URL without program_id', () => {
      const url = 'https://bmdc.online/share?other=value';
      const result = validateShareLinkStructure(url);

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject invalid program ID format', () => {
      const url = 'https://bmdc.online/share?program_id=invalid-id';
      const result = validateShareLinkStructure(url);

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject invalid URL format', () => {
      const result = validateShareLinkStructure('not-a-url');

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('sanitizeOGDescription', () => {
    it('should remove HTML tags', () => {
      const input = 'Learn <b>TypeScript</b> concepts';
      const result = sanitizeOGDescription(input);

      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });

    it('should decode HTML entities', () => {
      const input = 'Salary &amp; Benefits &quot;info&quot;';
      const result = sanitizeOGDescription(input);

      expect(result).toContain('&');
      expect(result).toContain('"');
    });

    it('should truncate to 160 characters', () => {
      const longText = 'A'.repeat(200);
      const result = sanitizeOGDescription(longText);

      expect(result.length).toBeLessThanOrEqual(160);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should return default text if description is empty', () => {
      const result = sanitizeOGDescription('');

      expect(result).toContain('BMDC');
    });
  });

  describe('createInvalidProgramResult', () => {
    it('should create invalid program result', () => {
      const result = createInvalidProgramResult(
        'Program not found',
        'Deleted or archived'
      );

      expect(result.isValid).toBe(false);
      expect(result.isActive).toBe(false);
      expect(result.isPublic).toBe(false);
      expect(result.error).toBe('Program not found');
      expect(result.reason).toBe('Deleted or archived');
    });
  });

  describe('createValidProgramResult', () => {
    it('should create valid program result', () => {
      const program = {
        id: validProgramId,
        name: 'Test Program',
        description: 'Test description',
        status: 'active' as const,
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        durationWeeks: 12,
      };

      const result = createValidProgramResult(program);

      expect(result.isValid).toBe(true);
      expect(result.isActive).toBe(true);
      expect(result.isPublic).toBe(true);
      expect(result.program).toBeDefined();
      expect(result.program?.id).toBe(validProgramId);
      expect(result.program?.name).toBe('Test Program');
    });
  });

  describe('isValidEnrollmentSource', () => {
    it('should validate correct enrollment sources', () => {
      expect(isValidEnrollmentSource('social_share')).toBe(true);
      expect(isValidEnrollmentSource('direct')).toBe(true);
      expect(isValidEnrollmentSource('admin_assigned')).toBe(true);
    });

    it('should reject invalid enrollment sources', () => {
      expect(isValidEnrollmentSource('invalid')).toBe(false);
      expect(isValidEnrollmentSource('')).toBe(false);
      expect(isValidEnrollmentSource('other')).toBe(false);
    });
  });
});
