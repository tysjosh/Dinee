/**
 * Feature: dinee-voice-platform — RunsheetApiClient argument validation
 *
 * Requirements: 6.3
 *
 * IF the Fuel_Intake_Agent invokes runsheet_lookup_customer with neither a
 * phone number nor an account identifier, THEN the Runsheet_Integration SHALL
 * reject the invocation and return an error indication — before any network
 * call is made.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { RunsheetApiClient } from "../../src/lib/integrations/runsheet/apiClient";

function makeClient(): RunsheetApiClient {
  return new RunsheetApiClient({
    baseUrl: "https://tenant.runsheet.test",
    apiKey: "test-api-key",
    tenantId: "tenant-1",
  });
}

describe("RunsheetApiClient.lookupCustomer argument validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects when neither phone nor account id is provided, without any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = makeClient();

    await expect(client.lookupCustomer({})).rejects.toThrow(
      /phone number or an account identifier/
    );
    // The invocation is rejected before any network call is made.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects when phone and account id are only whitespace, without any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = makeClient();

    await expect(
      client.lookupCustomer({ phone: "   ", accountId: "  " })
    ).rejects.toThrow(/phone number or an account identifier/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not reject when a phone number is provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ customers: [] }),
        text: async () => JSON.stringify({ customers: [] }),
      } as unknown as Response))
    );
    const client = makeClient();

    const result = await client.lookupCustomer({ phone: "+15551234567" });
    expect(result.kind).toBe("empty");
  });
});
