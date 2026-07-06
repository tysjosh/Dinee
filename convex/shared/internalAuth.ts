/**
 * Defense-in-depth guard for the server-to-server "internal" Convex functions
 * in `convex/internal.ts`.
 *
 * Those functions are invoked by the Next `(internal-use)` API routes, which
 * already validate the caller's `x-api-key`. But because they are public Convex
 * exports (callable by anyone who knows the deployment URL), the Next-layer
 * check alone does not protect them — a direct Convex call bypasses it. This
 * guard closes that gap by also verifying a shared secret at the Convex layer.
 *
 * The secret is compared against `INTERNAL_API_KEY` configured in the Convex
 * deployment environment (set it with `npx convex env set INTERNAL_API_KEY …`).
 * When it is not configured — e.g. local `convex dev` — the guard allows the
 * call so local development is unaffected. Production deployments MUST set it.
 *
 * The secret is passed as a dedicated argument (never inside a `data` payload
 * that handlers log), so it does not leak into function logs.
 */
export function assertInternalCaller(providedSecret: string | undefined): void {
  const expected = process.env.INTERNAL_API_KEY;

  // Not configured in this deployment (local dev) — allow, matching the
  // Next-layer dev bypass. Production deployments set INTERNAL_API_KEY.
  if (!expected) return;

  if (!providedSecret || providedSecret !== expected) {
    throw new Error("Unauthorized: invalid or missing internal caller secret");
  }
}
