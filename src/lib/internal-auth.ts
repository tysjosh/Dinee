import { NextRequest } from "next/server";

export interface InternalAuthResult {
  valid: boolean;
  error?: string;
  statusCode?: number;
}

/**
 * Validates internal API key for internal-use route handlers.
 *
 * Fail-closed: rejects all requests when INTERNAL_API_KEY is not configured
 * in non-development environments (returns 500 misconfiguration error).
 *
 * Dev bypass: allows requests when INTERNAL_API_KEY is unset and NODE_ENV === "development".
 *
 * Key validation: when INTERNAL_API_KEY is set, validates the x-api-key header against it.
 */
export function validateInternalApiKey(request: NextRequest): InternalAuthResult {
  const apiKey = request.headers.get("x-api-key");
  const expectedKey = process.env.INTERNAL_API_KEY;

  // Development mode: allow if no key configured
  if (!expectedKey && process.env.NODE_ENV === "development") {
    return { valid: true };
  }

  // Production/staging: fail-closed if key not configured
  if (!expectedKey) {
    return {
      valid: false,
      error: "Server misconfiguration: INTERNAL_API_KEY not set",
      statusCode: 500,
    };
  }

  // Validate the provided key
  if (!apiKey || apiKey !== expectedKey) {
    return { valid: false, error: "Unauthorized", statusCode: 401 };
  }

  return { valid: true };
}

/**
 * The secret to forward to the "internal" Convex functions so they can enforce
 * their own caller check (defense-in-depth against direct Convex access that
 * bypasses this Next-layer x-api-key gate).
 *
 * Returns an empty object when INTERNAL_API_KEY is unset (local dev), matching
 * the Convex-side guard which allows unauthenticated calls only when the secret
 * is not configured.
 */
export function internalSecretArg(): { internalSecret?: string } {
  const key = process.env.INTERNAL_API_KEY;
  return key ? { internalSecret: key } : {};
}
