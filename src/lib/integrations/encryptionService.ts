import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Reads and validates the INTEGRATION_ENCRYPTION_KEY environment variable.
 * The key must be exactly 32 bytes (256 bits) for AES-256.
 * Accepts hex-encoded (64 chars) or raw 32-byte strings.
 *
 * @returns A 32-byte Buffer suitable for AES-256-GCM
 * @throws Error if the key is missing or not 32 bytes
 */
export function getEncryptionKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY environment variable is not set"
    );
  }

  // Try hex-encoded first (64 hex chars = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  // Fall back to raw UTF-8 bytes
  const buf = Buffer.from(raw, "utf-8");
  if (buf.length !== 32) {
    throw new Error(
      `INTEGRATION_ENCRYPTION_KEY must be exactly 32 bytes (got ${buf.length}). ` +
        "Provide 64 hex characters or a 32-byte UTF-8 string."
    );
  }
  return buf;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * The output is a base64 string containing: IV (12 bytes) + auth tag (16 bytes) + ciphertext.
 * A random IV is generated per call to ensure unique ciphertexts. (Req 18.1)
 *
 * @param plaintext - The secret value to encrypt (e.g., an API key)
 * @returns A base64-encoded string containing IV + auth tag + ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Layout: [IV (12)] [AuthTag (16)] [Ciphertext (variable)]
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString("base64");
}

/**
 * Decrypts a base64 string produced by `encrypt` back to the original plaintext.
 *
 * Extracts the IV and auth tag from the front of the buffer, then decrypts
 * the remaining ciphertext. Decryption should only happen at the moment of
 * an outbound API call — never cache the result. (Req 18.1)
 *
 * @param encryptedBase64 - The base64 string from `encrypt`
 * @returns The original plaintext
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export function decrypt(encryptedBase64: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, "base64");

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted data is too short to contain IV and auth tag");
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

/**
 * Extracts the last 4 characters of a value for safe UI display.
 * Used to show a masked preview of API keys (e.g., `••••••••a1b2`). (Req 18.2)
 *
 * @param value - The full credential string
 * @returns The last 4 characters, or the full string if shorter than 4 chars
 */
export function extractLast4(value: string): string {
  if (value.length <= 4) {
    return value;
  }
  return value.slice(-4);
}
