/**
 * Feature: multi-platform-voice-integrations
 * Validates: Requirements 10.1
 *
 * Startup registration smoke test for the Runsheet Platform_Definition
 * (src/lib/integrations/runsheet/platform.ts).
 *
 * Asserts that calling registerRunsheetPlatform() registers Runsheet under the
 * stable Platform_Id "runsheet" and that resolving that id returns the Runsheet
 * Platform_Definition with its exact wire contract (Bearer reads under "/voice",
 * HMAC-signed "POST /voice-intake", ISO-8601 timestamps, schema version "1.0",
 * the "X-Runsheet-Tenant" tenant header, the RUNSHEET_RUNTIME_SERVICE_TOKEN env
 * var, and the data-driven driver-exception sub-session binding). Also asserts
 * that registration is idempotent — calling it twice does not throw and leaves
 * Runsheet registered (Req 10.1).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerRunsheetPlatform,
  RUNSHEET_PLATFORM_ID,
  RUNSHEET_DRIVER_EXCEPTION_CONVERSATION_TYPE,
} from "../../src/lib/integrations/runsheet/platform";
import {
  resolvePlatform,
  isPlatformRegistered,
  clearPlatformRegistry,
} from "../../src/lib/integrations/platform/registry";

beforeEach(() => {
  // Isolate each test from the shared in-process registry.
  clearPlatformRegistry();
});

describe("Runsheet startup registration (Req 10.1)", () => {
  it('registers Runsheet under the "runsheet" Platform_Id', () => {
    expect(isPlatformRegistered("runsheet")).toBe(false);

    registerRunsheetPlatform();

    expect(RUNSHEET_PLATFORM_ID).toBe("runsheet");
    expect(isPlatformRegistered("runsheet")).toBe(true);
  });

  it("resolves the runsheet id to the Runsheet Platform_Definition with its exact wire contract", () => {
    registerRunsheetPlatform();

    const resolved = resolvePlatform("runsheet");
    expect(resolved.resolved).toBe(true);
    if (!resolved.resolved) {
      throw new Error("expected runsheet platform to resolve");
    }

    const def = resolved.definition;

    // Identity + display.
    expect(def.platformId).toBe("runsheet");
    expect(def.displayName).toBe("Runsheet");

    // Credential fields include api_key and webhook_secret.
    const credentialNames = def.credentialFields.map((f) => f.name);
    expect(credentialNames).toContain("api_key");
    expect(credentialNames).toContain("webhook_secret");

    // Transport contract captures Runsheet's exact wire behavior.
    expect(def.contract.authScheme).toBe("bearer");
    expect(def.contract.readPathPrefix).toBe("/voice");
    expect(def.contract.intakePath).toBe("/voice-intake");
    expect(def.contract.timestampFormat).toBe("iso-8601");
    expect(def.contract.schemaVersion).toBe("1.0");
    expect(def.contract.tenantHeader).toBe("X-Runsheet-Tenant");

    // Runtime service token env var.
    expect(def.runtimeServiceTokenEnvVar).toBe(
      "RUNSHEET_RUNTIME_SERVICE_TOKEN",
    );

    // Data-driven sub-session binding for the driver-exception conversation.
    expect(def.subSessions).toBeDefined();
    const driverExceptionBinding = def.subSessions?.find((b) =>
      b.conversationTypes.includes(
        RUNSHEET_DRIVER_EXCEPTION_CONVERSATION_TYPE,
      ),
    );
    expect(driverExceptionBinding).toBeDefined();
    expect(
      driverExceptionBinding?.conversationTypes,
    ).toContain("runsheet_driver_exception");
    expect(driverExceptionBinding?.binderKey).toBe(
      "runsheet_driver_exception",
    );
  });

  it("is idempotent — calling registerRunsheetPlatform twice does not throw and leaves runsheet registered", () => {
    registerRunsheetPlatform();
    expect(() => registerRunsheetPlatform()).not.toThrow();

    expect(isPlatformRegistered("runsheet")).toBe(true);

    const resolved = resolvePlatform("runsheet");
    expect(resolved.resolved).toBe(true);
    if (resolved.resolved) {
      expect(resolved.definition.platformId).toBe("runsheet");
    }
  });
});
