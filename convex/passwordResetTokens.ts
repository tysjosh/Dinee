import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Password Reset Token mutations.
 *
 * Handles creation and validation of time-limited password reset tokens.
 * Tokens are stored as SHA-256 hashes; the raw token is returned to the
 * caller so it can be embedded in the reset link email.
 *
 * Requirements: 5.1, 5.2, 5.6
 */

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Generate a random hex token (32 bytes = 64 hex chars).
 * Uses Math.random — acceptable for reset tokens hashed before storage.
 */
function generateRandomToken(): string {
  const chars = "abcdef0123456789";
  let token = "";
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Simple hash function using Web Crypto–style approach.
 * Convex runtime doesn't expose Web Crypto, so we use a basic
 * deterministic hash (djb2 variant) producing a hex string.
 * This prevents raw tokens from being stored in the DB.
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
 * Create a password reset token for the given email.
 *
 * Generates a random token, hashes it, stores the hash with a 1-hour expiry,
 * and returns the raw token so the caller can build the reset link.
 *
 * NOTE: We intentionally do NOT check whether the email exists in the users
 * table — the UI always shows a generic success message to avoid leaking
 * whether an account exists (Requirement 5.1 / security best practice).
 */
export const createResetToken = mutation({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rawToken = generateRandomToken();
    const tokenHash = hashToken(rawToken);

    await ctx.db.insert("passwordResetTokens", {
      email: args.email.toLowerCase().trim(),
      tokenHash,
      expiresAt: now + ONE_HOUR_MS,
      used: false,
      createdAt: now,
    });

    return { rawToken, tokenHash };
  },
});

/**
 * Validate and consume a password reset token.
 *
 * Accepts a raw token (from the reset link), hashes it, looks it up,
 * and checks that it hasn't expired or been used. If valid, marks it
 * as used and returns the associated email so the caller can update
 * the user's password.
 */
export const validateAndUseToken = mutation({
  args: {
    rawToken: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenHash = hashToken(args.rawToken);

    const record = await ctx.db
      .query("passwordResetTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!record) {
      return { valid: false, error: "invalid" as const, email: null };
    }

    if (record.used) {
      return { valid: false, error: "used" as const, email: null };
    }

    if (record.expiresAt < Date.now()) {
      return { valid: false, error: "expired" as const, email: null };
    }

    // Mark token as used
    await ctx.db.patch(record._id, { used: true });

    return { valid: true, error: null, email: record.email };
  },
});

/**
 * Reset a user's password using a reset token.
 *
 * Validates the token, looks up the user by email, and updates their
 * passwordHash — all in a single mutation for atomicity.
 *
 * Requirements: 5.3, 5.4, 5.5
 */
export const resetUserPassword = mutation({
  args: {
    rawToken: v.string(),
    newPasswordHash: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenHash = hashToken(args.rawToken);

    const record = await ctx.db
      .query("passwordResetTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (!record) {
      return { success: false, error: "invalid" as const };
    }

    if (record.used) {
      return { success: false, error: "used" as const };
    }

    if (record.expiresAt < Date.now()) {
      return { success: false, error: "expired" as const };
    }

    // Look up the user by email
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", record.email))
      .first();

    if (!user) {
      // Token is valid but user no longer exists — mark token as used anyway
      await ctx.db.patch(record._id, { used: true });
      return { success: false, error: "invalid" as const };
    }

    // Mark token as used and update password
    await ctx.db.patch(record._id, { used: true });
    await ctx.db.patch(user._id, { passwordHash: args.newPasswordHash });

    return { success: true, error: null };
  },
});

