/**
 * Feature: dinee-campus
 *
 * Client-visible re-export of the pure campus session/prompt logic that lives
 * in `convex/campus/logic/session.ts`. Mirrors the established `copy.ts`
 * re-export pattern so the `campus` VoiceDomainPack and the session driver can
 * import the grounding/prompt/routing helpers via the `@/lib/campus/*` alias
 * instead of reaching across the `src` → `convex` boundary with a deep
 * relative path.
 *
 * The re-exported module is pure (no Convex `ctx`, no I/O), so it is safe to
 * import from both the browser call surface and the Voice_Runtime.
 *
 * Requirements: 5.5, 8.3, 8.4, 8.5, 8.6
 */

export * from "../../../convex/campus/logic/session";
