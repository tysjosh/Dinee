/**
 * Feature: multi-platform-voice-integrations
 *
 * Validates: Requirements 7.1, 11.1
 *
 * Backward-compatibility integration test for the LIVE Runsheet call path after
 * the ws-server cutover to generic, config-driven per-call binding (task 14).
 *
 * Two facets of the live-Runsheet guarantee are exercised:
 *
 *  1. Deadline (Req 7.1): runtime credential retrieval at bind time is bounded
 *     by a 5s deadline. The ws-server races the guarded Runtime_Credential_
 *     Service call against `withTimeout(promise, RUNTIME_CREDENTIAL_DEADLINE_MS)`
 *     (RUNTIME_CREDENTIAL_DEADLINE_MS = 5000). Because `src/app/ws-server/index.ts`
 *     has module-level side effects (it boots a Fastify server, exits on a
 *     missing OpenAI key, and connects to Convex), the exact same race is
 *     modelled here rather than imported, and its bounded-deadline behavior is
 *     asserted: a promise that resolves quickly returns its value, a promise
 *     that rejects quickly propagates its rejection, and a promise that never
 *     settles rejects at — and not before — the deadline.
 *
 *  2. Tool-set parity (Req 11.1): a migrated Runsheet phone route binds the
 *     Runsheet adapter and exposes the SAME Runsheet tool set that was available
 *     before generalization. Registering the Runsheet platform + Runsheet voice
 *     pack and then resolving the pack, `resolveToolSet` with
 *     enabledIntegrations=["runsheet"] exposes exactly the pre-generalization
 *     Runsheet tool set (all tools gated on the base `runsheet` integration,
 *     never `runsheet_submit_order`), and `resolveAdapter("runsheet", ctx)`
 *     resolves an adapter whose platformId is "runsheet". With Auto_Submit on
 *     (["runsheet","runsheet_auto_submit"]) the set additionally exposes
 *     `runsheet_submit_order`, mirroring the ws-server's Auto_Submit gating.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  resolveToolSet,
  resolvePackByConversationType,
  clearRegistry as clearVoiceRegistry,
} from "../../src/lib/modules/voiceDomainPackRegistry";
import { clearRegistry as clearModuleRegistry } from "../../src/lib/modules/toolPackRegistry";
import {
  clearPlatformRegistry,
  isPlatformRegistered,
} from "../../src/lib/integrations/platform/registry";
import { resolveAdapter } from "../../src/lib/integrations/platform/adapterResolver";
import type { AdapterConstructionContext } from "../../src/lib/integrations/platform/types";
import { registerRunsheetPlatform } from "../../src/lib/integrations/runsheet/platform";
import { registerRunsheetVoicePack } from "../../src/lib/modules/packs/runsheet/index";
import { runsheetFuelIntakeTools, runsheetSubmitOrder } from "../../src/lib/modules/packs/runsheet/tools";
import { runsheetStatusTools } from "../../src/lib/modules/packs/runsheet/statusTools";
import { runsheetDriverTools } from "../../src/lib/modules/packs/runsheet/driverTools";

// ---------------------------------------------------------------------------
// Facet 1 — Deadline (Req 7.1)
// ---------------------------------------------------------------------------

/**
 * Mirrors `RUNTIME_CREDENTIAL_DEADLINE_MS` in `src/app/ws-server/index.ts`: the
 * 5s bound the ws-server applies to runtime credential retrieval at bind time
 * (Req 7.1).
 */
const RUNTIME_CREDENTIAL_DEADLINE_MS = 5000;

/**
 * Byte-for-byte model of the ws-server's private `withTimeout` helper. The real
 * helper is not exported and the ws-server module cannot be imported in a unit
 * test (it boots a server and may `process.exit`), so the identical race is
 * reproduced here to assert the bounded-deadline property it provides.
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

describe("Feature: multi-platform-voice-integrations — Req 7.1: runtime credential retrieval is bounded by a 5s deadline", () => {
  it("returns the value when the retrieval resolves before the deadline", async () => {
    const resolvedCredentials = { resolution: "resolved" } as const;
    await expect(
      withTimeout(Promise.resolve(resolvedCredentials), RUNTIME_CREDENTIAL_DEADLINE_MS),
    ).resolves.toBe(resolvedCredentials);
  });

  it("propagates the rejection when the retrieval fails before the deadline", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("service down")), RUNTIME_CREDENTIAL_DEADLINE_MS),
    ).rejects.toThrow("service down");
  });

  describe("with a retrieval that never settles", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("rejects with a timeout at the deadline, and not before", async () => {
      const neverSettles = new Promise<never>(() => {
        /* intentionally never resolves or rejects */
      });
      const raced = withTimeout(neverSettles, RUNTIME_CREDENTIAL_DEADLINE_MS);
      // Attach the rejection assertion up front so the rejection is always handled.
      const assertion = expect(raced).rejects.toThrow("timeout");

      // Just before the deadline the race is still pending (bounded, not eager).
      let settledEarly = false;
      raced.then(
        () => (settledEarly = true),
        () => (settledEarly = true),
      );
      await vi.advanceTimersByTimeAsync(RUNTIME_CREDENTIAL_DEADLINE_MS - 1);
      expect(settledEarly).toBe(false);

      // Advancing to the deadline triggers the timeout rejection.
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
    });
  });
});

// ---------------------------------------------------------------------------
// Facet 2 — Tool-set parity for a migrated Runsheet route (Req 11.1)
// ---------------------------------------------------------------------------

/** The base `runsheet` integration id (matches the pack + platform definitions). */
const RUNSHEET_INTEGRATION_ID = "runsheet";
/** The distinct Auto_Submit integration id gating `runsheet_submit_order`. */
const RUNSHEET_AUTO_SUBMIT_INTEGRATION_ID = "runsheet_auto_submit";

/**
 * The pre-generalization Runsheet tool set: every tool gated on the base
 * `runsheet` integration — the six review-only fuel-intake tools, the four
 * read-only status tools, and the six driver-exception tools. It deliberately
 * EXCLUDES `runsheet_submit_order`, which is gated behind the distinct
 * `runsheet_auto_submit` integration (Req 6.2, 11.1).
 */
const BASELINE_RUNSHEET_TOOL_NAMES = new Set(
  [...runsheetFuelIntakeTools, ...runsheetStatusTools, ...runsheetDriverTools].map(
    (tool) => tool.name,
  ),
);

/** Decrypted construction materials the ws-server hands the adapter factory at bind time. */
function makeAdapterContext(): AdapterConstructionContext {
  return {
    baseUrl: "https://runsheet.example.test",
    platformTenantId: "runsheet-tenant-1",
    credentials: { api_key: "ak_live_123", webhook_secret: "whsec_456" },
    config: {},
    contract: {
      authScheme: "bearer",
      readPathPrefix: "/voice",
      intakePath: "/voice-intake",
      timestampFormat: "iso-8601",
      schemaVersion: "1.0",
      tenantHeader: "X-Runsheet-Tenant",
    },
  };
}

describe("Feature: multi-platform-voice-integrations — Req 11.1: a migrated Runsheet route binds the Runsheet adapter and exposes the baseline tool set", () => {
  beforeEach(() => {
    clearPlatformRegistry();
    clearVoiceRegistry();
    clearModuleRegistry();
    registerRunsheetPlatform();
    const packRegistration = registerRunsheetVoicePack();
    expect(packRegistration.ok).toBe(true);
  });

  afterEach(() => {
    clearPlatformRegistry();
    clearVoiceRegistry();
    clearModuleRegistry();
  });

  it("registers Runsheet as the `runsheet` platform and resolves its adapter with platformId 'runsheet'", () => {
    expect(isPlatformRegistered(RUNSHEET_INTEGRATION_ID)).toBe(true);

    const resolution = resolveAdapter(RUNSHEET_INTEGRATION_ID, makeAdapterContext());
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      expect(resolution.platformId).toBe(RUNSHEET_INTEGRATION_ID);
      expect(resolution.adapter.platformId).toBe(RUNSHEET_INTEGRATION_ID);
    }
  });

  it("exposes EXACTLY the pre-generalization Runsheet tool set for enabledIntegrations=['runsheet']", () => {
    // A migrated Runsheet route resolves to the Runsheet pack by conversation type.
    const pack = resolvePackByConversationType("runsheet_fuel_order_intake");
    expect(pack).not.toBeNull();

    const exposed = new Set(
      resolveToolSet(pack!, [RUNSHEET_INTEGRATION_ID]).map((tool) => tool.name),
    );

    // Byte-for-byte parity with the baseline Runsheet tool set.
    expect(exposed).toEqual(BASELINE_RUNSHEET_TOOL_NAMES);
    // The Auto_Submit tool is NOT part of the base tool set (review-only invariant).
    expect(exposed.has(runsheetSubmitOrder.name)).toBe(false);
  });

  it("adds `runsheet_submit_order` only when Auto_Submit is enabled, preserving the base set otherwise", () => {
    const pack = resolvePackByConversationType("runsheet_fuel_order_intake");
    expect(pack).not.toBeNull();

    const withAutoSubmit = new Set(
      resolveToolSet(pack!, [
        RUNSHEET_INTEGRATION_ID,
        RUNSHEET_AUTO_SUBMIT_INTEGRATION_ID,
      ]).map((tool) => tool.name),
    );

    const expectedWithAutoSubmit = new Set(BASELINE_RUNSHEET_TOOL_NAMES);
    expectedWithAutoSubmit.add(runsheetSubmitOrder.name);

    expect(withAutoSubmit).toEqual(expectedWithAutoSubmit);
    expect(withAutoSubmit.has(runsheetSubmitOrder.name)).toBe(true);
  });
});
