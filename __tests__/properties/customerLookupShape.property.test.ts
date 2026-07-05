/**
 * Feature: dinee-voice-platform, Property 12: Customer lookup result shape matches match count
 *   — single when one match, ordered list when many, empty when none.
 *
 * **Validates: Requirements 6.2**
 *
 * For any array of customer records the Runsheet backend returns for a lookup,
 * RunsheetApiClient.lookupCustomer resolves to:
 *   - `{ kind: "empty" }`               when the array is empty,
 *   - `{ kind: "single", customer }`    when the array has exactly one record,
 *   - `{ kind: "list", customers }`     when the array has more than one record,
 * and the `list` shape preserves the backend order of the records.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import {
  RunsheetApiClient,
  type CustomerRecord,
} from "../../src/lib/integrations/runsheet/apiClient";

function makeClient(): RunsheetApiClient {
  return new RunsheetApiClient({
    baseUrl: "https://tenant.runsheet.test",
    apiKey: "test-api-key",
    tenantId: "tenant-1",
  });
}

/** Stub global fetch so lookupCustomer resolves against the given customers. */
function stubFetchWithCustomers(customers: CustomerRecord[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ customers }),
        text: async () => JSON.stringify({ customers }),
      } as unknown as Response;
    })
  );
}

// --- Arbitraries ---

const customerArb: fc.Arbitrary<CustomerRecord> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 24 }),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  phone: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  accountId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
});

/** Arrays of varying length: 0 (none), 1 (single), and many. */
const customersArb: fc.Arbitrary<CustomerRecord[]> = fc.array(customerArb, {
  minLength: 0,
  maxLength: 8,
});

describe("Property 12: Customer lookup result shape matches match count", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves to empty / single / ordered list according to the match count", async () => {
    await fc.assert(
      fc.asyncProperty(customersArb, async (customers) => {
        stubFetchWithCustomers(customers);
        const client = makeClient();

        const result = await client.lookupCustomer({ phone: "+15551234567" });

        if (customers.length === 0) {
          expect(result.kind).toBe("empty");
        } else if (customers.length === 1) {
          expect(result.kind).toBe("single");
          if (result.kind === "single") {
            expect(result.customer).toEqual(customers[0]);
          }
        } else {
          expect(result.kind).toBe("list");
          if (result.kind === "list") {
            // The list shape preserves the backend order exactly.
            expect(result.customers).toEqual(customers);
          }
        }

        vi.unstubAllGlobals();
      }),
      { numRuns: 100 }
    );
  });
});
