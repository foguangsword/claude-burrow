/**
 * Encryption module for ClaudeBurrow.
 *
 * Scheme: PBKDF2-SHA256 → AES-256-GCM
 *
 * - User provides a passphrase (any length, recommended 8+ chars)
 * - Salt: 16 random bytes, generated once per user, stored in config (not secret)
 * - PBKDF2: 100,000 iterations, produces 32-byte AES key
 * - AES-256-GCM: random 12-byte IV per encryption, 16-byte auth tag
 *
 * Encrypted payload format (binary):
 *   [IV: 12 bytes][authTag: 16 bytes][ciphertext: variable]
 *
 * All crypto uses Node.js built-in `crypto` module — zero external dependencies.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;        // GCM recommended IV size
const AUTH_TAG_LENGTH = 16;  // GCM auth tag size
const KEY_LENGTH = 32;       // AES-256
const SALT_LENGTH = 16;      // PBKDF2 salt
const ITERATIONS = 100000;   // PBKDF2 iterations

// ---- Key derivation ----

/**
 * Derive an AES-256 key from a passphrase and salt using PBKDF2-SHA256.
 *
 * @param {string} passphrase - User's secret passphrase
 * @param {Buffer|string} salt - Salt bytes (Buffer or base64 string)
 * @param {number} [iterations=100000]
 * @returns {Buffer} 32-byte AES key
 */
function deriveKey(passphrase, salt, iterations = ITERATIONS) {
  if (typeof salt === 'string') {
    salt = Buffer.from(salt, 'base64');
  }
  return crypto.pbkdf2Sync(passphrase, salt, iterations, KEY_LENGTH, 'sha256');
}

/**
 * Generate a random salt for initial setup.
 * @returns {string} base64-encoded salt
 */
function generateSalt() {
  return crypto.randomBytes(SALT_LENGTH).toString('base64');
}

// ---- Encryption ----

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * @param {string} plaintext - Data to encrypt
 * @param {Buffer} key - 32-byte AES key (from deriveKey)
 * @returns {Buffer} Encrypted blob: IV + authTag + ciphertext
 */
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Concatenate: IV | authTag | ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
}

// ---- Decryption ----

/**
 * Decrypt data encrypted with encrypt().
 *
 * @param {Buffer} encryptedBlob - IV + authTag + ciphertext
 * @param {Buffer} key - 32-byte AES key (from deriveKey)
 * @returns {string} Decrypted plaintext
 * @throws {Error} if decryption fails (wrong password, corrupted data)
 */
function decrypt(encryptedBlob, key) {
  const iv = encryptedBlob.subarray(0, IV_LENGTH);
  const authTag = encryptedBlob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encryptedBlob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf-8');
  } catch (err) {
    // Auth tag verification failure → wrong password or tampered data
    throw new Error(
      'Decryption failed. This usually means the password is incorrect, ' +
      'or the data has been corrupted. Details: ' + err.message
    );
  }
}

// ---- Convenience helpers ----

/**
 * Encrypt a string using passphrase + salt directly.
 * Convenience wrapper for the full encrypt flow.
 *
 * @param {string} plaintext
 * @param {string} passphrase
 * @param {string} saltBase64
 * @returns {Buffer} encrypted blob
 */
function encryptWithPassphrase(plaintext, passphrase, saltBase64) {
  const key = deriveKey(passphrase, saltBase64);
  return encrypt(plaintext, key);
}

/**
 * Decrypt a blob using passphrase + salt directly.
 * Convenience wrapper for the full decrypt flow.
 *
 * @param {Buffer} encryptedBlob
 * @param {string} passphrase
 * @param {string} saltBase64
 * @returns {string} decrypted plaintext
 */
function decryptWithPassphrase(encryptedBlob, passphrase, saltBase64) {
  const key = deriveKey(passphrase, saltBase64);
  return decrypt(encryptedBlob, key);
}

module.exports = {
  ALGORITHM,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  KEY_LENGTH,
  SALT_LENGTH,
  ITERATIONS,
  deriveKey,
  generateSalt,
  encrypt,
  decrypt,
  encryptWithPassphrase,
  decryptWithPassphrase,
};
