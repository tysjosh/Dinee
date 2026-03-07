import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  encrypt,
  decrypt,
  extractLast4,
  getEncryptionKey,
} from "./encryptionService";

// A valid 32-byte hex key (64 hex chars)
const TEST_KEY_HEX = crypto.randomBytes(32).toString("hex");

describe("encryptionService", () => {
  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY_HEX;
  });

  afterEach(() => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
  });

  describe("getEncryptionKey", () => {
    it("returns a 32-byte buffer from a 64-char hex string", () => {
      const key = getEncryptionKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it("accepts a raw 32-byte UTF-8 string", () => {
      process.env.INTEGRATION_ENCRYPTION_KEY = "abcdefghijklmnopqrstuvwxyz123456";
      const key = getEncryptionKey();
      expect(key.length).toBe(32);
    });

    it("throws when env var is not set", () => {
      delete process.env.INTEGRATION_ENCRYPTION_KEY;
      expect(() => getEncryptionKey()).toThrow(
        "INTEGRATION_ENCRYPTION_KEY environment variable is not set"
      );
    });

    it("throws when key is wrong length", () => {
      process.env.INTEGRATION_ENCRYPTION_KEY = "tooshort";
      expect(() => getEncryptionKey()).toThrow("must be exactly 32 bytes");
    });
  });

  describe("encrypt / decrypt round-trip", () => {
    it("round-trips a simple string", () => {
      const plaintext = "sk-test-api-key-12345";
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it("produces different ciphertexts for the same plaintext (random IV)", () => {
      const plaintext = "same-key-twice";
      const a = encrypt(plaintext);
      const b = encrypt(plaintext);
      expect(a).not.toBe(b);
      // Both still decrypt correctly
      expect(decrypt(a)).toBe(plaintext);
      expect(decrypt(b)).toBe(plaintext);
    });

    it("round-trips an empty string", () => {
      const encrypted = encrypt("");
      expect(decrypt(encrypted)).toBe("");
    });

    it("round-trips unicode content", () => {
      const plaintext = "🔑 clé secrète 密钥";
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it("ciphertext does not contain the plaintext", () => {
      const plaintext = "super-secret-api-key-abcd1234";
      const encrypted = encrypt(plaintext);
      // The base64 output should not contain the raw plaintext
      expect(encrypted).not.toContain(plaintext);
      // Decoded bytes should not contain plaintext bytes either
      const decoded = Buffer.from(encrypted, "base64").toString("utf-8");
      expect(decoded).not.toContain(plaintext);
    });
  });

  describe("decrypt error handling", () => {
    it("throws on tampered ciphertext", () => {
      const encrypted = encrypt("test-value");
      const buf = Buffer.from(encrypted, "base64");
      // Flip a byte in the ciphertext portion
      buf[buf.length - 1] ^= 0xff;
      const tampered = buf.toString("base64");
      expect(() => decrypt(tampered)).toThrow();
    });

    it("throws on truncated data", () => {
      expect(() => decrypt(Buffer.from("short").toString("base64"))).toThrow(
        "too short"
      );
    });

    it("throws when decrypting with a different key", () => {
      const encrypted = encrypt("test-value");
      // Switch to a different key
      process.env.INTEGRATION_ENCRYPTION_KEY = crypto
        .randomBytes(32)
        .toString("hex");
      expect(() => decrypt(encrypted)).toThrow();
    });
  });

  describe("extractLast4", () => {
    it("returns last 4 characters of a long string", () => {
      expect(extractLast4("sk-test-api-key-a1b2")).toBe("a1b2");
    });

    it("returns the full string if 4 chars or fewer", () => {
      expect(extractLast4("abcd")).toBe("abcd");
      expect(extractLast4("abc")).toBe("abc");
      expect(extractLast4("a")).toBe("a");
      expect(extractLast4("")).toBe("");
    });
  });
});
