/**
 * Feature: multi-platform-voice-integrations, Property 8, Property 19
 *
 * Property-based tests for the Runtime_Credential_Service guard — the pure,
 * dependency-injected decision behind the service-token-guarded
 * `getCredentialsForRuntime` action
 * (`convex/integrations/runtimeCredentials.ts`, which composes exactly these
 * helpers from `convex/integrations/runtimeCredentialGuard.ts`).
 *
 * Property 8: Runtime credential guard — Validates: Requirements 3.1, 3.2, 3.3,
 *   3.4, 3.5, 3.6, 3.7, 12.5
 *   A retrieval returns `resolved` (ciphertext + config, never plaintext) only
 *   when the presented service token is byte-for-byte equal to the configured
 *   token AND a config exists; a missing/empty/whitespace token/platformId/
 *   tenantId, no configured token, or a non-matching (incl. cross-platform)
 *   token yields `unauthorized` with no credentials; a valid token but no stored
 *   config yields `unresolved` (no throw).
 *
 * Property 19: Runtime credential retrieval is tenant- and platform-isolated —
 *   Validates: Requirements 12.1
 *   A resolved retrieval returns only the credentials belonging to the exact
 *   (platformId, tenantId) pair.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluateRuntimeCredentialAccess,
  type RuntimeCredentialAccessDeps,
  type RuntimeCredentialConfig,
} from "../../convex/integrations/runtimeCredentialGuard";
import type {
  PlatformDefinition,
  ResolvePlatformResult,
} from "../../src/lib/integrations/platform/types";

// --- In-memory world model ------------------------------------------------------

/** A registered platform with its OWN service-token env var + configured value. */
interface WorldPlatform {
  platformId: string;
  envVar: string;
  /** The configured token value; empty string models "no token configured". */
  token: string;
}

interface World {
  platforms: WorldPlatform[];
  /** env var name → configured value (only set when a platform's token is non-empty). */
  env: Map<string, string>;
  /** `${platformId}\u0000${tenantId}` → stored ciphertext-only config. */
  configs: Map<string, RuntimeCredentialConfig>;
}

const pairKey = (platformId: string, tenantId: string): string =>
  `${platformId}\u0000${tenantId}`;

/** Build a minimal-but-typed PlatformDefinition; only the env-var name is read. */
function makeDefinition(platformId: string, envVar: string): PlatformDefinition {
  return {
    platformId,
    displayName: `Platform ${platformId}`,
    credentialFields: [{ name: "api_key", label: "API Key", required: true }],
    adapterFactory: (ctx) => ({
      platformId,
      contract: ctx.contract,
      readClient: { testCredential: async () => ({ valid: true }) },
      intakeClient: {
        submit: async () => ({ status: "accepted", httpStatus: 200 }),
      },
    }),
    contract: {
      authScheme: "bearer",
      readPathPrefix: "/voice",
      intakePath: "/voice-intake",
      timestampFormat: "iso-8601",
      schemaVersion: "1.0",
      tenantHeader: "X-Tenant",
    },
    runtimeServiceTokenEnvVar: envVar,
  };
}

/** Wire a World into the dependencies the pure guard consumes. */
function depsFor(world: World): RuntimeCredentialAccessDeps {
  const byId = new Map(world.platforms.map((p) => [p.platformId, p]));
  return {
    resolvePlatform: (platformId: string): ResolvePlatformResult => {
      const p = byId.get(platformId);
      if (!p) return { resolved: false };
      return { resolved: true, definition: makeDefinition(p.platformId, p.envVar) };
    },
    getEnvToken: (envVar: string) => world.env.get(envVar),
    getConfig: (platformId: string, tenantId: string) =>
      world.configs.get(pairKey(platformId, tenantId)) ?? null,
  };
}

/**
 * Independent oracle restating the acceptance criteria directly, used to check
 * the guard's decision across all generated inputs.
 */
function expectedResolution(
  world: World,
  req: { platformId: string; tenantId: string; serviceToken: string },
): "resolved" | "unresolved" | "unauthorized" {
  // Req 3.4: missing / empty / whitespace-only args → unauthorized.
  if (
    req.serviceToken.trim().length === 0 ||
    req.platformId.trim().length === 0 ||
    req.tenantId.trim().length === 0
  ) {
    return "unauthorized";
  }
  // Req 3.3: unregistered platform → unauthorized.
  const platform = world.platforms.find((p) => p.platformId === req.platformId);
  if (!platform) return "unauthorized";
  // Req 3.3: no token configured for this platform → unauthorized.
  const configured = world.env.get(platform.envVar);
  if (!configured || configured.length === 0) return "unauthorized";
  // Req 3.2 / 12.5: token must be byte-for-byte equal (incl. cross-platform).
  if (req.serviceToken !== configured) return "unauthorized";
  // Authorized: resolved iff a config exists for the exact pair (Req 3.1, 3.6).
  return world.configs.has(pairKey(req.platformId, req.tenantId))
    ? "resolved"
    : "unresolved";
}

// --- Arbitraries ----------------------------------------------------------------

/** Non-whitespace identifier-ish string, 1–64 chars. */
const idArb = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0 && s.length <= 64);

/** Ciphertext value (opaque, never plaintext). */
const cipherArb = fc.string({ minLength: 1, maxLength: 40 });

/**
 * A non-blank service token. Req 3.4 rejects missing/empty/whitespace-only
 * tokens as `unauthorized`, so tests that assert an AUTHORIZED outcome
 * (resolved/unresolved) must present a token with non-whitespace content.
 */
const tokenValueArb = fc
  .string({ minLength: 1, maxLength: 16 })
  .filter((s) => s.trim().length > 0);

/** A ciphertext-only credential map. */
const encryptedArb: fc.Arbitrary<Record<string, string>> = fc.record({
  api_key: cipherArb,
  webhook_secret: cipherArb,
});

function makeConfig(
  platformId: string,
  encrypted: Record<string, string>,
): RuntimeCredentialConfig {
  return {
    platformId,
    baseUrl: "https://api.example.com",
    platformTenantId: "platform-tenant",
    credentialsEncrypted: encrypted,
    allowedConversationTypes: ["inbound_order"],
    config: { flag: true },
    status: "connected",
  };
}

/**
 * A World with 1–4 registered platforms (unique ids + unique env vars), some of
 * which may have an empty configured token (models "no token configured"), plus
 * a set of stored ciphertext-only configs for random (platformId, tenantId) pairs.
 */
const worldArb: fc.Arbitrary<World> = fc
  .uniqueArray(idArb, { minLength: 1, maxLength: 4 })
  .chain((platformIds) =>
    fc
      .tuple(
        // token per platform ("" means unconfigured).
        fc.array(fc.oneof(fc.string({ minLength: 1, maxLength: 16 }), fc.constant("")), {
          minLength: platformIds.length,
          maxLength: platformIds.length,
        }),
        // stored configs: pairs of (platform index, tenantId, encrypted).
        fc.array(
          fc.record({
            pIdx: fc.nat({ max: platformIds.length - 1 }),
            tenantId: idArb,
            encrypted: encryptedArb,
          }),
          { maxLength: 6 },
        ),
      )
      .map(([tokens, configEntries]) => {
        const platforms: WorldPlatform[] = platformIds.map((platformId, i) => ({
          platformId,
          envVar: `RUNTIME_TOKEN_${i}`,
          token: tokens[i],
        }));
        const env = new Map<string, string>();
        for (const p of platforms) {
          if (p.token.length > 0) env.set(p.envVar, p.token);
        }
        const configs = new Map<string, RuntimeCredentialConfig>();
        for (const e of configEntries) {
          const platformId = platformIds[e.pIdx];
          configs.set(
            pairKey(platformId, e.tenantId),
            makeConfig(platformId, e.encrypted),
          );
        }
        return { platforms, env, configs };
      }),
  );

/** A request generator biased to hit every branch of the guard matrix. */
function requestArb(world: World): fc.Arbitrary<{
  platformId: string;
  tenantId: string;
  serviceToken: string;
}> {
  const registeredIds = world.platforms.map((p) => p.platformId);
  const configuredTokens = world.platforms
    .map((p) => p.token)
    .filter((t) => t.length > 0);
  const storedTenantIds = [...world.configs.keys()].map(
    (k) => k.split("\u0000")[1],
  );

  const platformIdArb = fc.oneof(
    fc.constantFrom(...registeredIds),
    idArb, // possibly unregistered
    fc.constant(""),
    fc.constant("   "),
  );
  const tenantIdArb = fc.oneof(
    storedTenantIds.length > 0 ? fc.constantFrom(...storedTenantIds) : idArb,
    idArb,
    fc.constant(""),
    fc.constant("  "),
  );
  const tokenArb = fc.oneof(
    configuredTokens.length > 0 ? fc.constantFrom(...configuredTokens) : idArb,
    idArb, // likely wrong
    fc.constant(""),
    fc.constant("   "),
  );

  return fc.record({
    platformId: platformIdArb,
    tenantId: tenantIdArb,
    serviceToken: tokenArb,
  });
}

// --- Property 8 -----------------------------------------------------------------

describe("Property 8: Runtime credential guard", () => {
  it("decides resolved/unresolved/unauthorized exactly per the token+config matrix (Req 3.1–3.6, 12.5)", () => {
    fc.assert(
      fc.property(
        worldArb.chain((world) =>
          requestArb(world).map((req) => ({ world, req })),
        ),
        ({ world, req }) => {
          const deps = depsFor(world);
          const result = evaluateRuntimeCredentialAccess(req, deps);

          const expected = expectedResolution(world, req);
          expect(result.resolution).toBe(expected);

          if (result.resolution === "resolved") {
            // Req 3.5: only ciphertext is returned — the exact stored object,
            // with no plaintext credential field of any kind.
            const stored = world.configs.get(
              pairKey(req.platformId, req.tenantId),
            );
            expect(stored).toBeDefined();
            expect(result.config).toBe(stored);
            expect(result.config.credentialsEncrypted).toEqual(
              stored!.credentialsEncrypted,
            );
            expect(
              (result.config as Record<string, unknown>).credentials,
            ).toBeUndefined();
            expect(
              (result.config as Record<string, unknown>).credentialsPlaintext,
            ).toBeUndefined();
          } else {
            // Req 3.2–3.4, 3.6: no credentials/config on non-resolved outcomes.
            expect(result).not.toHaveProperty("config");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects any missing/empty/whitespace platformId, tenantId, or serviceToken (Req 3.4)", () => {
    const blankArb = fc.constantFrom("", " ", "\t", "\n", "   ");
    fc.assert(
      fc.property(
        worldArb,
        fc.record({
          platformId: fc.oneof(idArb, blankArb),
          tenantId: fc.oneof(idArb, blankArb),
          serviceToken: fc.oneof(idArb, blankArb),
        }),
        (world, req) => {
          fc.pre(
            req.platformId.trim().length === 0 ||
              req.tenantId.trim().length === 0 ||
              req.serviceToken.trim().length === 0,
          );
          const result = evaluateRuntimeCredentialAccess(req, depsFor(world));
          expect(result.resolution).toBe("unauthorized");
          expect(result).not.toHaveProperty("config");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("resolves with a byte-for-byte token match and a stored config (Req 3.1)", () => {
    fc.assert(
      fc.property(
        idArb,
        idArb,
        tokenValueArb,
        encryptedArb,
        (platformId, tenantId, token, encrypted) => {
          const envVar = "RUNTIME_TOKEN_0";
          const world: World = {
            platforms: [{ platformId, envVar, token }],
            env: new Map([[envVar, token]]),
            configs: new Map([
              [pairKey(platformId, tenantId), makeConfig(platformId, encrypted)],
            ]),
          };
          const result = evaluateRuntimeCredentialAccess(
            { platformId, tenantId, serviceToken: token },
            depsFor(world),
          );
          expect(result.resolution).toBe("resolved");
          if (result.resolution === "resolved") {
            expect(result.config.credentialsEncrypted).toEqual(encrypted);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns unresolved for a valid token with no stored config, never throwing (Req 3.6)", () => {
    fc.assert(
      fc.property(
        idArb,
        idArb,
        tokenValueArb,
        (platformId, tenantId, token) => {
          const envVar = "RUNTIME_TOKEN_0";
          const world: World = {
            platforms: [{ platformId, envVar, token }],
            env: new Map([[envVar, token]]),
            configs: new Map(), // no config for the pair
          };
          const result = evaluateRuntimeCredentialAccess(
            { platformId, tenantId, serviceToken: token },
            depsFor(world),
          );
          expect(result.resolution).toBe("unresolved");
          expect(result).not.toHaveProperty("config");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects a cross-platform token: platform B's token cannot retrieve platform A's credentials (Req 12.5)", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(idArb, { minLength: 2, maxLength: 2 }),
        idArb,
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 16 }), {
          minLength: 2,
          maxLength: 2,
        }),
        encryptedArb,
        ([platformA, platformB], tenantId, [tokenA, tokenB], encrypted) => {
          const world: World = {
            platforms: [
              { platformId: platformA, envVar: "RUNTIME_TOKEN_0", token: tokenA },
              { platformId: platformB, envVar: "RUNTIME_TOKEN_1", token: tokenB },
            ],
            env: new Map([
              ["RUNTIME_TOKEN_0", tokenA],
              ["RUNTIME_TOKEN_1", tokenB],
            ]),
            configs: new Map([
              [pairKey(platformA, tenantId), makeConfig(platformA, encrypted)],
            ]),
          };
          // Present platform B's token when asking for platform A's creds.
          const result = evaluateRuntimeCredentialAccess(
            { platformId: platformA, tenantId, serviceToken: tokenB },
            depsFor(world),
          );
          expect(result.resolution).toBe("unauthorized");
          expect(result).not.toHaveProperty("config");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects when the platform has no configured token (Req 3.3)", () => {
    fc.assert(
      fc.property(
        idArb,
        idArb,
        fc.string({ minLength: 1, maxLength: 16 }),
        (platformId, tenantId, presentedToken) => {
          const world: World = {
            platforms: [
              { platformId, envVar: "RUNTIME_TOKEN_0", token: "" },
            ],
            env: new Map(), // env var unset → no token configured
            configs: new Map([
              [pairKey(platformId, tenantId), makeConfig(platformId, { api_key: "ct" })],
            ]),
          };
          const result = evaluateRuntimeCredentialAccess(
            { platformId, tenantId, serviceToken: presentedToken },
            depsFor(world),
          );
          expect(result.resolution).toBe("unauthorized");
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 19 ----------------------------------------------------------------

describe("Property 19: Runtime credential retrieval is tenant- and platform-isolated", () => {
  it("a resolved retrieval returns only the exact pair's ciphertext, never another pair's (Req 12.1)", () => {
    fc.assert(
      fc.property(
        // Two distinct (platformId, tenantId) pairs with distinct ciphertext.
        fc
          .record({
            platformA: idArb,
            platformB: idArb,
            tenantA: idArb,
            tenantB: idArb,
            tokenA: tokenValueArb,
            tokenB: tokenValueArb,
            encA: encryptedArb,
            encB: encryptedArb,
          })
          .filter(
            (s) =>
              // Ensure the two pairs are distinct and ciphertext differs.
              pairKey(s.platformA, s.tenantA) !==
                pairKey(s.platformB, s.tenantB) &&
              JSON.stringify(s.encA) !== JSON.stringify(s.encB),
          ),
        (s) => {
          const samePlatform = s.platformA === s.platformB;
          const platforms: WorldPlatform[] = samePlatform
            ? [{ platformId: s.platformA, envVar: "RUNTIME_TOKEN_0", token: s.tokenA }]
            : [
                { platformId: s.platformA, envVar: "RUNTIME_TOKEN_0", token: s.tokenA },
                { platformId: s.platformB, envVar: "RUNTIME_TOKEN_1", token: s.tokenB },
              ];
          const env = new Map<string, string>();
          for (const p of platforms) env.set(p.envVar, p.token);

          const configs = new Map<string, RuntimeCredentialConfig>([
            [pairKey(s.platformA, s.tenantA), makeConfig(s.platformA, s.encA)],
            [pairKey(s.platformB, s.tenantB), makeConfig(s.platformB, s.encB)],
          ]);

          const deps = depsFor({ platforms, env, configs });

          // Retrieve pair A → returns exactly A's ciphertext, never B's.
          const resA = evaluateRuntimeCredentialAccess(
            {
              platformId: s.platformA,
              tenantId: s.tenantA,
              serviceToken: s.tokenA,
            },
            deps,
          );
          expect(resA.resolution).toBe("resolved");
          if (resA.resolution === "resolved") {
            expect(resA.config.credentialsEncrypted).toEqual(s.encA);
            expect(resA.config.credentialsEncrypted).not.toEqual(s.encB);
            expect(resA.config.platformId).toBe(s.platformA);
          }

          // Retrieve pair B → returns exactly B's ciphertext, never A's.
          const resB = evaluateRuntimeCredentialAccess(
            {
              platformId: s.platformB,
              tenantId: s.tenantB,
              serviceToken: samePlatform ? s.tokenA : s.tokenB,
            },
            deps,
          );
          expect(resB.resolution).toBe("resolved");
          if (resB.resolution === "resolved") {
            expect(resB.config.credentialsEncrypted).toEqual(s.encB);
            expect(resB.config.credentialsEncrypted).not.toEqual(s.encA);
            expect(resB.config.platformId).toBe(s.platformB);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
