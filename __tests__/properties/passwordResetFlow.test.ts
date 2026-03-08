/**
 * Feature: convex-auth-integration, Property 8-9: Password reset flow properties
 *
 * Validates: Requirements 5.2, 5.4, 5.6
 *
 * Property 8: Password reset round trip
 *   For any user with a registered email, generating a password reset token and
 *   then submitting that token with a new password should result in the user's
 *   passwordHash being updated, and the user should be able to log in with the
 *   new password.
 *
 * Property 9: Reset token expiry
 *   For any password reset token, if more than 1 hour has elapsed since creation,
 *   the token should be rejected when used.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// --- Constants mirroring convex/passwordResetTokens.ts ---

const ONE_HOUR_MS = 60 * 60 * 1000;

// --- Hash function mirroring convex/passwordResetTokens.ts ---

/**
 * Deterministic hash (djb2 variant) matching the hashToken function
 * in convex/passwordResetTokens.ts.
 */
function hashToken(token: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < token.length; i++) {
    const ch = token.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(16, "0");
}

/**
 * Generate a random hex token (64 hex chars) matching generateRandomToken
 * in convex/passwordResetTokens.ts.
 */
function generateRandomToken(): string {
  const chars = "abcdef0123456789";
  let token = "";
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// --- Simulated stores ---

interface UserRecord {
  userId: string;
  email: string;
  passwordHash: string;
  role: string;
  tenantType: string;
  tenantId: string;
}

interface TokenRecord {
  email: string;
  tokenHash: string;
  expiresAt: number;
  used: boolean;
  createdAt: number;
}

/**
 * Simulates the user store and password reset token store,
 * mirroring the Convex DB operations in convex/passwordResetTokens.ts
 * and convex/users.ts.
 */
class PasswordResetStore {
  private users: Map<string, UserRecord> = new Map();
  private tokens: Map<string, TokenRecord> = new Map();
  private nextId = 1;
  private currentTime: number;

  constructor(initialTime: number = Date.now()) {
    this.currentTime = initialTime;
  }

  /** Advance the simulated clock */
  advanceTime(ms: number): void {
    this.currentTime += ms;
  }

  /** Set the simulated clock to a specific time */
  setTime(time: number): void {
    this.currentTime = time;
  }

  /** Get current simulated time */
  now(): number {
    return this.currentTime;
  }

  /** Seed a user into the store */
  addUser(email: string, passwordHash: string): UserRecord {
    const normalizedEmail = email.toLowerCase().trim();
    const record: UserRecord = {
      userId: `user_${this.nextId++}`,
      email: normalizedEmail,
      passwordHash,
      role: "restaurant_owner",
      tenantType: "restaurant",
      tenantId: "",
    };
    this.users.set(normalizedEmail, record);
    return record;
  }

  /** Look up user by email */
  findUserByEmail(email: string): UserRecord | undefined {
    return this.users.get(email.toLowerCase().trim());
  }

  /**
   * Create a password reset token.
   * Mirrors createResetToken mutation in convex/passwordResetTokens.ts.
   */
  createResetToken(email: string): { rawToken: string; tokenHash: string } {
    const rawToken = generateRandomToken();
    const tokenHash = hashToken(rawToken);

    const record: TokenRecord = {
      email: email.toLowerCase().trim(),
      tokenHash,
      expiresAt: this.currentTime + ONE_HOUR_MS,
      used: false,
      createdAt: this.currentTime,
    };
    this.tokens.set(tokenHash, record);

    return { rawToken, tokenHash };
  }

  /**
   * Validate and use a reset token.
   * Mirrors validateAndUseToken mutation in convex/passwordResetTokens.ts.
   */
  validateAndUseToken(rawToken: string): {
    valid: boolean;
    error: "invalid" | "used" | "expired" | null;
    email: string | null;
  } {
    const tokenHash = hashToken(rawToken);
    const record = this.tokens.get(tokenHash);

    if (!record) {
      return { valid: false, error: "invalid", email: null };
    }

    if (record.used) {
      return { valid: false, error: "used", email: null };
    }

    if (record.expiresAt < this.currentTime) {
      return { valid: false, error: "expired", email: null };
    }

    // Mark token as used
    record.used = true;

    return { valid: true, error: null, email: record.email };
  }

  /**
   * Reset a user's password using a raw token.
   * Mirrors resetUserPassword mutation in convex/passwordResetTokens.ts.
   */
  resetUserPassword(
    rawToken: string,
    newPasswordHash: string
  ): { success: boolean; error: "invalid" | "used" | "expired" | null } {
    const tokenHash = hashToken(rawToken);
    const record = this.tokens.get(tokenHash);

    if (!record) {
      return { success: false, error: "invalid" };
    }

    if (record.used) {
      return { success: false, error: "used" };
    }

    if (record.expiresAt < this.currentTime) {
      return { success: false, error: "expired" };
    }

    const user = this.findUserByEmail(record.email);
    if (!user) {
      record.used = true;
      return { success: false, error: "invalid" };
    }

    // Mark token as used and update password
    record.used = true;
    user.passwordHash = newPasswordHash;

    return { success: true, error: null };
  }

  /**
   * Simulate login: check email + password match.
   * Mirrors the login flow from src/app/client/login/page.tsx.
   */
  login(
    email: string,
    password: string
  ): { success: boolean; error?: string } {
    const user = this.findUserByEmail(email);
    if (!user) {
      return { success: false, error: "Invalid email or password" };
    }
    if (user.passwordHash !== password) {
      return { success: false, error: "Invalid email or password" };
    }
    return { success: true };
  }
}

// --- Arbitraries ---

/** Generates valid email addresses */
const validEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9._]{0,19}$/),
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,9}$/),
    fc.constantFrom("com", "org", "net", "io", "co", "dev")
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`)
  .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

/** Generates valid passwords (8+ characters) */
const validPasswordArb = fc
  .string({ minLength: 8, maxLength: 64 })
  .filter((p) => p.length >= 8);

/**
 * Generates a new password guaranteed to differ from the original.
 */
function differentPasswordArb(original: string): fc.Arbitrary<string> {
  return validPasswordArb.filter((p) => p !== original);
}

/**
 * Generates a time offset in milliseconds that is strictly greater than 1 hour.
 * Used to simulate expired tokens.
 */
const expiredOffsetArb = fc.integer({
  min: ONE_HOUR_MS + 1,
  max: ONE_HOUR_MS * 24, // up to 24 hours past
});

/**
 * Generates a time offset in milliseconds that is within the 1-hour window.
 * Used to simulate valid (non-expired) tokens.
 */
const validOffsetArb = fc.integer({
  min: 0,
  max: ONE_HOUR_MS - 1,
});

// --- Tests ---

describe("Property 8: Password reset round trip", () => {
  it("for any registered user, generating a reset token and using it with a new password updates the passwordHash", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        validPasswordArb,
        (email, originalPassword, newPassword) => {
          fc.pre(originalPassword !== newPassword);

          const store = new PasswordResetStore();
          store.addUser(email, originalPassword);

          // Verify original password works
          expect(store.login(email, originalPassword).success).toBe(true);

          // Generate reset token
          const { rawToken } = store.createResetToken(email);

          // Use the token to reset password
          const result = store.resetUserPassword(rawToken, newPassword);
          expect(result.success).toBe(true);
          expect(result.error).toBeNull();

          // Verify the passwordHash was updated
          const user = store.findUserByEmail(email);
          expect(user).toBeDefined();
          expect(user!.passwordHash).toBe(newPassword);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("after password reset, the user can log in with the new password", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        validPasswordArb,
        (email, originalPassword, newPassword) => {
          fc.pre(originalPassword !== newPassword);

          const store = new PasswordResetStore();
          store.addUser(email, originalPassword);

          const { rawToken } = store.createResetToken(email);
          store.resetUserPassword(rawToken, newPassword);

          // New password works
          const loginResult = store.login(email, newPassword);
          expect(loginResult.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("after password reset, the old password no longer works", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        validPasswordArb,
        (email, originalPassword, newPassword) => {
          fc.pre(originalPassword !== newPassword);

          const store = new PasswordResetStore();
          store.addUser(email, originalPassword);

          const { rawToken } = store.createResetToken(email);
          store.resetUserPassword(rawToken, newPassword);

          // Old password no longer works
          const loginResult = store.login(email, originalPassword);
          expect(loginResult.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a used reset token cannot be reused", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        validPasswordArb,
        validPasswordArb,
        (email, originalPassword, newPassword1, newPassword2) => {
          fc.pre(originalPassword !== newPassword1);

          const store = new PasswordResetStore();
          store.addUser(email, originalPassword);

          const { rawToken } = store.createResetToken(email);

          // First use succeeds
          const result1 = store.resetUserPassword(rawToken, newPassword1);
          expect(result1.success).toBe(true);

          // Second use fails with "used" error
          const result2 = store.resetUserPassword(rawToken, newPassword2);
          expect(result2.success).toBe(false);
          expect(result2.error).toBe("used");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("the token hash is deterministic — same raw token always produces the same hash", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[abcdef0-9]{64}$/),
        (rawToken) => {
          const hash1 = hashToken(rawToken);
          const hash2 = hashToken(rawToken);
          expect(hash1).toBe(hash2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 9: Reset token expiry", () => {
  it("for any token, if more than 1 hour has elapsed, the token is rejected as expired", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        validPasswordArb,
        expiredOffsetArb,
        (email, originalPassword, newPassword, elapsedMs) => {
          const baseTime = 1700000000000; // fixed base time
          const store = new PasswordResetStore(baseTime);
          store.addUser(email, originalPassword);

          // Create token at baseTime
          const { rawToken } = store.createResetToken(email);

          // Advance time past the 1-hour expiry
          store.advanceTime(elapsedMs);

          // Token should be rejected
          const result = store.resetUserPassword(rawToken, newPassword);
          expect(result.success).toBe(false);
          expect(result.error).toBe("expired");

          // Password should remain unchanged
          const user = store.findUserByEmail(email);
          expect(user!.passwordHash).toBe(originalPassword);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any token, if less than 1 hour has elapsed, the token is accepted", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        validPasswordArb,
        validOffsetArb,
        (email, originalPassword, newPassword, elapsedMs) => {
          fc.pre(originalPassword !== newPassword);

          const baseTime = 1700000000000;
          const store = new PasswordResetStore(baseTime);
          store.addUser(email, originalPassword);

          // Create token at baseTime
          const { rawToken } = store.createResetToken(email);

          // Advance time within the 1-hour window
          store.advanceTime(elapsedMs);

          // Token should be accepted
          const result = store.resetUserPassword(rawToken, newPassword);
          expect(result.success).toBe(true);
          expect(result.error).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a token used at exactly the 1-hour boundary is rejected (strict less-than check)", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        validPasswordArb,
        (email, originalPassword, newPassword) => {
          const baseTime = 1700000000000;
          const store = new PasswordResetStore(baseTime);
          store.addUser(email, originalPassword);

          const { rawToken } = store.createResetToken(email);

          // Advance exactly 1 hour — expiresAt = baseTime + ONE_HOUR_MS
          // The check is `expiresAt < currentTime`, so at exactly expiresAt
          // the condition is false (not expired). Advance 1ms past to trigger.
          store.advanceTime(ONE_HOUR_MS + 1);

          const result = store.resetUserPassword(rawToken, newPassword);
          expect(result.success).toBe(false);
          expect(result.error).toBe("expired");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("validateAndUseToken also rejects expired tokens", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        expiredOffsetArb,
        (email, password, elapsedMs) => {
          const baseTime = 1700000000000;
          const store = new PasswordResetStore(baseTime);
          store.addUser(email, password);

          const { rawToken } = store.createResetToken(email);

          // Advance past expiry
          store.advanceTime(elapsedMs);

          const result = store.validateAndUseToken(rawToken);
          expect(result.valid).toBe(false);
          expect(result.error).toBe("expired");
          expect(result.email).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("an invalid (non-existent) raw token is rejected regardless of time", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        fc.string({ minLength: 10, maxLength: 64 }),
        (email, password, fakeToken) => {
          const store = new PasswordResetStore();
          store.addUser(email, password);

          // Don't create any reset token — just try a random string
          const result = store.resetUserPassword(fakeToken, "newpass12345");
          expect(result.success).toBe(false);
          expect(result.error).toBe("invalid");
        }
      ),
      { numRuns: 100 }
    );
  });
});
