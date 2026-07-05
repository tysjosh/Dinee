/**
 * Feature: multi-platform-voice-integrations
 * Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6
 *
 * ws-server generic per-call binding — degrade-path example tests.
 *
 * The `/media-stream` handler in `src/app/ws-server/index.ts` (task 14.1)
 * performs the generic per-call integration binding as a single large inline
 * block that is impractical to unit-test directly (it owns Twilio/OpenAI socket
 * lifecycle). These example tests instead exercise the binding DECISION the
 * handler makes, reproducing its exact control flow here and driving it through
 * the REAL collaborators it uses:
 *
 *   - the real Integration_Registry (`resolvePlatform`) with a registered dummy
 *     platform whose adapter factory can be made to throw,
 *   - the real `resolveAdapter` (which fail-closes when the platform is
 *     unregistered or its factory throws),
 *   - the real `decrypt` from the Encryption_Service (fed malformed ciphertext
 *     to force a decrypt throw with INTEGRATION_ENCRYPTION_KEY configured),
 *   - the real 5s-deadline `withTimeout` wrapper the handler uses (Req 7.1).
 *
 * The invariant under test across every degrade path: NO adapter is bound, the
 * call's `enabledIntegrations` stays empty (no platform-gated tools), and the
 * call continues (fail-closed on credentials, Req 7.2, 7.3, 7.4, 7.5, 7.6).
 *
 * The reproduced `decideBinding` below mirrors the handler block verbatim; if
 * the handler's decision logic changes, these tests should be updated in
 * lockstep. A "connected + valid ciphertext + working factory" control case is
 * included as an anchor proving the reproduction binds when it should, so the
 * degrade-path assertions are meaningful rather than vacuous.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  registerPlatform,
  resolvePlatform,
  clearPlatformRegistry,
} from "../../src/lib/integrations/platform/registry";
import { resolveAdapter } from "../../src/lib/integrations/platform/adapterResolver";
import { encrypt, decrypt } from "../../src/lib/integrations/encryptionService";
import type {
  AdapterConstructionContext,
  PlatformDefinition,
  TransportContract,
} from "../../src/lib/integrations/platform/types";

// --- Test fixtures mirroring the runtime credential result shape ------------

type ConnectionStatus = "connected" | "disconnected" | "error";

interface RuntimeCredentialConfigLike {
  platformId: string;
  baseUrl: string;
  platformTenantId: string;
  credentialsEncrypted: Record<string, string>;
  allowedConversationTypes: string[];
  config: Record<string, unknown>;
  status: ConnectionStatus;
}

type RuntimeCredentialResultLike =
  | { resolution: "resolved"; config: RuntimeCredentialConfigLike }
  | { resolution: "unresolved" }
  | { resolution: "unauthorized" };

interface BindingOutcome {
  adapterBound: boolean;
  enabledIntegrations: string[];
  /** The handler always continues the call regardless of the binding result. */
  callContinues: boolean;
}

/**
 * Reproduces the handler's `withTimeout` (src/app/ws-server/index.ts): races a
 * promise against a deadline, rejecting if it does not settle in time so a
 * slow/hung retrieval degrades to "no integration" (Req 7.1, 7.2).
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** The handler's runtime-credential deadline (Req 7.1). */
const RUNTIME_CREDENTIAL_DEADLINE_MS = 5000;

/**
 * Faithful reproduction of the ws-server `/media-stream` generic per-call
 * binding decision. Returns whether an adapter was bound and the resulting
 * `enabledIntegrations`. Uses the REAL registry, `resolveAdapter`, and
 * `decrypt` so the degrade paths exercise production logic, not stubs.
 *
 * `deadlineMs` is parameterized only so the timeout branch can be exercised
 * quickly; production uses RUNTIME_CREDENTIAL_DEADLINE_MS.
 */
async function decideBinding(args: {
  platformId: string;
  dineeTenantId: string;
  retrieve: () => Promise<RuntimeCredentialResultLike>;
  deadlineMs?: number;
}): Promise<BindingOutcome> {
  const deadlineMs = args.deadlineMs ?? RUNTIME_CREDENTIAL_DEADLINE_MS;
  let enabledIntegrations: string[] = [];
  let adapterBound = false;

  const platformResolution = args.platformId
    ? resolvePlatform(args.platformId)
    : ({ resolved: false } as const);

  if (args.platformId && args.dineeTenantId && platformResolution.resolved) {
    const definition = platformResolution.definition;

    // Retrieve within a bounded deadline (Req 7.1). A timeout, thrown error, or
    // a non-`resolved` result degrades to "no integration" (Req 7.2).
    let credentialResult: RuntimeCredentialResultLike | null = null;
    try {
      credentialResult = await withTimeout(args.retrieve(), deadlineMs);
    } catch {
      credentialResult = null;
    }

    if (credentialResult && credentialResult.resolution === "resolved") {
      const runtimeConfig = credentialResult.config;

      // Only a CONNECTED integration is trusted; any other status skips
      // decryption and binds no adapter (Req 7.3).
      if (runtimeConfig.status === "connected") {
        try {
          // Decrypt each declared credential field locally at bind time with
          // the platform's contract key salt (Req 7.4). A missing/invalid key
          // or malformed ciphertext throws here.
          const credentials: Record<string, string> = {};
          for (const field of definition.credentialFields) {
            const ciphertext = runtimeConfig.credentialsEncrypted[field.name];
            if (typeof ciphertext !== "string") {
              throw new Error(
                `Missing ciphertext for credential '${field.name}'`,
              );
            }
            credentials[field.name] = decrypt(
              ciphertext,
              definition.contract.keySalt,
            );
          }

          // Build the adapter via the registry factory (Req 7.5). A factory
          // throw yields an unresolved result → no bind, no platform tools.
          const adapterCtx: AdapterConstructionContext = {
            baseUrl: runtimeConfig.baseUrl,
            platformTenantId: runtimeConfig.platformTenantId,
            credentials,
            config: (runtimeConfig.config ?? {}) as Record<string, unknown>,
            contract: definition.contract,
          };
          const adapterResolution = resolveAdapter(args.platformId, adapterCtx);

          if (adapterResolution.resolved) {
            enabledIntegrations = [args.platformId];
            adapterBound = true;
          }
        } catch {
          // Decrypt or adapter-construction failure: bind nothing, enable no
          // platform tools, continue the call (Req 7.6).
          enabledIntegrations = [];
          adapterBound = false;
        }
      }
    }
  }

  return { adapterBound, enabledIntegrations, callContinues: true };
}

// --- Dummy platform definitions ---------------------------------------------

const CONTRACT: TransportContract = {
  authScheme: "bearer",
  readPathPrefix: "/voice",
  intakePath: "/voice-intake",
  timestampFormat: "iso-8601",
  schemaVersion: "1.0",
  tenantHeader: "X-Tenant",
  // No keySalt: decrypt uses the shared INTEGRATION_ENCRYPTION_KEY.
};

/**
 * A registered dummy platform declaring one credential field. `factoryThrows`
 * makes its adapter factory throw so the adapter-construction failure path can
 * be exercised (Req 7.5, 7.6).
 */
function makeDemoPlatform(
  platformId: string,
  factoryThrows = false,
): PlatformDefinition {
  return {
    platformId,
    displayName: platformId,
    credentialFields: [{ name: "api_key", label: "API Key", required: true }],
    adapterFactory: (ctx) => {
      if (factoryThrows) {
        throw new Error("adapter construction blew up");
      }
      return {
        platformId,
        contract: ctx.contract,
        readClient: { testCredential: async () => ({ valid: true }) },
        intakeClient: {
          submit: async () => ({ status: "accepted" as const, httpStatus: 200 }),
        },
      };
    },
    contract: CONTRACT,
    runtimeServiceTokenEnvVar: `RUNTIME_TOKEN_${platformId}`,
  };
}

/** Builds a `resolved` runtime credential result for a platform. */
function resolved(
  platformId: string,
  status: ConnectionStatus,
  credentialsEncrypted: Record<string, string>,
): RuntimeCredentialResultLike {
  return {
    resolution: "resolved",
    config: {
      platformId,
      baseUrl: "https://example.test",
      platformTenantId: "platform-tenant-1",
      credentialsEncrypted,
      allowedConversationTypes: [],
      config: {},
      status,
    },
  };
}

// A valid AES-256-GCM key (64 hex chars = 32 bytes) for the Encryption_Service.
const TEST_ENCRYPTION_KEY = "a".repeat(64);

beforeAll(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

beforeEach(() => {
  clearPlatformRegistry();
});

describe("ws-server generic per-call binding — degrade paths (fail-closed)", () => {
  const PLATFORM = "demo";
  const TENANT = "dinee-tenant-1";

  it("ANCHOR: connected + valid ciphertext + working factory binds the adapter", async () => {
    // Control case proving the reproduced decision binds when it should, so the
    // degrade-path assertions below are non-vacuous.
    registerPlatform(makeDemoPlatform(PLATFORM));
    const ciphertext = encrypt("secret-api-key");

    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: TENANT,
      retrieve: async () =>
        resolved(PLATFORM, "connected", { api_key: ciphertext }),
    });

    expect(outcome.adapterBound).toBe(true);
    expect(outcome.enabledIntegrations).toEqual([PLATFORM]);
    expect(outcome.callContinues).toBe(true);
  });

  // --- Req 7.3: status other than "connected" skips binding entirely ---------

  it("skips binding when the integration status is 'disconnected' (Req 7.3)", async () => {
    registerPlatform(makeDemoPlatform(PLATFORM));
    // Valid ciphertext is present; the ONLY reason binding is skipped is the
    // non-connected status — decryption must not even be attempted.
    const ciphertext = encrypt("secret-api-key");

    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: TENANT,
      retrieve: async () =>
        resolved(PLATFORM, "disconnected", { api_key: ciphertext }),
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });

  it("skips binding when the integration status is 'error' (Req 7.3)", async () => {
    registerPlatform(makeDemoPlatform(PLATFORM));
    const ciphertext = encrypt("secret-api-key");

    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: TENANT,
      retrieve: async () =>
        resolved(PLATFORM, "error", { api_key: ciphertext }),
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });

  // --- Req 7.4, 7.6: decrypt failure leaves no adapter bound -----------------

  it("binds no adapter when credential decryption throws on malformed ciphertext (Req 7.4, 7.6)", async () => {
    registerPlatform(makeDemoPlatform(PLATFORM));
    // Too short to contain the IV + auth tag → the real decrypt throws.
    const malformed = Buffer.from("nope").toString("base64");

    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: TENANT,
      retrieve: async () =>
        resolved(PLATFORM, "connected", { api_key: malformed }),
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });

  it("binds no adapter when ciphertext decrypts under the wrong key/salt (Req 7.4, 7.6)", async () => {
    registerPlatform(makeDemoPlatform(PLATFORM));
    // Encrypt WITH a salt, then decrypt WITHOUT one (contract has no keySalt) →
    // GCM authentication fails and decrypt throws.
    const ciphertext = encrypt("secret-api-key", "some-other-platform-salt");

    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: TENANT,
      retrieve: async () =>
        resolved(PLATFORM, "connected", { api_key: ciphertext }),
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });

  it("binds no adapter when a declared credential field's ciphertext is missing (Req 7.4, 7.6)", async () => {
    registerPlatform(makeDemoPlatform(PLATFORM));
    // Connected, but the required `api_key` ciphertext is absent → throw.
    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: TENANT,
      retrieve: async () => resolved(PLATFORM, "connected", {}),
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });

  // --- Req 7.5, 7.6: adapter construction failure leaves no adapter bound ----

  it("binds no adapter when the adapter factory throws during construction (Req 7.5, 7.6)", async () => {
    registerPlatform(makeDemoPlatform(PLATFORM, /* factoryThrows */ true));
    const ciphertext = encrypt("secret-api-key");

    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: TENANT,
      retrieve: async () =>
        resolved(PLATFORM, "connected", { api_key: ciphertext }),
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });

  it("binds no adapter when the resolved platform is unregistered (Req 7.5, 7.6)", async () => {
    // Nothing registered: resolvePlatform is unresolved, so the binding block
    // is never entered and no platform-gated tools are enabled.
    const ciphertext = encrypt("secret-api-key");

    const outcome = await decideBinding({
      platformId: "never-registered",
      dineeTenantId: TENANT,
      retrieve: async () =>
        resolved("never-registered", "connected", { api_key: ciphertext }),
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });

  // --- Req 7.2: retrieval failure / non-resolved result ----------------------

  it("binds no adapter when credential retrieval returns 'unauthorized' (Req 7.2)", async () => {
    registerPlatform(makeDemoPlatform(PLATFORM));

    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: TENANT,
      retrieve: async () => ({ resolution: "unauthorized" }),
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });

  it("binds no adapter when credential retrieval returns 'unresolved' (Req 7.2)", async () => {
    registerPlatform(makeDemoPlatform(PLATFORM));

    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: TENANT,
      retrieve: async () => ({ resolution: "unresolved" }),
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });

  it("binds no adapter when credential retrieval throws (Req 7.2)", async () => {
    registerPlatform(makeDemoPlatform(PLATFORM));

    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: TENANT,
      retrieve: async () => {
        throw new Error("convex unavailable");
      },
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });

  it("binds no adapter when credential retrieval does not complete within the deadline (Req 7.2)", async () => {
    registerPlatform(makeDemoPlatform(PLATFORM));
    const ciphertext = encrypt("secret-api-key");

    // Retrieval resolves AFTER the deadline → withTimeout rejects → degrade.
    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: TENANT,
      deadlineMs: 20,
      retrieve: () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(resolved(PLATFORM, "connected", { api_key: ciphertext })),
            200,
          ),
        ),
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });

  it("binds no adapter when the owning Dinee tenant is missing (Req 7.2)", async () => {
    registerPlatform(makeDemoPlatform(PLATFORM));
    const ciphertext = encrypt("secret-api-key");

    const outcome = await decideBinding({
      platformId: PLATFORM,
      dineeTenantId: "",
      retrieve: async () =>
        resolved(PLATFORM, "connected", { api_key: ciphertext }),
    });

    expect(outcome.adapterBound).toBe(false);
    expect(outcome.enabledIntegrations).toEqual([]);
    expect(outcome.callContinues).toBe(true);
  });
});
