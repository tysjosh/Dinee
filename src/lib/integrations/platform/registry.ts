// src/lib/integrations/platform/registry.ts
//
// Integration_Registry — pure, in-process, deterministic.
//
// Registers and resolves external Platform_Definitions keyed by Platform_Id,
// mirroring the patterns of the existing voiceDomainPackRegistry: a Map keyed
// by id, a pure validate-before-mutate step, and resolution that returns an
// explicit unresolved result rather than throwing.
//
// Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7

import type {
  PlatformDefinition,
  PlatformRegistrationError,
  RegisterPlatformResult,
  ResolvePlatformResult,
} from "./types";

// Platform_Id bounds (Req 1.1, 1.3).
const ID_MIN = 1;
const ID_MAX = 64;

/**
 * The single source of truth for registered platforms, keyed by Platform_Id.
 * A Map keeps iteration order deterministic for resolution.
 */
const registry = new Map<string, PlatformDefinition>();

/**
 * Validates a platform definition against the ordered rules. Returns the error
 * to report, or `null` when the definition is valid. This performs NO mutation
 * so callers can run it before inserting to keep registration atomic — a
 * rejected registration never mutates the registry (Req 1.2, 1.3, 1.4, 1.5).
 */
function validatePlatform(
  def: PlatformDefinition,
): PlatformRegistrationError | null {
  // 1. platformId present, 1–64 chars → invalid_id (Req 1.3).
  if (
    typeof def.platformId !== "string" ||
    def.platformId.length < ID_MIN ||
    def.platformId.length > ID_MAX
  ) {
    return { code: "invalid_id", detail: "platformId" };
  }

  // 2. platformId unique → duplicate_id naming the conflicting id (Req 1.2).
  if (registry.has(def.platformId)) {
    return { code: "duplicate_id", detail: def.platformId };
  }

  // 3. Required construction fields present → missing_field naming the field
  //    (Req 1.4). The adapter factory and Transport_Contract are what the
  //    runtime needs to build and drive the adapter.
  if (typeof def.adapterFactory !== "function") {
    return { code: "missing_field", detail: "adapterFactory" };
  }
  if (def.contract === undefined || def.contract === null) {
    return { code: "missing_field", detail: "contract" };
  }

  return null;
}

/**
 * Validates and registers a platform. On failure the registry is left
 * unchanged — validation completes fully before any insertion, so a rejected
 * registration never mutates the set of registered platforms (Req 1.1–1.5).
 */
export function registerPlatform(
  def: PlatformDefinition,
): RegisterPlatformResult {
  const error = validatePlatform(def);
  if (error) {
    return { ok: false, error };
  }
  registry.set(def.platformId, def);
  return { ok: true };
}

/**
 * Resolves a platform by id. An unregistered id yields an explicit
 * `{ resolved: false }` result and never raises an error (Req 1.6, 1.7).
 */
export function resolvePlatform(platformId: string): ResolvePlatformResult {
  const definition = registry.get(platformId);
  if (definition === undefined) {
    return { resolved: false };
  }
  return { resolved: true, definition };
}

/**
 * True when a platform id is registered. Used by the config-store save guard
 * to reject configs for unregistered platforms (Req 2.4).
 */
export function isPlatformRegistered(platformId: string): boolean {
  return registry.has(platformId);
}

/**
 * Returns a snapshot of all registered Platform_Definitions. Read-only: it
 * returns a fresh array copy of the registry's values and NEVER mutates the
 * registry. Used by the Control_Plane catalog projection to enumerate
 * registered platforms (Control_Plane Req 1.1).
 */
export function listRegisteredPlatforms(): PlatformDefinition[] {
  return Array.from(registry.values());
}

/** Clears all registered platforms. Intended for testing only. */
export function clearPlatformRegistry(): void {
  registry.clear();
}
