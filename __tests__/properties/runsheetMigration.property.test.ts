// Feature: multi-platform-voice-integrations, Property 17: Migration copy fidelity and ciphertext-preservation round-trip — for any set of existing Runsheet integration rows and number assignments, running the Migration_Service produces exactly one generic Integration_Config per row keyed by (runsheet, tenantId) whose baseUrl, ciphertext, config, and status equal the original (ciphertext byte-for-byte, never re-encrypted) and exactly one phoneRoute per assignment with platformId "runsheet"; consequently, decrypting a migrated config's credentials yields the same credential values as the pre-migration record. The migration is idempotent (re-running skips already-migrated pairs, no duplicates).
// Feature: multi-platform-voice-integrations, Property 18: Migration failure isolation — for any record the Migration_Service cannot migrate, the original Runsheet record is left unchanged and the failing record identifier appears in the migration report, while other records still migrate.
//
// Property 17 — Validates: Requirements 10.2, 10.3, 10.4, 10.5
// Property 18 — Validates: Requirements 10.6
//
// Req 10.2: Copy each runsheetIntegrations row into an `integrations` row keyed
// by (runsheet, tenantId), skipping (never duplicating) an already-migrated
// pair.
// Req 10.3: Preserve baseUrl, the credential CIPHERTEXT (byte-for-byte, never
// re-encrypted), the config blob, and the connection status.
// Req 10.4: Copy each runsheetNumberAssignments row into a `phoneRoutes` row
// with platformId "runsheet".
// Req 10.5: The migration is idempotent — a re-run over an already-migrated
// dataset performs no new writes and no duplication.
// Req 10.6: On a per-record failure, the original Runsheet row is left
// unchanged and the failing id is recorded in the report; other records still
// migrate.
//
// The Migration_Service (`migrateRunsheetToGeneric` in
// convex/integrations/migrateRunsheet.ts) is a Convex internalMutation that
// needs a DB, so — mirroring the prevailing repo convention (see
// phoneRoute.property.test.ts / integrationConfigStore.property.test.ts) —
// this suite drives a tiny in-memory model that faithfully mirrors the
// mutation's copy logic: idempotent skip-if-exists keyed by (runsheet,
// tenantId) / by phoneNumber, ciphertext copied byte-for-byte into
// credentialsEncrypted { api_key, webhook_secret }, baseUrl/config/status
// preserved, number assignments → phoneRoutes with platformId "runsheet", and
// per-record try/catch failure isolation producing a MigrationReport.
//
// For the ciphertext round-trip (Property 17) the model uses the REAL
// encrypt/decrypt from src/lib/integrations/encryptionService.ts: source
// ciphertext is produced by encrypting arbitrary plaintexts, the model
// migration copies that ciphertext (never re-encrypting), and decrypting the
// migrated ciphertext must yield the original plaintext — proving byte-for-byte
// preservation.
import { describe, it, expect, beforeAll } from "vitest";
import * as fc from "fast-check";
import { encrypt, decrypt } from "../../src/lib/integrations/encryptionService";
import type {
  MigrationReport,
  MigrationFailure,
} from "../../convex/integrations/migrateRunsheet";

const RUNSHEET_PLATFORM_ID = "runsheet";

beforeAll(() => {
  // A valid 32-byte (64-hex-char) key so the AES-256-GCM service works in the
  // test environment, mirroring how the other encryption property tests
  // provision it. Runsheet registers with NO keySalt, so the shared key is
  // used for both the source encryption and the post-migration decryption.
  process.env.INTEGRATION_ENCRYPTION_KEY = "0".repeat(64);
});

// ---------------------------------------------------------------------------
// In-memory model of the source + target tables and the migration copy logic
// ---------------------------------------------------------------------------

type ReviewMode = "always_review" | "auto_submit_low_risk";
type ConnectionStatus = "connected" | "disconnected" | "error";

/** Mirrors a `runsheetIntegrations` row (the migration source). */
interface RunsheetIntegrationRow {
  _id: string;
  tenantId: string;
  baseUrl: string;
  runsheetTenantId: string;
  apiKeyEncrypted: string;
  apiKeyLast4: string;
  webhookSecretEncrypted: string;
  defaultReviewMode: ReviewMode;
  allowedConversationTypes: string[];
  autoSubmitEnabled: boolean;
  confidenceThreshold?: number;
  requiresPurchaseOrder?: boolean;
  escalationTarget?: { kind: "phone" | "email" | "webhook"; value: string };
  status: ConnectionStatus;
}

/** Mirrors a `runsheetNumberAssignments` row (the migration source). */
interface RunsheetNumberAssignmentRow {
  _id: string;
  tenantId: string;
  phoneNumber: string;
  conversationType: string;
}

/** Mirrors a migrated `integrations` row (the target). */
interface IntegrationRow {
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

/** Mirrors a migrated `phoneRoutes` row (the target). */
interface PhoneRouteRow {
  phoneNumber: string;
  platformId: string;
  tenantId: string;
  conversationType: string;
  createdAt: number;
}

const integrationKey = (platformId: string, tenantId: string): string =>
  `${platformId}\u0000${tenantId}`;

/**
 * Faithfully mirrors `migrateRunsheetToGeneric`:
 *   - runsheetIntegrations → integrations keyed by ("runsheet", tenantId),
 *     skip-if-exists (idempotent), ciphertext copied byte-for-byte into
 *     credentialsEncrypted { api_key, webhook_secret }, baseUrl/config/status
 *     preserved, runsheetTenantId → platformTenantId, apiKeyLast4 preserved;
 *   - runsheetNumberAssignments → phoneRoutes with platformId "runsheet",
 *     skip-if-exists by phoneNumber;
 *   - per-record try/catch failure isolation: a thrown insert leaves the
 *     target untouched for that record, records the failing id, and continues.
 *
 * `failIntegrationId` optionally forces the target-insert of one crafted
 * runsheetIntegrations record to throw (for Property 18).
 */
function runMigration(
  source: {
    runsheetIntegrations: RunsheetIntegrationRow[];
    runsheetNumberAssignments: RunsheetNumberAssignmentRow[];
  },
  target: {
    integrations: Map<string, IntegrationRow>;
    phoneRoutes: Map<string, PhoneRouteRow>;
  },
  now: number,
  failIntegrationId?: string
): MigrationReport {
  const failures: MigrationFailure[] = [];
  let integrationsCopied = 0;
  let routesCopied = 0;

  // 1. runsheetIntegrations → integrations keyed by ("runsheet", tenantId)
  for (const row of source.runsheetIntegrations) {
    try {
      const key = integrationKey(RUNSHEET_PLATFORM_ID, row.tenantId);
      // Idempotence: skip an already-migrated pair (Req 10.2, 10.5).
      if (target.integrations.has(key)) {
        continue;
      }

      // Injected per-record target-insert failure (Req 10.6). Thrown AFTER the
      // existence check and BEFORE any write, exactly like a failing insert.
      if (failIntegrationId !== undefined && row._id === failIntegrationId) {
        throw new Error(`simulated insert failure for ${row._id}`);
      }

      // Insert preserving ciphertext BYTE-FOR-BYTE — never re-encrypted
      // (Req 10.3, 10.5).
      target.integrations.set(key, {
        platformId: RUNSHEET_PLATFORM_ID,
        tenantId: row.tenantId,
        baseUrl: row.baseUrl,
        platformTenantId: row.runsheetTenantId,
        credentialsEncrypted: {
          api_key: row.apiKeyEncrypted,
          webhook_secret: row.webhookSecretEncrypted,
        },
        credentialsLast4: {
          api_key: row.apiKeyLast4,
        },
        allowedConversationTypes: row.allowedConversationTypes,
        config: {
          defaultReviewMode: row.defaultReviewMode,
          autoSubmitEnabled: row.autoSubmitEnabled,
          confidenceThreshold: row.confidenceThreshold,
          requiresPurchaseOrder: row.requiresPurchaseOrder,
          escalationTarget: row.escalationTarget,
        },
        status: row.status,
        createdAt: now,
        updatedAt: now,
      });

      integrationsCopied += 1;
    } catch (error) {
      failures.push({
        table: "runsheetIntegrations",
        id: row._id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 2. runsheetNumberAssignments → phoneRoutes with platformId "runsheet"
  for (const row of source.runsheetNumberAssignments) {
    try {
      // Idempotence: a phone number resolves to exactly one route (Req 10.4).
      if (target.phoneRoutes.has(row.phoneNumber)) {
        continue;
      }

      target.phoneRoutes.set(row.phoneNumber, {
        phoneNumber: row.phoneNumber,
        platformId: RUNSHEET_PLATFORM_ID,
        tenantId: row.tenantId,
        conversationType: row.conversationType,
        createdAt: now,
      });

      routesCopied += 1;
    } catch (error) {
      failures.push({
        table: "runsheetNumberAssignments",
        id: row._id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    integrationsCopied,
    routesCopied,
    failures,
    idempotentNoop:
      integrationsCopied === 0 && routesCopied === 0 && failures.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Arbitraries — plaintext credentials are generated (not the ciphertext), so
// encryption stays out of the generators; ciphertext is produced in-body via
// the real encrypt().
// ---------------------------------------------------------------------------

const reviewModeArb: fc.Arbitrary<ReviewMode> = fc.constantFrom(
  "always_review",
  "auto_submit_low_risk"
);

const statusArb: fc.Arbitrary<ConnectionStatus> = fc.constantFrom(
  "connected",
  "disconnected",
  "error"
);

/** Credential plaintext across the input space: realistic, empty, unicode, long. */
const credentialPlaintextArb: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.constantFrom("", "🔑", "clé 密钥 🔐", "sk-test-a1b2c3d4"),
  fc.string({ minLength: 100, maxLength: 400 })
);

/** A spec describing one Runsheet integration to migrate (plaintext creds). */
interface IntegrationSpec {
  tenantId: string;
  baseUrl: string;
  runsheetTenantId: string;
  apiKeyPlaintext: string;
  webhookSecretPlaintext: string;
  apiKeyLast4: string;
  defaultReviewMode: ReviewMode;
  allowedConversationTypes: string[];
  autoSubmitEnabled: boolean;
  status: ConnectionStatus;
}

const integrationSpecArb: fc.Arbitrary<IntegrationSpec> = fc.record({
  tenantId: fc.string({ minLength: 1, maxLength: 12 }),
  baseUrl: fc
    .string({ minLength: 1, maxLength: 20 })
    .map((s) => `https://api.example.com/${encodeURIComponent(s)}`),
  runsheetTenantId: fc.string({ minLength: 1, maxLength: 12 }),
  apiKeyPlaintext: credentialPlaintextArb,
  webhookSecretPlaintext: credentialPlaintextArb,
  apiKeyLast4: fc.string({ minLength: 0, maxLength: 4 }),
  defaultReviewMode: reviewModeArb,
  allowedConversationTypes: fc.array(
    fc.constantFrom(
      "runsheet_fuel_order_intake",
      "runsheet_order_status",
      "runsheet_driver_exception"
    ),
    { maxLength: 3 }
  ),
  autoSubmitEnabled: fc.boolean(),
  status: statusArb,
});

/** Unique-by-tenantId integration specs so every row migrates one-to-one. */
const integrationSpecsArb: fc.Arbitrary<IntegrationSpec[]> = fc.uniqueArray(
  integrationSpecArb,
  { selector: (s) => s.tenantId, minLength: 1, maxLength: 6 }
);

interface AssignmentSpec {
  tenantId: string;
  phoneNumber: string;
  conversationType: string;
}

const assignmentSpecArb: fc.Arbitrary<AssignmentSpec> = fc.record({
  tenantId: fc.string({ minLength: 1, maxLength: 12 }),
  phoneNumber: fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: 10, maxLength: 11 })
    .map((d) => `+1${d.join("")}`),
  conversationType: fc.constantFrom(
    "runsheet_fuel_order_intake",
    "runsheet_order_status",
    "runsheet_driver_exception"
  ),
});

/** Unique-by-phoneNumber assignment specs so every one migrates one-to-one. */
const assignmentSpecsArb: fc.Arbitrary<AssignmentSpec[]> = fc.uniqueArray(
  assignmentSpecArb,
  { selector: (s) => s.phoneNumber, minLength: 0, maxLength: 6 }
);

/** Builds source rows from specs, encrypting the credential plaintext for real. */
function buildSource(
  integrationSpecs: IntegrationSpec[],
  assignmentSpecs: AssignmentSpec[]
): {
  runsheetIntegrations: RunsheetIntegrationRow[];
  runsheetNumberAssignments: RunsheetNumberAssignmentRow[];
  plaintextById: Map<string, { apiKey: string; webhookSecret: string }>;
} {
  const plaintextById = new Map<
    string,
    { apiKey: string; webhookSecret: string }
  >();

  const runsheetIntegrations = integrationSpecs.map((spec, i) => {
    const _id = `int_${i}`;
    plaintextById.set(_id, {
      apiKey: spec.apiKeyPlaintext,
      webhookSecret: spec.webhookSecretPlaintext,
    });
    return {
      _id,
      tenantId: spec.tenantId,
      baseUrl: spec.baseUrl,
      runsheetTenantId: spec.runsheetTenantId,
      // Real AES-256-GCM ciphertext (no salt — Runsheet has no keySalt).
      apiKeyEncrypted: encrypt(spec.apiKeyPlaintext),
      apiKeyLast4: spec.apiKeyLast4,
      webhookSecretEncrypted: encrypt(spec.webhookSecretPlaintext),
      defaultReviewMode: spec.defaultReviewMode,
      allowedConversationTypes: spec.allowedConversationTypes,
      autoSubmitEnabled: spec.autoSubmitEnabled,
      status: spec.status,
    } satisfies RunsheetIntegrationRow;
  });

  const runsheetNumberAssignments = assignmentSpecs.map((spec, i) => ({
    _id: `asn_${i}`,
    tenantId: spec.tenantId,
    phoneNumber: spec.phoneNumber,
    conversationType: spec.conversationType,
  }));

  return { runsheetIntegrations, runsheetNumberAssignments, plaintextById };
}

// ---------------------------------------------------------------------------
// Property 17: Migration copy fidelity and ciphertext-preservation round-trip
// ---------------------------------------------------------------------------

describe("Property 17: Migration copy fidelity and ciphertext-preservation round-trip", () => {
  it("copies each row 1:1 preserving baseUrl/config/status + ciphertext byte-for-byte, decrypts to the same plaintext, and routes assignments (Req 10.2, 10.3, 10.4)", () => {
    fc.assert(
      fc.property(
        integrationSpecsArb,
        assignmentSpecsArb,
        (integrationSpecs, assignmentSpecs) => {
          const source = buildSource(integrationSpecs, assignmentSpecs);
          const target = {
            integrations: new Map<string, IntegrationRow>(),
            phoneRoutes: new Map<string, PhoneRouteRow>(),
          };

          const report = runMigration(source, target, 1000);

          // Exactly one target row per source row, no failures.
          expect(report.failures).toEqual([]);
          expect(report.integrationsCopied).toBe(
            source.runsheetIntegrations.length
          );
          expect(report.routesCopied).toBe(
            source.runsheetNumberAssignments.length
          );
          expect(target.integrations.size).toBe(
            source.runsheetIntegrations.length
          );
          expect(target.phoneRoutes.size).toBe(
            source.runsheetNumberAssignments.length
          );

          // Fidelity + ciphertext round-trip for each integration.
          for (const row of source.runsheetIntegrations) {
            const migrated = target.integrations.get(
              integrationKey(RUNSHEET_PLATFORM_ID, row.tenantId)
            );
            expect(migrated).toBeDefined();
            if (!migrated) return;

            expect(migrated.platformId).toBe(RUNSHEET_PLATFORM_ID);
            expect(migrated.tenantId).toBe(row.tenantId);
            expect(migrated.baseUrl).toBe(row.baseUrl);
            expect(migrated.platformTenantId).toBe(row.runsheetTenantId);
            expect(migrated.status).toBe(row.status);
            expect(migrated.credentialsLast4.api_key).toBe(row.apiKeyLast4);
            expect(migrated.config).toEqual({
              defaultReviewMode: row.defaultReviewMode,
              autoSubmitEnabled: row.autoSubmitEnabled,
              confidenceThreshold: row.confidenceThreshold,
              requiresPurchaseOrder: row.requiresPurchaseOrder,
              escalationTarget: row.escalationTarget,
            });

            // Ciphertext preserved BYTE-FOR-BYTE (never re-encrypted).
            expect(migrated.credentialsEncrypted.api_key).toBe(
              row.apiKeyEncrypted
            );
            expect(migrated.credentialsEncrypted.webhook_secret).toBe(
              row.webhookSecretEncrypted
            );

            // Round-trip: decrypting the migrated ciphertext yields the same
            // plaintext as before migration.
            const original = source.plaintextById.get(row._id)!;
            expect(decrypt(migrated.credentialsEncrypted.api_key)).toBe(
              original.apiKey
            );
            expect(
              decrypt(migrated.credentialsEncrypted.webhook_secret)
            ).toBe(original.webhookSecret);
          }

          // Each assignment becomes a phoneRoute with platformId "runsheet".
          for (const row of source.runsheetNumberAssignments) {
            const route = target.phoneRoutes.get(row.phoneNumber);
            expect(route).toBeDefined();
            expect(route?.platformId).toBe(RUNSHEET_PLATFORM_ID);
            expect(route?.tenantId).toBe(row.tenantId);
            expect(route?.conversationType).toBe(row.conversationType);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("is idempotent: re-running over an already-migrated dataset writes nothing and creates no duplicates (Req 10.5)", () => {
    fc.assert(
      fc.property(
        integrationSpecsArb,
        assignmentSpecsArb,
        (integrationSpecs, assignmentSpecs) => {
          const source = buildSource(integrationSpecs, assignmentSpecs);
          const target = {
            integrations: new Map<string, IntegrationRow>(),
            phoneRoutes: new Map<string, PhoneRouteRow>(),
          };

          runMigration(source, target, 1000);
          const sizeAfterFirst = {
            integrations: target.integrations.size,
            phoneRoutes: target.phoneRoutes.size,
          };
          const snapshotIntegrations = new Map(target.integrations);
          const snapshotRoutes = new Map(target.phoneRoutes);

          // Second run over the same (already migrated) dataset.
          const second = runMigration(source, target, 2000);

          expect(second.integrationsCopied).toBe(0);
          expect(second.routesCopied).toBe(0);
          expect(second.failures).toEqual([]);
          expect(second.idempotentNoop).toBe(true);

          // No duplication — sizes and contents unchanged.
          expect(target.integrations.size).toBe(sizeAfterFirst.integrations);
          expect(target.phoneRoutes.size).toBe(sizeAfterFirst.phoneRoutes);
          expect([...target.integrations.entries()]).toEqual([
            ...snapshotIntegrations.entries(),
          ]);
          expect([...target.phoneRoutes.entries()]).toEqual([
            ...snapshotRoutes.entries(),
          ]);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 18: Migration failure isolation
// ---------------------------------------------------------------------------

describe("Property 18: Migration failure isolation", () => {
  it("a per-record failure leaves the original row unchanged and records the failing id, while other records still migrate (Req 10.6)", () => {
    fc.assert(
      fc.property(
        // At least two integration rows so we can fail one and still migrate others.
        fc.uniqueArray(integrationSpecArb, {
          selector: (s) => s.tenantId,
          minLength: 2,
          maxLength: 6,
        }),
        assignmentSpecsArb,
        fc.nat(),
        (integrationSpecs, assignmentSpecs, pick) => {
          const source = buildSource(integrationSpecs, assignmentSpecs);
          const target = {
            integrations: new Map<string, IntegrationRow>(),
            phoneRoutes: new Map<string, PhoneRouteRow>(),
          };

          // Choose one crafted record whose target-insert will throw.
          const failIdx = pick % source.runsheetIntegrations.length;
          const failing = source.runsheetIntegrations[failIdx];

          // Snapshot the source so we can prove the original row is untouched.
          const sourceSnapshot = JSON.stringify(source.runsheetIntegrations);

          const report = runMigration(source, target, 1000, failing._id);

          // The failing record's id + table appear in the report.
          const reported = report.failures.find((f) => f.id === failing._id);
          expect(reported).toBeDefined();
          expect(reported?.table).toBe("runsheetIntegrations");
          expect(report.failures.length).toBe(1);
          expect(report.idempotentNoop).toBe(false);

          // The original Runsheet source row is left byte-for-byte unchanged.
          expect(JSON.stringify(source.runsheetIntegrations)).toBe(
            sourceSnapshot
          );

          // The failing record was NOT written to the target.
          expect(
            target.integrations.has(
              integrationKey(RUNSHEET_PLATFORM_ID, failing.tenantId)
            )
          ).toBe(false);

          // Every OTHER integration still migrated.
          expect(report.integrationsCopied).toBe(
            source.runsheetIntegrations.length - 1
          );
          for (const row of source.runsheetIntegrations) {
            if (row._id === failing._id) continue;
            expect(
              target.integrations.has(
                integrationKey(RUNSHEET_PLATFORM_ID, row.tenantId)
              )
            ).toBe(true);
          }

          // Number assignments are independent and all still migrate.
          expect(report.routesCopied).toBe(
            source.runsheetNumberAssignments.length
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
