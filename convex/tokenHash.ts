/**
 * Shared secure-token helpers for the Convex runtime.
 *
 * The Convex default runtime implements the Web Crypto API, so tokens are
 * generated from a CSPRNG (`crypto.getRandomValues`) and hashed with SHA-256
 * (`crypto.subtle.digest`) — replacing the previous `Math.random()` token
 * generation and the non-cryptographic djb2 hash.
 *
 * Secrets (invite tokens, etc.) are stored ONLY as their SHA-256 hash; the raw
 * value is returned to the caller once (for the email/link) and never persisted.
 */

/** Generate a cryptographically-random hex token (default 32 bytes / 64 hex). */
export function generateSecureToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hash of a string, returned as lowercase hex. */
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}
