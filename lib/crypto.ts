/**
 * AES-256-GCM encryption/decryption for sensitive values (e.g. OAuth tokens).
 *
 * Encrypted format: "<iv_hex>:<tag_hex>:<ciphertext_hex>"
 *
 * ENCRYPTION_SECRET must be a base64-encoded 32-byte key (generate with: openssl rand -base64 32).
 * - In production: required — missing key throws at call time.
 * - In local dev:  optional — functions warn and return plaintext unchanged.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ENCRYPTED_PATTERN = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

function getKey(): Buffer | null {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[crypto] ENCRYPTION_SECRET is required in production but is not set."
      );
    }
    // In dev: warn once, return null to signal plaintext passthrough
    console.warn(
      "⚠️  [crypto] ENCRYPTION_SECRET is not set — running without encryption. " +
        "Do NOT use in production."
    );
    return null;
  }
  return Buffer.from(secret, "base64");
}

// Returns the previous encryption key, used as fallback during key rotation.
// Set ENCRYPTION_SECRET_PREVIOUS to the old key while migrating; unset once rekey is complete.
function getPreviousKey(): Buffer | null {
  const secret = process.env.ENCRYPTION_SECRET_PREVIOUS;
  return secret ? Buffer.from(secret, "base64") : null;
}

function decryptWithKey(key: Buffer, ivHex: string, tagHex: string, ciphertextHex: string): string {
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

/**
 * Encrypts a plaintext string.
 * Returns encrypted string in format "iv:tag:ciphertext" (hex).
 * In dev without ENCRYPTION_SECRET, returns the plaintext unchanged with a warning.
 */
export function encryptString(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext; // dev passthrough

  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a string encrypted by encryptString.
 * If the value doesn't match the encrypted format, returns it as-is
 * (backwards-compatible with existing plaintext values).
 *
 * During key rotation: if decryption with ENCRYPTION_SECRET fails, falls back to
 * ENCRYPTION_SECRET_PREVIOUS. Remove ENCRYPTION_SECRET_PREVIOUS once /api/admin/rekey
 * has migrated all rows to the new key.
 */
export function decryptString(value: string): string {
  if (!ENCRYPTED_PATTERN.test(value)) {
    // Plaintext passthrough — existing rows not yet encrypted
    return value;
  }

  const key = getKey();
  if (!key) return value; // dev passthrough — no key, return raw value

  const [ivHex, tagHex, ciphertextHex] = value.split(":");

  try {
    return decryptWithKey(key, ivHex, tagHex, ciphertextHex);
  } catch {
    // Current key failed — try previous key (rotation in progress)
    const previousKey = getPreviousKey();
    if (!previousKey) {
      throw new Error("[crypto] Decryption failed. Check ENCRYPTION_SECRET.");
    }
    return decryptWithKey(previousKey, ivHex, tagHex, ciphertextHex);
  }
}

/**
 * Decrypts value with the current or previous key, then re-encrypts with the current key.
 * Used by /api/admin/rekey to migrate all rows to a new ENCRYPTION_SECRET.
 * No-ops on plaintext values (not in encrypted format).
 */
export function reEncryptString(value: string): string {
  if (!isEncrypted(value)) return value;
  return encryptString(decryptString(value));
}

/**
 * Returns true if the value was encrypted by encryptString.
 */
export function isEncrypted(value: string): boolean {
  return ENCRYPTED_PATTERN.test(value);
}
