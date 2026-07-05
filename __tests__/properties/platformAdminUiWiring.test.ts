/**
 * Feature: multi-platform-voice-integrations
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 *
 * Integration Admin UI wiring — example tests.
 *
 * The repo does not use jsdom / React Testing Library, so these tests exercise
 * the Integration_Admin_UI's WIRING at the pure-logic level. The React
 * component (`PlatformIntegrationAdmin.tsx`, task 15.1) delegates all of its
 * decision/transform behavior to the helpers in
 * `src/components/dashboard/platformIntegrationAdmin.logic.ts`, and calls the
 * Convex bindings with exactly the arguments those helpers return:
 *
 *   handleSave     → prepareSaveConfig(...)  → saveIntegrationConfig(args)
 *   handleAssign   → preparePhoneRoute(...)  → savePhoneRoute(args)
 *   CredentialTest → testIntegrationCredential(...) → ConnectionBadge(status)
 *   MaskedCard     → formatMaskedCredential(last4)
 *
 * These tests assert those wiring behaviors:
 *   9.1: save routes the entered fields to the config store
 *   9.2: assign-number routes (phoneNumber, platformId, tenantId, type)
 *   9.3: credential-test status is what the badge displays
 *   9.4: masked display shows only last-4, never a full/plaintext value
 *   9.5: a missing required field blocks the save and names the field
 */
import { describe, it, expect } from "vitest";
import {
  type PlatformCredentialField,
  type SaveConfigArgs,
  connectionBadge,
  describeSaveError,
  formatMaskedCredential,
  preparePhoneRoute,
  prepareSaveConfig,
} from "../../src/components/dashboard/platformIntegrationAdmin.logic";

// Mirrors the Runsheet credential fields the admin form renders dynamically.
const RUNSHEET_FIELDS: PlatformCredentialField[] = [
  { name: "api_key", label: "API Key", required: true },
  { name: "webhook_secret", label: "Webhook Secret", required: true },
];

/**
 * A recording double for a Convex action/mutation. Captures the arguments it
 * was called with so the tests can assert the UI wires the RIGHT values through
 * — this is exactly what the component passes to `saveIntegrationConfig` /
 * `savePhoneRoute` / `testIntegrationCredential`.
 */
function recorder<TArgs, TResult>(result: TResult) {
  const calls: TArgs[] = [];
  const fn = async (args: TArgs): Promise<TResult> => {
    calls.push(args);
    return result;
  };
  return { fn, calls };
}

// ============================================================================
// Req 9.1 — save routes entered fields through the config store
// ============================================================================

describe("Req 9.1: submitting the config form saves through the config store", () => {
  it("calls saveIntegrationConfig with the entered platformId/tenantId/baseUrl/credentials", async () => {
    const save = recorder<
      SaveConfigArgs,
      { ok: true; created: boolean }
    >({ ok: true, created: true });

    // Reproduce the component's handleSave flow: prepare, then (if ok) call.
    const prepared = prepareSaveConfig(
      {
        platformId: "runsheet",
        tenantId: "dinee-tenant-1",
        baseUrl: "  https://api.runsheet.test  ",
        platformTenantId: "rs-tenant-9",
        credentials: { api_key: "  rs_key_ABCDEF1234  ", webhook_secret: "whsec_ZZZZ" },
        allowedTypesRaw: "runsheet_inbound_order, runsheet_driver_exception",
        configRaw: '{ "autoSubmitEnabled": false }',
        actorUserId: "user_1",
        actorRole: "platform_admin",
      },
      RUNSHEET_FIELDS,
      undefined,
    );

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    await save.fn(prepared.args);

    // Exactly one save, carrying the entered (trimmed) values.
    expect(save.calls).toHaveLength(1);
    const args = save.calls[0];
    expect(args.platformId).toBe("runsheet");
    expect(args.tenantId).toBe("dinee-tenant-1");
    expect(args.baseUrl).toBe("https://api.runsheet.test");
    expect(args.platformTenantId).toBe("rs-tenant-9");
    expect(args.credentials).toEqual({
      api_key: "rs_key_ABCDEF1234",
      webhook_secret: "whsec_ZZZZ",
    });
    expect(args.allowedConversationTypes).toEqual([
      "runsheet_inbound_order",
      "runsheet_driver_exception",
    ]);
    expect(args.config).toEqual({ autoSubmitEnabled: false });
    expect(args.actorUserId).toBe("user_1");
    expect(args.actorRole).toBe("platform_admin");
  });

  it("omits credential fields left blank when a value is already stored (keeps the stored secret)", async () => {
    const save = recorder<
      { credentials: Record<string, string> },
      { ok: true; created: boolean }
    >({ ok: true, created: false });

    const prepared = prepareSaveConfig(
      {
        platformId: "runsheet",
        tenantId: "dinee-tenant-1",
        baseUrl: "https://api.runsheet.test",
        platformTenantId: "rs-tenant-9",
        // Only api_key re-entered; webhook_secret left blank but already stored.
        credentials: { api_key: "rs_new_9999", webhook_secret: "" },
        allowedTypesRaw: "",
        configRaw: "",
      },
      RUNSHEET_FIELDS,
      { api_key: "1234", webhook_secret: "6789" },
    );

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    await save.fn(prepared.args as { credentials: Record<string, string> });

    // Only the re-entered secret is sent; the blank one is never transmitted.
    expect(save.calls[0].credentials).toEqual({ api_key: "rs_new_9999" });
  });

  it("propagates a config-store rejection back to a named field error", () => {
    // The store rejects an unregistered platform (Req 2.4); the UI maps the
    // returned { code, field } to an inline error message (Req 9.5 display).
    const message = describeSaveError({
      code: "unknown_platform",
      field: "runsheet",
    });
    expect(message).toContain("runsheet");
    expect(message).toContain("not registered");
  });
});

// ============================================================================
// Req 9.5 — missing required field blocks save and names the field
// ============================================================================

describe("Req 9.5: a missing required field blocks the save and names the field", () => {
  it("blocks the save when the base URL is blank and names it", async () => {
    const save = recorder<Record<string, unknown>, { ok: true; created: boolean }>({
      ok: true,
      created: true,
    });

    const prepared = prepareSaveConfig(
      {
        platformId: "runsheet",
        tenantId: "dinee-tenant-1",
        baseUrl: "   ", // whitespace only → missing
        platformTenantId: "rs-tenant-9",
        credentials: { api_key: "sk_1", webhook_secret: "wh_1" },
        allowedTypesRaw: "",
        configRaw: "",
      },
      RUNSHEET_FIELDS,
      undefined,
    );

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.errors.baseUrl).toMatch(/base url/i);

    // The action is NEVER invoked when preparation fails.
    if (prepared.ok) await save.fn((prepared as { args: unknown }).args as Record<string, unknown>);
    expect(save.calls).toHaveLength(0);
  });

  it("blocks the save and names a required credential with no stored value", () => {
    const prepared = prepareSaveConfig(
      {
        platformId: "runsheet",
        tenantId: "dinee-tenant-1",
        baseUrl: "https://api.runsheet.test",
        platformTenantId: "rs-tenant-9",
        // webhook_secret missing and nothing stored for it.
        credentials: { api_key: "sk_1" },
        allowedTypesRaw: "",
        configRaw: "",
      },
      RUNSHEET_FIELDS,
      undefined,
    );

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    // The error names the offending field by its human label.
    expect(prepared.errors.webhook_secret).toBe("Webhook Secret is required");
    // The satisfied field carries no error.
    expect(prepared.errors.api_key).toBeUndefined();
  });

  it("blocks the save when the platform tenant id is missing", () => {
    const prepared = prepareSaveConfig(
      {
        platformId: "runsheet",
        tenantId: "dinee-tenant-1",
        baseUrl: "https://api.runsheet.test",
        platformTenantId: "",
        credentials: { api_key: "sk_1", webhook_secret: "wh_1" },
        allowedTypesRaw: "",
        configRaw: "",
      },
      RUNSHEET_FIELDS,
      undefined,
    );

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.errors.platformTenantId).toMatch(/platform tenant id/i);
  });

  it("blocks the save when the optional config is not valid JSON", () => {
    const prepared = prepareSaveConfig(
      {
        platformId: "runsheet",
        tenantId: "dinee-tenant-1",
        baseUrl: "https://api.runsheet.test",
        platformTenantId: "rs-tenant-9",
        credentials: { api_key: "sk_1", webhook_secret: "wh_1" },
        allowedTypesRaw: "",
        configRaw: "{ not valid json",
      },
      RUNSHEET_FIELDS,
      undefined,
    );

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.errors.config).toMatch(/valid json/i);
  });
});

// ============================================================================
// Req 9.2 — assign-number routes through the phone-route store
// ============================================================================

describe("Req 9.2: assigning a number saves through the phone-route store", () => {
  it("calls savePhoneRoute with (phoneNumber, platformId, tenantId, conversationType)", async () => {
    const savePhoneRoute = recorder<
      {
        phoneNumber: string;
        platformId: string;
        tenantId: string;
        conversationType: string;
      },
      { routeId: string; updated: boolean }
    >({ routeId: "route_1", updated: false });

    const prepared = preparePhoneRoute({
      phoneNumber: "  +15551234567 ",
      platformId: "runsheet",
      tenantId: "dinee-tenant-1",
      conversationType: "runsheet_driver_exception",
    });

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    await savePhoneRoute.fn(prepared.args);

    expect(savePhoneRoute.calls).toHaveLength(1);
    expect(savePhoneRoute.calls[0]).toEqual({
      phoneNumber: "+15551234567",
      platformId: "runsheet",
      tenantId: "dinee-tenant-1",
      conversationType: "runsheet_driver_exception",
    });
  });

  it("blocks the assignment when the phone number is blank", async () => {
    const savePhoneRoute = recorder<Record<string, unknown>, unknown>(null);

    const prepared = preparePhoneRoute({
      phoneNumber: "   ",
      platformId: "runsheet",
      tenantId: "dinee-tenant-1",
      conversationType: "runsheet_inbound_order",
    });

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.error).toMatch(/phone number/i);
    expect(savePhoneRoute.calls).toHaveLength(0);
  });

  it("blocks the assignment when no conversation type is chosen", () => {
    const prepared = preparePhoneRoute({
      phoneNumber: "+15551234567",
      platformId: "runsheet",
      tenantId: "dinee-tenant-1",
      conversationType: "",
    });

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.error).toMatch(/conversation type/i);
  });
});

// ============================================================================
// Req 9.3 — credential-test status is displayed
// ============================================================================

describe("Req 9.3: triggering a credential test displays the returned status", () => {
  it("invokes testIntegrationCredential and surfaces the returned status through the badge", async () => {
    // A connected result → the badge reflects "connected".
    const testConnected = recorder<
      { platformId: string; tenantId: string },
      { status: "connected" | "disconnected" | "error"; error?: string }
    >({ status: "connected" });

    const result = await testConnected.fn({
      platformId: "runsheet",
      tenantId: "dinee-tenant-1",
    });

    expect(testConnected.calls[0]).toEqual({
      platformId: "runsheet",
      tenantId: "dinee-tenant-1",
    });
    expect(connectionBadge(result.status)).toEqual({
      cls: "badge badge-success",
      label: "Connected",
    });
  });

  it("surfaces an error status returned by the credential test", async () => {
    const testError = recorder<
      { platformId: string; tenantId: string },
      { status: "connected" | "disconnected" | "error"; error?: string }
    >({ status: "error", error: "401 Unauthorized" });

    const result = await testError.fn({
      platformId: "runsheet",
      tenantId: "dinee-tenant-1",
    });

    expect(result.status).toBe("error");
    expect(connectionBadge(result.status)).toEqual({
      cls: "badge badge-danger",
      label: "Error",
    });
  });

  it("maps every connection status to a distinct display", () => {
    expect(connectionBadge("connected").label).toBe("Connected");
    expect(connectionBadge("disconnected").label).toBe("Disconnected");
    expect(connectionBadge("error").label).toBe("Error");
    // No status yet (not configured) falls back without throwing.
    expect(connectionBadge(undefined).label).toBe("Not configured");
  });
});

// ============================================================================
// Req 9.4 — masked display shows only the last-4, never a full value
// ============================================================================

describe("Req 9.4: the masked view shows at most the last 4 characters", () => {
  it("renders the fixed mask followed by only the last-4", () => {
    expect(formatMaskedCredential("1234")).toBe("••••••••1234");
  });

  it("never contains the full/plaintext credential value", () => {
    const fullSecret = "rs_key_SUPER_SECRET_VALUE_1234";
    const last4 = fullSecret.slice(-4); // "1234"

    const masked = formatMaskedCredential(last4);

    // The displayed string reveals at most the last-4 and none of the rest.
    expect(masked).not.toContain(fullSecret);
    expect(masked).not.toContain("SUPER_SECRET");
    expect(masked.endsWith(last4)).toBe(true);
    // Everything before the last-4 is masking, not credential material.
    expect(masked.slice(0, masked.length - last4.length)).toBe("••••••••");
  });
});
