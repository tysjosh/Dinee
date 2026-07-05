/**
 * Feature: multi-platform-voice-integrations, Property 1, Property 2, Property 3
 *
 * Property-based tests for the in-process Integration_Registry
 * (src/lib/integrations/platform/registry.ts).
 *
 * Property 1: Platform registration round-trip — Validates: Requirements 1.1, 1.6
 *   For any valid PlatformDefinition (id length 1–64, present adapterFactory and
 *   Transport_Contract), registering it and then resolving that platformId returns
 *   the same definition and isPlatformRegistered reports true.
 *
 * Property 2: Rejected registration reports the correct error and leaves the registry
 *   unchanged — Validates: Requirements 1.2, 1.3, 1.4, 1.5
 *   A duplicate id reports duplicate_id naming the conflicting id; an id shorter than
 *   1 or longer than 64 characters reports invalid_id; an omitted adapterFactory or
 *   contract reports missing_field naming the omitted field; and the set of registered
 *   platforms is identical before and after the rejected attempt.
 *
 * Property 3: Unregistered lookup is an explicit unresolved result, never a throw —
 *   Validates: Requirements 1.7
 *   For any unregistered platformId, resolvePlatform returns { resolved: false } and
 *   does not throw.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import {
  registerPlatform,
  resolvePlatform,
  isPlatformRegistered,
  clearPlatformRegistry,
} from "../../src/lib/integrations/platform/registry";
import type {
  PlatformDefinition,
  TransportContract,
  AdapterConstructionContext,
} from "../../src/lib/integrations/platform/types";
import type { IntegrationAdapter } from "../../src/lib/integrations/platform/adapter";

// --- Arbitraries: build valid PlatformDefinitions -------------------------------

/** A dummy adapter factory: a present function satisfying AdapterFactory. */
function makeAdapterFactory(platformId: string) {
  return (ctx: AdapterConstructionContext): IntegrationAdapter => ({
    platformId,
    contract: ctx.contract,
    readClient: { testCredential: async () => ({ valid: true }) },
    intakeClient: {
      submit: async () => ({ status: "accepted", httpStatus: 200 }),
    },
  });
}

/** A valid TransportContract object (optionally with a key salt). */
const contractArb: fc.Arbitrary<TransportContract> = fc.record({
  authScheme: fc.constantFrom<TransportContract["authScheme"]>("bearer", "hmac"),
  readPathPrefix: fc.string({ minLength: 1, maxLength: 16 }),
  intakePath: fc.string({ minLength: 1, maxLength: 16 }),
  timestampFormat: fc.constantFrom<TransportContract["timestampFormat"]>(
    "iso-8601",
    "epoch-seconds",
    "epoch-millis",
  ),
  schemaVersion: fc.string({ minLength: 1, maxLength: 8 }),
  tenantHeader: fc.string({ minLength: 1, maxLength: 24 }),
  keySalt: fc.option(fc.string({ maxLength: 24 }), { nil: undefined }),
});

/** Valid platformId: 1–64 characters. */
const validIdArb = fc.string({ minLength: 1, maxLength: 64 });

/** Build a valid PlatformDefinition for a given id + contract. */
function makeDefinition(
  platformId: string,
  contract: TransportContract,
): PlatformDefinition {
  return {
    platformId,
    displayName: `Platform ${platformId}`,
    credentialFields: [{ name: "api_key", label: "API Key", required: true }],
    adapterFactory: makeAdapterFactory(platformId),
    contract,
    runtimeServiceTokenEnvVar: "SERVICE_TOKEN",
  };
}

const validDefinitionArb: fc.Arbitrary<PlatformDefinition> = fc
  .tuple(validIdArb, contractArb)
  .map(([id, contract]) => makeDefinition(id, contract));

/**
 * A set of valid seed definitions with distinct ids, used to establish a known
 * registry membership before a rejected-registration attempt.
 */
const seedDefinitionsArb: fc.Arbitrary<PlatformDefinition[]> = fc
  .uniqueArray(validIdArb, { minLength: 1, maxLength: 5 })
  .chain((ids) =>
    fc.tuple(...ids.map((id) => contractArb.map((c) => makeDefinition(id, c)))),
  );

beforeEach(() => {
  clearPlatformRegistry();
});

// --- Property 1 -----------------------------------------------------------------

describe("Property 1: Platform registration round-trip", () => {
  it("registers a valid definition and resolves back the same definition (Req 1.1, 1.6)", () => {
    fc.assert(
      fc.property(validDefinitionArb, (def) => {
        clearPlatformRegistry();

        const result = registerPlatform(def);
        expect(result.ok).toBe(true);

        const resolved = resolvePlatform(def.platformId);
        expect(resolved.resolved).toBe(true);
        if (resolved.resolved) {
          // Same definition is returned, byte-for-byte identity preserved.
          expect(resolved.definition).toBe(def);
        }

        expect(isPlatformRegistered(def.platformId)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 2 -----------------------------------------------------------------

describe("Property 2: Rejected registration reports the correct error and leaves the registry unchanged", () => {
  /** Registers the seed definitions and asserts each is resolvable. */
  function seedRegistry(seeds: PlatformDefinition[]): void {
    for (const seed of seeds) {
      const r = registerPlatform(seed);
      expect(r.ok).toBe(true);
    }
  }

  /** Asserts every seed is still registered to its exact definition. */
  function assertSeedsIntact(seeds: PlatformDefinition[]): void {
    for (const seed of seeds) {
      expect(isPlatformRegistered(seed.platformId)).toBe(true);
      const resolved = resolvePlatform(seed.platformId);
      expect(resolved.resolved).toBe(true);
      if (resolved.resolved) {
        expect(resolved.definition).toBe(seed);
      }
    }
  }

  it("rejects a duplicate id with duplicate_id naming the conflicting id and leaves the registry unchanged (Req 1.2, 1.5)", () => {
    fc.assert(
      fc.property(
        seedDefinitionsArb,
        fc.nat(),
        contractArb,
        (seeds, pick, contract) => {
          clearPlatformRegistry();
          seedRegistry(seeds);

          const conflicting = seeds[pick % seeds.length];
          const dup = makeDefinition(conflicting.platformId, contract);

          const result = registerPlatform(dup);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("duplicate_id");
            expect(result.error.detail).toBe(conflicting.platformId);
          }

          // The conflicting id still resolves to the ORIGINAL seed, not the dup.
          const resolved = resolvePlatform(conflicting.platformId);
          expect(resolved.resolved).toBe(true);
          if (resolved.resolved) {
            expect(resolved.definition).toBe(conflicting);
          }
          assertSeedsIntact(seeds);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects an id shorter than 1 or longer than 64 chars with invalid_id and leaves the registry unchanged (Req 1.3, 1.5)", () => {
    const invalidIdArb = fc.oneof(
      fc.constant(""),
      fc.string({ minLength: 65, maxLength: 200 }),
    );
    fc.assert(
      fc.property(
        seedDefinitionsArb,
        invalidIdArb,
        contractArb,
        (seeds, badId, contract) => {
          clearPlatformRegistry();
          seedRegistry(seeds);

          const bad = makeDefinition(badId, contract);
          const result = registerPlatform(bad);

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("invalid_id");
          }
          assertSeedsIntact(seeds);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects a missing adapterFactory with missing_field naming adapterFactory and leaves the registry unchanged (Req 1.4, 1.5)", () => {
    // A unique id not present in the seeds so we can assert it never gets added.
    const noveltyId = "novel-missing-factory-id";
    fc.assert(
      fc.property(
        seedDefinitionsArb.filter(
          (seeds) => !seeds.some((s) => s.platformId === noveltyId),
        ),
        contractArb,
        (seeds, contract) => {
          clearPlatformRegistry();
          seedRegistry(seeds);

          // Build a definition with the adapterFactory omitted.
          const def = makeDefinition(noveltyId, contract) as PlatformDefinition;
          delete (def as { adapterFactory?: unknown }).adapterFactory;

          const result = registerPlatform(def);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("missing_field");
            expect(result.error.detail).toBe("adapterFactory");
          }

          expect(isPlatformRegistered(noveltyId)).toBe(false);
          assertSeedsIntact(seeds);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects a missing contract with missing_field naming contract and leaves the registry unchanged (Req 1.4, 1.5)", () => {
    const noveltyId = "novel-missing-contract-id";
    fc.assert(
      fc.property(
        seedDefinitionsArb.filter(
          (seeds) => !seeds.some((s) => s.platformId === noveltyId),
        ),
        contractArb,
        (seeds, contract) => {
          clearPlatformRegistry();
          seedRegistry(seeds);

          // adapterFactory present, contract omitted.
          const def = makeDefinition(noveltyId, contract) as PlatformDefinition;
          delete (def as { contract?: unknown }).contract;

          const result = registerPlatform(def);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("missing_field");
            expect(result.error.detail).toBe("contract");
          }

          expect(isPlatformRegistered(noveltyId)).toBe(false);
          assertSeedsIntact(seeds);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 3 -----------------------------------------------------------------

describe("Property 3: Unregistered lookup is an explicit unresolved result, never a throw", () => {
  it("returns { resolved: false } for any unregistered id and never throws (Req 1.7)", () => {
    fc.assert(
      fc.property(
        seedDefinitionsArb,
        fc.string({ maxLength: 80 }),
        (seeds, lookupId) => {
          clearPlatformRegistry();
          for (const seed of seeds) {
            registerPlatform(seed);
          }

          // Only exercise ids that are genuinely not registered.
          fc.pre(!seeds.some((s) => s.platformId === lookupId));

          let resolved: ReturnType<typeof resolvePlatform> | undefined;
          expect(() => {
            resolved = resolvePlatform(lookupId);
          }).not.toThrow();

          expect(resolved).toEqual({ resolved: false });
          expect(isPlatformRegistered(lookupId)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
