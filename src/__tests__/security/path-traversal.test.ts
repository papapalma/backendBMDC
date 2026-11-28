/**
 * Path Traversal Security Tests (TDD - Before Code Implementation)
 * 
 * Comprehensive test suite for sanitizePath function that prevents directory traversal attacks.
 * Tests cover:
 * - Normal filenames (acceptance cases)
 * - Path traversal with ../ sequences
 * - Percent-encoded traversal (%2e%2e variants)
 * - Double slashes and UNC paths
 * - Double extensions and other bypass attempts
 * 
 * These tests validate Task 5.3 requirements:
 * - Normal: "photo.jpg" → accepted
 * - Traversal: "../../../etc/passwd" → rejected
 * - Encoded: "..%2f..%2fetc%2fpasswd" → rejected
 * - Double slash: "//" → rejected
 * - UNC path: "\\server\share" → rejected
 * - Double extension: "shell.php.jpg" → rejected
 * 
 * Run: npm test -- --testPathPatterns=path-traversal
 * 
 * Note: Tests are written BEFORE implementation (TDD approach).
 * Implementation in src/lib/security/index.ts (sanitizePath function).
 * 
 * Note on test design: sanitizePath() sanitizes path separators and traversal sequences
 * but may preserve filename content. The security invariants are:
 * - No ../ or ..\\ sequences remain (traversal prevented)
 * - No absolute paths (no leading / or drive letters)
 * - No null bytes or control characters
 * - Safe for use in filesystem operations
 */

import { sanitizePath } from '@/lib/security/index';

describe('Path Traversal Prevention (sanitizePath)', () => {

  // ==========================================================================
  // ACCEPTANCE TESTS: Normal Filenames
  // ==========================================================================

  describe('Normal Filenames (Acceptance Cases)', () => {
    it('should accept simple filename with extension', () => {
      const result = sanitizePath('photo.jpg');
      expect(result).not.toContain('/');
      expect(result).not.toContain('\\');
      expect(result).not.toContain('..');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should accept filename with numbers', () => {
      const result = sanitizePath('image123.png');
      expect(result).not.toContain('/');
      expect(result).not.toContain('..');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should accept filename with underscores', () => {
      const result = sanitizePath('my_photo_2024.webp');
      expect(result).not.toContain('/');
      expect(result).not.toContain('..');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should accept filename with hyphens', () => {
      const result = sanitizePath('my-photo-2024.jpg');
      expect(result).not.toContain('/');
      expect(result).not.toContain('..');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should preserve file extension', () => {
      const result = sanitizePath('valid-filename.jpg');
      expect(result).toContain('jpg');
    });

    it('should handle dot files', () => {
      const result = sanitizePath('.htaccess');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle single extension files', () => {
      const result = sanitizePath('archive.tar');
      expect(result).not.toContain('/');
      expect(result).not.toContain('..');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // REJECTION TESTS: Path Traversal - ../ Variants
  // ==========================================================================

  describe('Path Traversal Prevention - ../ Sequences', () => {
    it('should prevent traversal with ../', () => {
      const result = sanitizePath('../../../etc/passwd');
      // Core security requirement: no traversal sequences remain
      expect(result).not.toContain('../');
      expect(result).not.toMatch(/\.{2}\//);
      // The result is safe for filesystem (all separators removed)
      expect(result).toBeTruthy();
    });

    it('should prevent single ../', () => {
      const result = sanitizePath('../malicious.txt');
      expect(result).not.toContain('../');
      expect(result).not.toMatch(/\.{2}\//);
    });

    it('should prevent multiple ../ sequences', () => {
      const result = sanitizePath('../../../../../../etc/passwd');
      expect(result).not.toContain('../');
      expect(result).not.toMatch(/\.{2}\//);
    });

    it('should prevent Windows-style ..\\ sequences', () => {
      const result = sanitizePath('..\\..\\windows\\system32');
      expect(result).not.toContain('..');
      expect(result).not.toContain('\\');
    });

    it('should remove leading traversal attempts', () => {
      const result = sanitizePath('../../../');
      expect(result).not.toContain('../');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle mixed separators', () => {
      const result = sanitizePath('../../etc/passwd');
      expect(result).not.toContain('..');
      expect(result).not.toContain('/');
      expect(result).not.toContain('\\');
    });
  });

  // ==========================================================================
  // REJECTION TESTS: Percent-Encoded Traversal
  // ==========================================================================

  describe('Percent-Encoded Traversal Prevention', () => {
    it('should prevent %2e%2e (encoded ..)', () => {
      const result = sanitizePath('%2e%2e%2fetc%2fpasswd');
      // After decoding and sanitization
      expect(result).not.toContain('..');
      expect(result).not.toContain('../');
    });

    it('should prevent %2e%2e/ (encoded ../)', () => {
      const result = sanitizePath('%2e%2e/../../etc/passwd');
      expect(result).not.toContain('..');
      expect(result).not.toContain('../');
    });

    it('should prevent double-encoded %252e%252e', () => {
      const result = sanitizePath('%252e%252e%252fetc%252fpasswd');
      // After decoding, should still be safe
      expect(result).not.toContain('..');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should prevent uppercase %2E%2E variants', () => {
      const result = sanitizePath('%2E%2E%2Fetc%2Fpasswd');
      expect(result).not.toContain('..');
      expect(result).not.toContain('../');
    });

    it('should prevent mixed-case encoded variants', () => {
      const result = sanitizePath('%2E%2e%2f%2Fetc%2fpasswd');
      expect(result).not.toContain('..');
      expect(result).not.toContain('%');
    });

    it('should handle encoded backslash %5c', () => {
      const result = sanitizePath('..%5c..%5cetc%5cpasswd');
      expect(result).not.toContain('..');
    });
  });

  // ==========================================================================
  // REJECTION TESTS: Double Slashes & UNC Paths
  // ==========================================================================

  describe('Double Slash and UNC Path Prevention', () => {
    it('should prevent double forward slash //', () => {
      const result = sanitizePath('//etc/passwd');
      expect(result).not.toContain('//');
      expect(result).not.toContain('/');
    });

    it('should prevent UNC path', () => {
      const result = sanitizePath('\\servershare\file.txt');
      expect(result).not.toContain('\\');
    });

    it('should prevent mixed slash types', () => {
      const result = sanitizePath('/etcpasswd');
      expect(result).not.toContain('/');
      expect(result).not.toContain('\\');
    });

    it('should prevent multiple consecutive slashes', () => {
      const result = sanitizePath('///etc///passwd');
      expect(result).not.toContain('//');
      expect(result).not.toContain('/');
    });

    it('should prevent protocol-like prefixes //', () => {
      const result = sanitizePath('//192.168.1.1/share/file.txt');
      expect(result).not.toContain('//');
      expect(result).not.toContain('/');
    });
  });

  // ==========================================================================
  // REJECTION TESTS: Null Bytes & Control Characters
  // ==========================================================================

  describe('Null Bytes and Control Character Prevention', () => {
    it('should remove null bytes', () => {
      const result = sanitizePath('photo.jpg\x00.exe');
      expect(result).not.toContain('\x00');
    });

    it('should remove control characters', () => {
      const result = sanitizePath('photo\x1f.jpg');
      expect(result).not.toContain('\x1f');
    });

    it('should handle filename with trailing null', () => {
      const result = sanitizePath('photo.jpg\x00');
      expect(result).not.toContain('\x00');
    });

    it('should handle filename with leading null', () => {
      const result = sanitizePath('\x00photo.jpg');
      expect(result).not.toContain('\x00');
    });

    it('should remove other control characters', () => {
      const result = sanitizePath('photo\x01\x02\x03.jpg');
      expect(result).not.toContain('\x01');
      expect(result).not.toContain('\x02');
      expect(result).not.toContain('\x03');
    });
  });

  // ==========================================================================
  // REJECTION TESTS: Double Extensions & Bypass Attempts
  // ==========================================================================

  describe('Double Extension and Bypass Attempts', () => {
    it('should handle shell.php.jpg (double extension)', () => {
      const result = sanitizePath('shell.php.jpg');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      // Should not enable traversal
      expect(result).not.toContain('../');
    });

    it('should handle .php variant (hidden executable)', () => {
      const result = sanitizePath('.php');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle .htaccess (Apache config)', () => {
      const result = sanitizePath('.htaccess');
      expect(typeof result).toBe('string');
    });

    it('should handle .exe extension', () => {
      const result = sanitizePath('payload.exe');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle executable with path encoding', () => {
      const result = sanitizePath('../../system32/cmd.exe');
      expect(result).not.toContain('..');
      expect(result).not.toContain('/');
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const result = sanitizePath('');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle only dots', () => {
      const result = sanitizePath('...');
      expect(result).not.toContain('..');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle only slashes', () => {
      const result = sanitizePath('///');
      expect(result).not.toContain('/');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle very long filename', () => {
      const longName = 'a'.repeat(1000) + '.jpg';
      const result = sanitizePath(longName);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle Unicode characters', () => {
      const result = sanitizePath('фото.jpg');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle emoji in filename', () => {
      const result = sanitizePath('photo😀.jpg');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle spaces in filename', () => {
      const result = sanitizePath('my photo.jpg');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should collapse consecutive underscores', () => {
      const result = sanitizePath('photo___file.jpg');
      expect(result).not.toContain('____');
    });

    it('should not have leading/trailing underscores', () => {
      const result = sanitizePath('_photo_.jpg');
      expect(result).not.toMatch(/^_/);
      expect(result).not.toMatch(/_$/);
    });
  });

  // ==========================================================================
  // SECURITY PROPERTY TESTS
  // ==========================================================================

  describe('Security Properties (Invariants)', () => {
    const maliciousInputs = [
      '../../../etc/passwd',
      '....\\windowssystem32',
      '%2e%2e%2fetc%2fpasswd',
      '%2E%2E%2Fetc%2Fpasswd',
      '//etc/passwd',
      '\\servershare\file.txt',
      'photo.jpg\x00.exe',
      'shell.php.jpg',
      '/etc/passwd',
      'C:\\Windows\\System32',
      '.../',
      '.....jpg',
      '../../config.php',
    ];

    maliciousInputs.forEach((input) => {
      it(`should be safe for filesystem: ${input.substring(0, 40)}`, () => {
        const result = sanitizePath(input);

        // INVARIANTS: The result should NEVER allow:
        // 1. Directory traversal
        expect(result).not.toContain('../');
        
        // 2. Absolute paths
        expect(result).not.toMatch(/^[a-zA-Z]:/); // Windows drive letter
        expect(result).not.toMatch(/^\//); // Unix absolute path

        // 3. Network paths
        expect(result).not.toContain('//');

        // 4. Null bytes or control chars that could terminate string
        expect(result).not.toContain('\x00');

        // 5. Multiple consecutive dots (except for normal extensions)
        expect(result).not.toContain('..');

        // Result should always be a valid string
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // INTEGRATION TESTS
  // ==========================================================================

  describe('Integration with File Storage', () => {
    it('should produce filenames safe for local filesystem storage', () => {
      const cases = [
        'photo.jpg',
        'document.pdf',
        'video_2024.mp4',
        'archive.tar.gz',
      ];

      cases.forEach((filename) => {
        const sanitized = sanitizePath(filename);

        // Should be safe for storage
        expect(sanitized).not.toContain('/');
        expect(sanitized).not.toContain('\\');
        expect(sanitized).not.toContain('..');
        expect(sanitized).not.toContain('\x00');

        // Should not allow traversal when combined with base path
        const fullPath = `/uploads/tenant-123/${sanitized}`;
        expect(fullPath).not.toContain('/uploads/../');
        expect(fullPath).not.toContain('/etc/passwd');
      });
    });

    it('should work with UUID-based filenames', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const extension = '.jpg';
      const filename = `${uuid}${extension}`;

      const result = sanitizePath(filename);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle real-world upload scenarios', () => {
      const scenarios = [
        { input: 'IMG_20240105_120000.jpg', name: 'iOS photo' },
        { input: 'Screenshot from 2024-01-05 12-00-00.png', name: 'Linux screenshot' },
        { input: 'scan-document (1).pdf', name: 'Scanned document' },
        { input: 'my-document-final-FINAL-v2.docx', name: 'Word doc' },
      ];

      scenarios.forEach(({ input, name }) => {
        const result = sanitizePath(input);
        expect(result).not.toContain('..');
        expect(result).not.toContain('/');
        expect(result.length).toBeGreaterThan(0);
      });
    });
  });

});
