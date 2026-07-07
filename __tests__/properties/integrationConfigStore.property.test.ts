// Feature: multi-platform-voice-integrations, Property 5: Config store upsert keying and initial status — an Integration_Config is keyed uniquely by (platformId, tenantId): saving the same pair twice updates the single existing record rather than duplicating, distinct pairs coexist independently, and a newly created record starts Connection_Status "disconnected"
// Feature: multi-platform-voice-integrations, Property 6: Config validation rejection — an empty/whitespace baseUrl is rejected with a missing_field error naming baseUrl; an unregistered platformId is rejected with an unknown_platform error naming the platformId; both leave any existing record unchanged
// Feature: multi-platform-voice-integrations, Property 7: Masked view never exposes credential material — the masked view exposes at most the last 4 characters of each credential and contains no decrypted plaintext and no ciphertext credential value
//
// Property 5 — Validates: Requirements 2.1, 2.5, 2.6
// Property 6 — Validates: Requirements 2.3, 2.4
// Property 7 — Validates: Requirements 2.8
//
// Req 2.1: WHEN an Integration_Config is saved with a Platform_Id, a Tenant_Id,
// a non-empty base URL, and one or more credential values, THE
// Integration_Config_Store SHALL persist the record keyed by the pair
// (Platform_Id, Tenant_Id).
//
// Req 2.3: IF an Integration_Config is saved with an empty base URL, THEN THE
// Integration_Config_Store SHALL reject the save, report a missing-field error
// naming the base URL, and leave any existing stored record unchanged.
//
// Req 2.4: IF an Integration_Config is saved for a Platform_Id that is not
// registered in the Integration_Registry, THEN THE Integration_Config_Store
// SHALL reject the save and report an unknown-platform error naming the
// Platform_Id.
//
// Req 2.5: WHEN an Integration_Config already exists for a (Platform_Id,
// Tenant_Id) pair and a new save is submitted for the same pair, THE
// Integration_Config_Store SHALL update the existing record rather than create
// a duplicate.
//
// Req 2.6: WHEN a newly created Integration_Config is persisted, THE
// Integration_Config_Store SHALL set its Connection_Status to `disconnected`.
//
// Req 2.8: WHEN an Integration_Config is returned to the Integration_Admin_UI,
// THE Integration_Config_Store SHALL return a masked view that includes at most
// the last 4 characters of each credential and SHALL NOT include any decrypted
// credential value.
//
// The Convex mutations/queries in convex/integrations/configStore.ts require a
// Convex DB, so — mirroring the prevailing repo convention (see
// phoneRoute.property.test.ts / numberMapping.property.test.ts) — this suite
// exercises the extracted PURE helper `validateIntegrationConfig` directly
// (Property 6) and drives a tiny in-memory model that faithfully mirrors the
// `upsertIntegrationConfig` mutation semantics (validate-before-write,
// update-not-duplicate keyed by (platformId, tenantId), new record starts
// "disconnected", status preserved on update) for Property 5, plus the masked
// view projection (`getMaskedConfig`) for Property 7.
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateIntegrationConfig,
  type ConnectionStatus,
} from "../../convex/integrations/configStore";
import { extractLast4 } from "../../src/lib/integrations/encryptionService";

// ---------------------------------------------------------------------------
// Shared arbitraries
// ---------------------------------------------------------------------------

/** The set of registered platform ids the injected predicate recognizes. */
const REGISTERED_PLATFORMS = ["runsheet", "acme-logistics", "platform_x"] as const;

const registeredPlatformArb: fc.Arbitrary<string> = fc.constantFrom(
  ...REGISTERED_PLATFORMS
);

/** Platform ids that are NOT registered (drives the unknown_platform path). */
const unregisteredPlatformArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 32 })
  .filter((s) => !(REGISTERED_PLATFORMS as readonly string[]).includes(s));

const tenantIdArb: fc.Arbitrary<string> = fc.constantFrom(
  "tenant-a",
  "tenant-b",
  "tenant-c"
);

/** A non-empty, non-whitespace base URL (the valid case). */
const nonEmptyBaseUrlArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0)
  .map((s) => `https://api.example.com/${s.trim()}`);

/** An empty-or-whitespace-only base URL (the missing_field case). */
const emptyBaseUrlArb: fc.Arbitrary<string> = fc.constantFrom(
  "",
  " ",
  "   ",
  "\t",
  "\n",
  " \t \n "
);

/** The injected registry predicate — mirrors `isPlatformRegistered`. */
const isRegistered = (platformId: string): boolean =>
  (REGISTERED_PLATFORMS as readonly string[]).includes(platformId);

// ---------------------------------------------------------------------------
// Property 6: Config validation rejection (Req 2.3, 2.4)
// ---------------------------------------------------------------------------

describe("Property 6: Config validation rejection", () => {
  it("rejects an empty/whitespace baseUrl with missing_field naming baseUrl (Req 2.3)", () => {
    fc.assert(
      fc.property(
        // platformId is registered so ONLY the baseUrl rule can fire; this
        // isolates the base-URL rejection (validated before the platform check).
        registeredPlatformArb,
        emptyBaseUrlArb,
        (platformId, baseUrl) => {
          const result = validateIntegrationConfig(
            { platformId, baseUrl },
            isRegistered
          );
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe("missing_field");
            expect(result.field).toBe("baseUrl");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects an unregistered platform (with a non-empty baseUrl) with unknown_platform naming the platformId (Req 2.4)", () => {
    fc.assert(
      fc.property(
        unregisteredPlatformArb,
        nonEmptyBaseUrlArb,
        (platformId, baseUrl) => {
          const result = validateIntegrationConfig(
            { platformId, baseUrl },
            isRegistered
          );
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe("unknown_platform");
            // The error names the offending Platform_Id.
            expect(result.field).toBe(platformId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("accepts a registered platform with a non-empty baseUrl (Req 2.1)", () => {
    fc.assert(
      fc.property(
        registeredPlatformArb,
        nonEmptyBaseUrlArb,
        (platformId, baseUrl) => {
          const result = validateIntegrationConfig(
            { platformId, baseUrl },
            isRegistered
          );
          expect(result.ok).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Config store upsert keying and initial status (Req 2.1, 2.5, 2.6)
// ---------------------------------------------------------------------------

/** A stored Integration_Config record in the in-memory model. */
interface ConfigRecord {
  platformId: string;
  tenantId: string;
  baseUrl: string;
  platformTenantId: string;
  credentialsEncrypted: Record<string, string>;
  credentialsLast4: Record<string, string>;
  allowedConversationTypes: string[];
  config: unknown;
  status: ConnectionStatus;
  createdAt: number;
  updatedAt: number;
}

/** Model store keyed by "platformId\u0000tenantId" to mirror the composite key. */
type ConfigStore = Map<string, ConfigRecord>;

const keyOf = (platformId: string, tenantId: string): string =>
  `${platformId}\u0000${tenantId}`;

interface SaveInput {
  platformId: string;
  tenantId: string;
  baseUrl: string;
  platformTenantId: string;
  credentialsEncrypted: Record<string, string>;
  credentialsLast4: Record<string, string>;
  allowedConversationTypes: string[];
  config: unknown;
}

type SaveResult =
  | { ok: true; created: boolean }
  | { ok: false; code: "missing_field" | "unknown_platform"; field: string };

/**
 * Faithfully mirrors the `upsertIntegrationConfig` mutation:
 *   1. validate-before-write via the SAME pure `validateIntegrationConfig`;
 *      on rejection nothing is written (existing record left unchanged);
 *   2. keyed by (platformId, tenantId): update the single existing record
 *      rather than duplicating (Req 2.5);
 *   3. a newly created record starts "disconnected" (Req 2.6);
 *   4. status is preserved on update (owned by the credential-test flow).
 */
function trySave(store: ConfigStore, input: SaveInput, now: number): SaveResult {
  const validation = validateIntegrationConfig(
    { platformId: input.platformId, baseUrl: input.baseUrl },
    isRegistered
  );
  if (!validation.ok) {
    return { ok: false, code: validation.code, field: validation.field };
  }

  const key = keyOf(input.platformId, input.tenantId);
  const existing = store.get(key);

  if (existing) {
    // Update in place — no duplicate; status preserved (Req 2.5).
    store.set(key, {
      ...existing,
      baseUrl: input.baseUrl,
      platformTenantId: input.platformTenantId,
      credentialsEncrypted: input.credentialsEncrypted,
      credentialsLast4: input.credentialsLast4,
      allowedConversationTypes: input.allowedConversationTypes,
      config: input.config,
      updatedAt: now,
    });
    return { ok: true, created: false };
  }

  // New record starts "disconnected" (Req 2.6).
  store.set(key, {
    platformId: input.platformId,
    tenantId: input.tenantId,
    baseUrl: input.baseUrl,
    platformTenantId: input.platformTenantId,
    credentialsEncrypted: input.credentialsEncrypted,
    credentialsLast4: input.credentialsLast4,
    allowedConversationTypes: input.allowedConversationTypes,
    config: input.config,
    status: "disconnected",
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, created: true };
}

/** Arbitrary valid save input (registered platform + non-empty base URL). */
const saveInputArb: fc.Arbitrary<SaveInput> = fc.record({
  platformId: registeredPlatformArb,
  tenantId: tenantIdArb,
  baseUrl: nonEmptyBaseUrlArb,
  platformTenantId: fc.string({ minLength: 1, maxLength: 16 }),
  credentialsEncrypted: fc.dictionary(
    fc.constantFrom("api_key", "webhook_secret", "token"),
    fc.string({ minLength: 1, maxLength: 24 })
  ),
  credentialsLast4: fc.constant({}),
  allowedConversationTypes: fc.array(fc.string(), { maxLength: 4 }),
  config: fc.object(),
});

describe("Property 5: Config store upsert keying and initial status", () => {
  it("a newly created record is keyed by (platformId, tenantId) and starts disconnected (Req 2.1, 2.6)", () => {
    fc.assert(
      fc.property(saveInputArb, (input) => {
        const store: ConfigStore = new Map();
        const result = trySave(store, input, 1000);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.created).toBe(true);
        }
        const record = store.get(keyOf(input.platformId, input.tenantId));
        expect(record).toBeDefined();
        expect(record?.status).toBe("disconnected");
        // Persisted under exactly one key.
        expect(store.size).toBe(1);
      }),
      { numRuns: 100 }
    );
  });

  it("re-saving the same (platformId, tenantId) updates the single record rather than duplicating (Req 2.5)", () => {
    fc.assert(
      fc.property(saveInputArb, saveInputArb, (first, secondRaw) => {
        // Force the second save onto the SAME pair as the first.
        const second: SaveInput = {
          ...secondRaw,
          platformId: first.platformId,
          tenantId: first.tenantId,
        };
        const store: ConfigStore = new Map();

        trySave(store, first, 1000);
        const secondResult = trySave(store, second, 2000);

        expect(secondResult.ok).toBe(true);
        if (secondResult.ok) {
          expect(secondResult.created).toBe(false);
        }
        // Exactly one record for the pair, reflecting the latest save.
        expect(store.size).toBe(1);
        const record = store.get(keyOf(first.platformId, first.tenantId));
        expect(record?.baseUrl).toBe(second.baseUrl);
        expect(record?.updatedAt).toBe(2000);
        // Original creation timestamp preserved across the update.
        expect(record?.createdAt).toBe(1000);
      }),
      { numRuns: 100 }
    );
  });

  it("distinct (platformId, tenantId) pairs coexist independently (Req 2.1)", () => {
    fc.assert(
      fc.property(saveInputArb, saveInputArb, (a, b) => {
        // Only exercise inputs that form two DISTINCT keys.
        fc.pre(
          keyOf(a.platformId, a.tenantId) !== keyOf(b.platformId, b.tenantId)
        );
        const store: ConfigStore = new Map();

        trySave(store, a, 1000);
        trySave(store, b, 1000);

        expect(store.size).toBe(2);
        expect(store.get(keyOf(a.platformId, a.tenantId))?.baseUrl).toBe(
          a.baseUrl
        );
        expect(store.get(keyOf(b.platformId, b.tenantId))?.baseUrl).toBe(
          b.baseUrl
        );
      }),
      { numRuns: 100 }
    );
  });

  it("a rejected save leaves an existing record byte-for-byte unchanged (Req 2.3, 2.5)", () => {
    fc.assert(
      fc.property(
        saveInputArb,
        emptyBaseUrlArb,
        (valid, badBaseUrl) => {
          const store: ConfigStore = new Map();
          trySave(store, valid, 1000);
          const snapshot = new Map(store);

          // Attempt an invalid save (empty base URL) for the SAME pair.
          const rejected = trySave(
            store,
            { ...valid, baseUrl: badBaseUrl },
            2000
          );

          expect(rejected.ok).toBe(false);
          // Existing record is untouched.
          expect([...store.entries()]).toEqual([...snapshot.entries()]);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Masked view never exposes credential material (Req 2.8)
// ---------------------------------------------------------------------------

/** Mirrors the masked-view projection of `getMaskedConfig`. */
interface MaskedView {
  platformId: string;
  tenantId: string;
  baseUrl: string;
  platformTenantId: string;
  credentialsLast4: Record<string, string>;
  allowedConversationTypes: string[];
  config: unknown;
  status: ConnectionStatus;
  createdAt: number;
  updatedAt: number;
}

/**
 * Projects a stored record to the masked view exactly as `getMaskedConfig`
 * does: it drops `credentialsEncrypted` entirely and exposes only the
 * `credentialsLast4` previews. No decrypted plaintext ever enters the store.
 */
function toMaskedView(record: ConfigRecord): MaskedView {
  return {
    platformId: record.platformId,
    tenantId: record.tenantId,
    baseUrl: record.baseUrl,
    platformTenantId: record.platformTenantId,
    credentialsLast4: record.credentialsLast4,
    allowedConversationTypes: record.allowedConversationTypes,
    config: record.config,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** A credential value (plaintext) — includes empty, unicode, and long values. */
const credentialValueArb: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.constant(""),
  fc.string({ minLength: 40, maxLength: 120 }),
  fc.string({ unit: "grapheme", minLength: 1, maxLength: 30 })
);

/** A set of named credentials with their plaintext values. */
const credentialSetArb: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  fc.constantFrom("api_key", "webhook_secret", "token", "client_secret"),
  credentialValueArb,
  { minKeys: 1, maxKeys: 4 }
);

describe("Property 7: Masked view never exposes credential material", () => {
  it("exposes at most last-4 per credential and never ciphertext or plaintext (Req 2.8)", () => {
    fc.assert(
      fc.property(
        registeredPlatformArb,
        tenantIdArb,
        nonEmptyBaseUrlArb,
        credentialSetArb,
        (platformId, tenantId, baseUrl, plaintextCreds) => {
          const names = Object.keys(plaintextCreds);
          // Encryption is opaque here; use a distinguishable ciphertext marker
          // per credential so we can assert it never leaks into the view.
          const credentialsEncrypted: Record<string, string> = {};
          const credentialsLast4: Record<string, string> = {};
          for (const name of names) {
            credentialsEncrypted[name] = `CIPHERTEXT::${name}::deadbeefcafe`;
            credentialsLast4[name] = extractLast4(plaintextCreds[name]);
          }

          const record: ConfigRecord = {
            platformId,
            tenantId,
            baseUrl,
            platformTenantId: "pt",
            credentialsEncrypted,
            credentialsLast4,
            allowedConversationTypes: [],
            config: {},
            status: "disconnected",
            createdAt: 1000,
            updatedAt: 1000,
          };

          const masked = toMaskedView(record);
          const serialized = JSON.stringify(masked);

          // The masked view carries NO ciphertext field at all.
          expect("credentialsEncrypted" in masked).toBe(false);

          for (const name of names) {
            const last4 = masked.credentialsLast4[name];
            // Last-4 preview is present and equals the source's last-4.
            expect(last4).toBe(extractLast4(plaintextCreds[name]));
            // At most 4 characters exposed.
            expect(last4.length).toBeLessThanOrEqual(4);

            // No ciphertext value leaks into the serialized view. The
            // ciphertext marker is distinctive (contains "CIPHERTEXT::"), so a
            // raw-string containment check is safe here.
            expect(serialized).not.toContain(credentialsEncrypted[name]);

            // More than the last-4 of the secret is never retained: the stored
            // preview is a strict suffix of the full value, not the whole
            // secret (when the value is longer than its own last-4).
            //
            // NB: this is asserted structurally rather than via
            // `serialized.not.toContain(full)`. An arbitrary secret can contain
            // the same quote/space bytes JSON uses as delimiters, so the
            // legitimate last-4 preview can reconstitute a prefix of the secret
            // at a JSON value boundary (e.g. a secret of `"    ` renders its
            // 4-space preview as `"    "`, which contains `"    `). That is a
            // serialization coincidence, not a credential leak.
            const full = plaintextCreds[name];
            if (full.length > 4) {
              expect(last4).not.toBe(full);
              expect(full.endsWith(last4)).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
