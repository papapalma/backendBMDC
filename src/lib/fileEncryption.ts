/**
 * File Encryption Utility — AES-256-GCM
 *
 * Implements Requirements 21.4, 21.5:
 *   - 21.4  Encrypt files before writing to disk using AES-256-GCM
 *   - 21.5  Store encryption keys in environment variables
 *
 * Algorithm: AES-256-GCM
 *   - 256-bit key (32 bytes) from FILE_ENCRYPTION_KEY env var
 *   - 96-bit IV (12 bytes) randomly generated per file
 *   - 128-bit authentication tag appended to ciphertext
 *
 * Encrypted file format (binary):
 *   [4 bytes: magic "AENC"] [12 bytes: IV] [16 bytes: auth tag] [N bytes: ciphertext]
 *
 * Key Rotation Policy (Req 21.5):
 *   - Rotate FILE_ENCRYPTION_KEY every 90 days
 *   - Keep FILE_ENCRYPTION_KEY_PREV for decrypting files encrypted with the old key
 *   - After rotation: re-encrypt files in the background using the new key
 *   - Never store the key in source code or version control
 *   - Use a secrets manager (e.g. AWS Secrets Manager, Vault) in production
 *
 * Environment variables:
 *   FILE_ENCRYPTION_KEY       — current 64-char hex key (32 bytes)
 *   FILE_ENCRYPTION_KEY_PREV  — previous key for rotation (optional)
 *   FILE_ENCRYPTION_ENABLED   — set to 'true' to enable encryption (default: false)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { logger } from '@/utils/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Magic bytes prepended to every encrypted file for format identification */
const MAGIC = Buffer.from('AENC');

/** IV length for AES-GCM: 96 bits = 12 bytes */
const IV_LENGTH = 12;

/** Auth tag length for AES-GCM: 128 bits = 16 bytes */
const AUTH_TAG_LENGTH = 16;

/** Total header size: magic(4) + IV(12) + tag(16) = 32 bytes */
const HEADER_SIZE = MAGIC.length + IV_LENGTH + AUTH_TAG_LENGTH;

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

/**
 * Parse a 64-character hex string into a 32-byte Buffer.
 * Throws if the key is missing or malformed.
 */
function parseKey(hexKey: string | undefined, name: string): Buffer | null {
  if (!hexKey) return null;
  if (hexKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(hexKey)) {
    logger.warn(`[FILE_ENCRYPTION] ${name} is set but not a valid 64-char hex string — ignoring`);
    return null;
  }
  return Buffer.from(hexKey, 'hex');
}

function getCurrentKey(): Buffer {
  const key = parseKey(process.env.FILE_ENCRYPTION_KEY, 'FILE_ENCRYPTION_KEY');
  if (!key) {
    throw new Error(
      'FILE_ENCRYPTION_KEY is not set or invalid. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return key;
}

function getPreviousKey(): Buffer | null {
  return parseKey(process.env.FILE_ENCRYPTION_KEY_PREV, 'FILE_ENCRYPTION_KEY_PREV');
}

/** Whether file encryption is enabled (opt-in via env var) */
export function isEncryptionEnabled(): boolean {
  return process.env.FILE_ENCRYPTION_ENABLED === 'true';
}

// ---------------------------------------------------------------------------
// Core encrypt / decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a Buffer using AES-256-GCM with the current key.
 *
 * @param plaintext - Raw file bytes to encrypt
 * @returns Encrypted buffer in the format: [MAGIC][IV][AUTH_TAG][CIPHERTEXT]
 */
export function encryptBuffer(plaintext: Buffer): Buffer {
  const key = getCurrentKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([MAGIC, iv, authTag, ciphertext]);
}

/**
 * Decrypt a Buffer that was encrypted with `encryptBuffer`.
 *
 * Tries the current key first, then the previous key (for rotation support).
 *
 * @param encrypted - Encrypted buffer in the format: [MAGIC][IV][AUTH_TAG][CIPHERTEXT]
 * @returns Decrypted plaintext Buffer
 * @throws Error if the buffer is not in the expected format or decryption fails
 */
export function decryptBuffer(encrypted: Buffer): Buffer {
  // Validate magic bytes

if (encrypted.length < HEADER_SIZE) {
    throw new Error('Encrypted buffer is too short to be valid');
  }

const magic = encrypted.subarray(0, MAGIC.length);
  if (!magic.equals(MAGIC)) {
    throw new Error('Buffer does not appear to be encrypted (missing AENC magic bytes)');
  }

const iv = encrypted.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
  const authTag = encrypted.subarray(MAGIC.length + IV_LENGTH, HEADER_SIZE);
  const ciphertext = encrypted.subarray(HEADER_SIZE);

  // Try current key first

const keysToTry: Buffer[] = [getCurrentKey()];
  const prevKey = getPreviousKey();
  if (prevKey) keysToTry.push(prevKey);

  for (const key of keysToTry) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      // Try next key
    }
  }

  throw new Error('Decryption failed: authentication tag mismatch. Check encryption keys.');
}

// ---------------------------------------------------------------------------
// File-level helpers (used by upload/download handlers)
// ---------------------------------------------------------------------------

/**
 * Encrypt a file buffer if encryption is enabled.
 * Returns the original buffer unchanged if encryption is disabled.
 *
 * @param data - Raw file bytes
 * @returns Encrypted (or original) bytes
 */
export function maybeEncrypt(data: Buffer): Buffer {
  if (!isEncryptionEnabled()) return data;
  return encryptBuffer(data);
}

/**
 * Decrypt a file buffer if it appears to be encrypted.
 * Returns the original buffer unchanged if it is not encrypted.
 *
 * @param data - Potentially encrypted file bytes
 * @returns Decrypted (or original) bytes
 */
export function maybeDecrypt(data: Buffer): Buffer {
  if (data.length < HEADER_SIZE) return data;
  const magic = data.subarray(0, MAGIC.length);
  if (!magic.equals(MAGIC)) return data; // Not encrypted

return decryptBuffer(data);
}

/**
 * Check whether a buffer is encrypted (starts with AENC magic bytes).
 */
export function isEncrypted(data: Buffer): boolean {
  if (data.length < MAGIC.length) return false;
  return data.subarray(0, MAGIC.length).equals(MAGIC);
}

// ---------------------------------------------------------------------------
// Key generation helper (for documentation / setup scripts)
// ---------------------------------------------------------------------------

/**
 * Generate a new random 256-bit encryption key as a hex string.
 * Use this to create the FILE_ENCRYPTION_KEY environment variable.
 *
 * @example
 *   node -e "const {generateEncryptionKey} = require('./src/lib/fileEncryption'); console.log(generateEncryptionKey())"
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}
