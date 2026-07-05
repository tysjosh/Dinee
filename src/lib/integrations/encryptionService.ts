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

const HKDF_DIGEST = "sha256";
const HKDF_INFO = "integration-credential-key";

/**
 * Derives the AES-256 key to use for a given optional per-platform key salt.
 *
 * When `keySalt` is absent (or an empty string), the shared
 * `INTEGRATION_ENCRYPTION_KEY` is returned unchanged. This keeps behavior
 * byte-for-byte identical for existing callers and previously-stored
 * (migrated Runsheet) ciphertext. (Req 2.7, 10.3)
 *
 * When `keySalt` is provided, the shared key is combined with the salt via
 * HKDF (SHA-256) to produce a distinct 32-byte key. Because a different salt
 * yields a different key, ciphertext produced with one platform's salt cannot
 * be decrypted with another platform's salt or with no salt. (Req 12.2)
 *
 * @param keySalt - Optional per-platform key salt from the Transport_Contract
 * @returns A 32-byte Buffer suitable for AES-256-GCM
 */
function deriveKey(keySalt?: string): Buffer {
  const baseKey = getEncryptionKey();

  if (keySalt === undefined || keySalt.length === 0) {
    return baseKey;
  }

  const derived = crypto.hkdfSync(
    HKDF_DIGEST,
    baseKey,
    Buffer.from(keySalt, "utf-8"),
    Buffer.from(HKDF_INFO, "utf-8"),
    32
  );
  return Buffer.from(derived);
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * The output is a base64 string containing: IV (12 bytes) + auth tag (16 bytes) + ciphertext.
 * A random IV is generated per call to ensure unique ciphertexts. (Req 18.1)
 *
 * When an optional per-platform `keySalt` is supplied, the encryption key is
 * derived from the shared key and that salt so the resulting ciphertext can
 * only be decrypted with the same salt. When omitted, the shared key is used
 * unchanged and behavior is identical to before. (Req 2.2, 12.2)
 *
 * @param plaintext - The secret value to encrypt (e.g., an API key)
 * @param keySalt - Optional per-platform key salt (from the Transport_Contract)
 * @returns A base64-encoded string containing IV + auth tag + ciphertext
 */
export function encrypt(plaintext: string, keySalt?: string): string {
  const key = deriveKey(keySalt);
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
 * When an optional per-platform `keySalt` is supplied, it MUST match the salt
 * used at encryption time; otherwise the derived key differs and GCM
 * authentication fails. When omitted, the shared key is used unchanged so
 * previously-stored (migrated Runsheet) ciphertext still decrypts. (Req 10.3, 12.2)
 *
 * @param encryptedBase64 - The base64 string from `encrypt`
 * @param keySalt - Optional per-platform key salt (from the Transport_Contract)
 * @returns The original plaintext
 * @throws Error if decryption fails (wrong key, wrong salt, tampered data, etc.)
 */
export function decrypt(encryptedBase64: string, keySalt?: string): string {
  const key = deriveKey(keySalt);
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
