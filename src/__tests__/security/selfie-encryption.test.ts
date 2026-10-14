/**
 * Selfie Encryption Tests
 *
 * Tests for Task 10: Selfie Encryption at Rest
 * Validates Requirements 10.1-10.5
 *
 * Validates:
 *   - Selfies are encrypted before storage
 *   - Encrypted selfies differ from plaintext
 *   - Decryption with correct key returns original content
 *   - Decryption with wrong key fails
 *   - Missing key throws error
 *   - Large files (5 MB+) are handled correctly
 *   - Roundtrip: encrypt → decrypt → matches original
 */

import { encryptBuffer, decryptBuffer, isEncrypted } from '@/lib/fileEncryption';

describe('Selfie Encryption (Task 10)', () => {
  // Test data: a minimal JPEG header + some fake pixel data
  const createFakeJpegBuffer = (sizeBytes: number = 1024): Buffer => {
    // JPEG SOI marker + JFIF header (minimal valid JPEG)
    const jpegHeader = Buffer.from([
      0xff, 0xd8, // SOI (Start of Image)
      0xff, 0xe0, // APP0 (JFIF)
      0x00, 0x10, // Length
      0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
      0x01, 0x01, // Version 1.1
      0x00, // Units
      0x00, 0x01, 0x00, 0x01, // X/Y density
      0x00, 0x00, // Thumbnail
    ]);

    // Pad to requested size with fake pixel data
    if (sizeBytes <= jpegHeader.length) {
      return jpegHeader.slice(0, sizeBytes);
    }

    const padding = Buffer.alloc(sizeBytes - jpegHeader.length, 0xaa);
    return Buffer.concat([jpegHeader, padding]);
  };

  describe('10.1: Encrypt → Decrypt → Matches Original (Roundtrip)', () => {
    it('should encrypt and decrypt a small buffer (1 KB)', () => {
      const original = createFakeJpegBuffer(1024);
      const encrypted = encryptBuffer(original);
      const decrypted = decryptBuffer(encrypted);

      expect(decrypted).toEqual(original);
    });

    it('should encrypt and decrypt a medium buffer (100 KB)', () => {
      const original = createFakeJpegBuffer(100 * 1024);
      const encrypted = encryptBuffer(original);
      const decrypted = decryptBuffer(encrypted);

      expect(decrypted).toEqual(original);
    });

    it('should encrypt and decrypt a large buffer (5 MB)', () => {
      const original = createFakeJpegBuffer(5 * 1024 * 1024);
      const encrypted = encryptBuffer(original);
      const decrypted = decryptBuffer(encrypted);

      expect(decrypted).toEqual(original);
    });

    it('should handle empty buffer', () => {
      const original = Buffer.alloc(0);
      const encrypted = encryptBuffer(original);
      const decrypted = decryptBuffer(encrypted);

      expect(decrypted).toEqual(original);
    });

    it('should handle buffer with null bytes', () => {
      const original = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x00]);
      const encrypted = encryptBuffer(original);
      const decrypted = decryptBuffer(encrypted);

      expect(decrypted).toEqual(original);
    });
  });

  describe('10.2: Encrypted Buffer ≠ Original (Encryption Works)', () => {
    it('should produce different output than plaintext', () => {
      const original = createFakeJpegBuffer(1024);
      const encrypted = encryptBuffer(original);

      // Encrypted should be longer (IV + auth tag overhead)
      expect(encrypted.length).toBeGreaterThan(original.length);

      // Encrypted should NOT contain the original data consecutively
      // (though small chunks might appear by chance)
      expect(encrypted.includes(original)).toBe(false);

      // Encrypted should start with AENC magic bytes
      const expectedMagic = Buffer.from('AENC');
      expect(encrypted.subarray(0, 4)).toEqual(expectedMagic);
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const plaintext = createFakeJpegBuffer(1024);

      const encrypted1 = encryptBuffer(plaintext);
      const encrypted2 = encryptBuffer(plaintext);

      // Both should be valid encrypted buffers
      expect(isEncrypted(encrypted1)).toBe(true);
      expect(isEncrypted(encrypted2)).toBe(true);

      // But they should be different (different IVs)
      expect(encrypted1).not.toEqual(encrypted2);

      // Both should decrypt to same plaintext
      expect(decryptBuffer(encrypted1)).toEqual(plaintext);
      expect(decryptBuffer(encrypted2)).toEqual(plaintext);
    });
  });

  describe('10.3: Wrong Key → Decryption Fails', () => {
    it('should fail to decrypt if encryption key changed', () => {
      const plaintext = createFakeJpegBuffer(1024);
      const encrypted = encryptBuffer(plaintext);

      // Simulate key change by modifying the auth tag
      // (in real scenario, this happens when FILE_ENCRYPTION_KEY env var changes)
      // We'll corrupt the auth tag to simulate a wrong key scenario
      const corruptedEncrypted = Buffer.alloc(encrypted.length);
      encrypted.copy(corruptedEncrypted);
      corruptedEncrypted[20] ^= 0xff; // Flip bits in auth tag

      // Decryption should throw because auth tag verification fails
      expect(() => {
        decryptBuffer(corruptedEncrypted);
      }).toThrow();
    });

    it('should reject buffer with invalid magic bytes', () => {
      // Create a buffer that looks encrypted but has wrong magic
      const fakeMagic = Buffer.from('FAKE');
      const fakeEncrypted = Buffer.concat([fakeMagic, Buffer.alloc(100)]);

      expect(() => {
        decryptBuffer(fakeEncrypted);
      }).toThrow('does not appear to be encrypted');
    });

    it('should reject buffer that is too short', () => {
      // Buffer smaller than header size (4 + 12 + 16 = 32 bytes)
      const tooShort = Buffer.alloc(10);

      expect(() => {
        decryptBuffer(tooShort);
      }).toThrow('too short');
    });
  });

  describe('10.4: Missing Key → Throws Error', () => {
    it('should throw if FILE_ENCRYPTION_KEY env var is not set', () => {
      // Temporarily clear the key
      const original = process.env.FILE_ENCRYPTION_KEY;
      delete process.env.FILE_ENCRYPTION_KEY;

      try {
        // Clear the previous key too
        delete process.env.FILE_ENCRYPTION_KEY_PREV;

        const plaintext = createFakeJpegBuffer(100);

        // This should throw because encryptBuffer reads FILE_ENCRYPTION_KEY
        expect(() => {
          encryptBuffer(plaintext);
        }).toThrow('FILE_ENCRYPTION_KEY');
      } finally {
        if (original) process.env.FILE_ENCRYPTION_KEY = original;
      }
    });
  });

  describe('10.5: Large Files (5 MB+) Handled Correctly', () => {
    it('should encrypt and decrypt a 5 MB file', () => {
      const fiveMB = 5 * 1024 * 1024;
      const original = createFakeJpegBuffer(fiveMB);

      const encrypted = encryptBuffer(original);
      const decrypted = decryptBuffer(encrypted);

      expect(decrypted).toEqual(original);
      expect(decrypted.length).toBe(fiveMB);
    });

    it('should encrypt and decrypt a 10 MB file', () => {
      const tenMB = 10 * 1024 * 1024;
      const original = createFakeJpegBuffer(tenMB);

      const encrypted = encryptBuffer(original);
      const decrypted = decryptBuffer(encrypted);

      expect(decrypted).toEqual(original);
      expect(decrypted.length).toBe(tenMB);
    });

    it('should handle very large file (50 MB) without memory issues', () => {
      const fiftyMB = 50 * 1024 * 1024;
      const original = createFakeJpegBuffer(fiftyMB);

      // Should not throw or hang
      const encrypted = encryptBuffer(original);
      expect(encrypted.length).toBeGreaterThan(fiftyMB);

      // Decryption should work (may take a moment)
      const decrypted = decryptBuffer(encrypted);
      expect(decrypted.length).toBe(fiftyMB);
    });
  });

  describe('10.6: isEncrypted() Helper', () => {
    it('should return true for encrypted buffer', () => {
      const plaintext = createFakeJpegBuffer(1024);
      const encrypted = encryptBuffer(plaintext);

      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plaintext buffer', () => {
      const plaintext = createFakeJpegBuffer(1024);

      expect(isEncrypted(plaintext)).toBe(false);
    });

    it('should return false for buffer with different magic bytes', () => {
      const fakeEncrypted = Buffer.concat([Buffer.from('FAKE'), Buffer.alloc(100)]);

      expect(isEncrypted(fakeEncrypted)).toBe(false);
    });

    it('should return false for very short buffer', () => {
      const tooShort = Buffer.alloc(3);

      expect(isEncrypted(tooShort)).toBe(false);
    });
  });

  describe('10.7: Key Format Validation', () => {
    it('should accept valid 64-char hex key', () => {
      // The actual encryptBuffer uses process.env.FILE_ENCRYPTION_KEY
      // which is set in jest.setup.ts or .env.test
      const plaintext = createFakeJpegBuffer(100);

      // Should not throw with a properly formatted key
      expect(() => {
        encryptBuffer(plaintext);
      }).not.toThrow();
    });
  });

  describe('10.8: Encryption Overhead', () => {
    it('should add predictable overhead: 4 (magic) + 12 (IV) + 16 (tag) = 32 bytes', () => {
      const plaintext = createFakeJpegBuffer(1000);
      const encrypted = encryptBuffer(plaintext);

      // Overhead: MAGIC(4) + IV(12) + AUTH_TAG(16) = 32 bytes
      const overhead = encrypted.length - plaintext.length;
      expect(overhead).toBe(32);
    });
  });

  describe('10.9: Multiple Consecutive Encryptions', () => {
    it('should produce unique ciphertexts for multiple encryptions of same plaintext', () => {
      const plaintext = createFakeJpegBuffer(500);

      const encrypted1 = encryptBuffer(plaintext);
      const encrypted2 = encryptBuffer(plaintext);
      const encrypted3 = encryptBuffer(plaintext);

      // All should decrypt correctly
      expect(decryptBuffer(encrypted1)).toEqual(plaintext);
      expect(decryptBuffer(encrypted2)).toEqual(plaintext);
      expect(decryptBuffer(encrypted3)).toEqual(plaintext);

      // But all ciphertexts should be different (random IVs)
      expect(encrypted1).not.toEqual(encrypted2);
      expect(encrypted2).not.toEqual(encrypted3);
      expect(encrypted1).not.toEqual(encrypted3);
    });
  });
});
