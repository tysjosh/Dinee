/**
 * Feature: dinee-voice-platform, Task 10.1 — Runsheet tool handlers + dispatch-review wiring
 *
 * Verifies the six fuel-intake tool handlers registered by
 * `registerRunsheetHandlers`:
 *   - the read/validate tools delegate to the injected `RunsheetApiClient`,
 *   - `runsheet_create_order_draft` builds a TRANSIENT in-session draft via
 *     `buildOrderDraft` and advances the phase (Req 5.8, 5.11, 7.2, 7.3),
 *   - `runsheet_queue_dispatch_review` assembles a `VoiceIntakePayload` from the
 *     transient draft + the FULL captured transcript content + call metadata and
 *     submits it over the signed Intake_Contract (Req 6.8, 10.9, 18.2),
 *   - a dispatch-review with no transient draft reports unconfirmed placement so
 *     the session driver's fail-safe retains state (Req 6.8, 6.10).
 *
 * The handlers are exercised through the real tool executor (`executeTool`) with
 * a resolver injected directly, and the intake submission goes through the real
 * `MockIntakeClient` so the signed round-trip (canonicalization + HMAC) is
 * genuinely verified rather than mocked.
 *
 * _Requirements: 6.7, 6.8, 6.10, 10.9, 18.1, 18.2_
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registerRunsheetHandlers,
  clearRunsheetCallSessions,
  type RunsheetCallSession,
} from "../../src/lib/modules/packs/runsheet/handlers";
import {
  executeTool,
  clearToolHandlers,
  type ToolExecContext,
} from "../../src/app/ws-server/runtime/toolExecutor";
import type {
  CustomerLookupResult,
  CustomerSite,
  CustomerTank,
  RunsheetApiClient,
} from "../../src/lib/integrations/runsheet/apiClient";
import { MockIntakeClient } from "../../src/lib/integrations/runsheet/mockIntakeClient";
import type { OrderDraft } from "../../src/lib/modules/packs/runsheet/slots";
import type { TranscriptTurn } from "../../src/app/ws-server/runtime/transcriptBuffer";

const TENANT_ID = "tenant_runsheet_1";
const SECRET = "shared-webhook-secret";

interface FakeApiCalls {
  lookup: Array<{ phone?: string; accountId?: string }>;
  sites: string[];
  tanks: string[];
  products: string[];
}

/** Builds a minimal fake RunsheetApiClient recording its invocations. */
function makeFakeApiClient(overrides?: {
  lookupResult?: CustomerLookupResult;
  sites?: CustomerSite[];
  tanks?: CustomerTank[];
  productValid?: boolean;
}): { apiClient: RunsheetApiClient; calls: FakeApiCalls } {
  const calls: FakeApiCalls = { lookup: [], sites: [], tanks: [], products: [] };
  const apiClient = {
    lookupCustomer: async (q: { phone?: string; accountId?: string }) => {
      calls.lookup.push(q);
      return overrides?.lookupResult ?? { kind: "empty" as const };
    },
    listCustomerSites: async (customerId: string) => {
      calls.sites.push(customerId);
      return overrides?.sites ?? [];
    },
    listCustomerTanks: async (customerId: string) => {
      calls.tanks.push(customerId);
      return overrides?.tanks ?? [];
    },
    validateProduct: async (code: string) => {
      calls.products.push(code);
      return overrides?.productValid ?? true;
    },
  } as unknown as RunsheetApiClient;
  return { apiClient, calls };
}

function makeCtx(toolName: string): ToolExecContext {
  return {
    callSid: "call_1",
    tenantId: TENANT_ID,
    conversationType: "runsheet_fuel_order_intake",
    toolName,
    enabledIntegrations: ["runsheet"],
  };
}

/** Assembles a call session with the given draft/transcript accessors. */
function makeSession(opts: {
  apiClient: RunsheetApiClient;
  intakeClient: MockIntakeClient;
  draft?: OrderDraft;
  transcript?: TranscriptTurn[];
  now?: () => number;
}): RunsheetCallSession {
  return {
    apiClient: opts.apiClient,
    tenantConfig: { requiresPurchaseOrder: false },
    intakeClient: opts.intakeClient,
    intakeSecret: SECRET,
    intakeMeta: {
      schemaVersion: "1.0.0",
      transcriptId: "transcript_1",
      idempotencyKey: "idem_1",
      recordingRef: null,
      agentId: "agent_1",
      sessionId: "session_1",
      callerPhone: "+15551230000",
      reviewRequired: true,
      now: opts.now,
    },
    getDraft: () => opts.draft,
    getTranscript: () => opts.transcript ?? [],
  };
}

describe("Task 10.1: Runsheet tool handlers", () => {
  let session: RunsheetCallSession | undefined;

  beforeEach(() => {
    clearToolHandlers();
    clearRunsheetCallSessions();
    // Inject a resolver that returns the per-test session.
    registerRunsheetHandlers(() => {
      if (!session) throw new Error("no session bound");
      return session;
    });
  });

  afterEach(() => {
    clearToolHandlers();
    clearRunsheetCallSessions();
    session = undefined;
  });

  it("delegates runsheet_lookup_customer to the API client and advances on a single match", async () => {
    const { apiClient, calls } = makeFakeApiClient({
      lookupResult: { kind: "single", customer: { id: "c1", name: "Acme" } },
    });
    session = makeSession({ apiClient, intakeClient: new MockIntakeClient({ secret: SECRET, expectedTenantId: TENANT_ID }) });

    const outcome = await executeTool(
      "runsheet_lookup_customer",
      { phone: "+15551230000" },
      makeCtx("runsheet_lookup_customer")
    );

    expect(outcome.status).toBe("ok");
    expect(calls.lookup).toEqual([{ phone: "+15551230000", accountId: undefined }]);
    const result = outcome.result as Record<string, unknown>;
    expect(result.kind).toBe("single");
    expect(result.phaseEvent).toBe("customer_identified");
  });

  it("does not advance the phase on an ambiguous (list) lookup", async () => {
    const { apiClient } = makeFakeApiClient({
      lookupResult: {
        kind: "list",
        customers: [
          { id: "c1", name: "Acme" },
          { id: "c2", name: "Acme West" },
        ],
      },
    });
    session = makeSession({ apiClient, intakeClient: new MockIntakeClient({ secret: SECRET, expectedTenantId: TENANT_ID }) });

    const outcome = await executeTool(
      "runsheet_lookup_customer",
      { phone: "+15551230000" },
      makeCtx("runsheet_lookup_customer")
    );

    const result = outcome.result as Record<string, unknown>;
    expect(result.kind).toBe("list");
    expect(result.phaseEvent).toBeUndefined();
  });

  it("delegates site and tank listing and product validation", async () => {
    const { apiClient, calls } = makeFakeApiClient({
      sites: [{ id: "s1", customerId: "c1", name: "Depot" }],
      tanks: [{ id: "t1", customerId: "c1" }],
      productValid: true,
    });
    session = makeSession({ apiClient, intakeClient: new MockIntakeClient({ secret: SECRET, expectedTenantId: TENANT_ID }) });

    const sitesOutcome = await executeTool(
      "runsheet_list_customer_sites",
      { customerId: "c1" },
      makeCtx("runsheet_list_customer_sites")
    );
    expect((sitesOutcome.result as { sites: CustomerSite[] }).sites).toHaveLength(1);
    expect(calls.sites).toEqual(["c1"]);

    const tanksOutcome = await executeTool(
      "runsheet_list_customer_tanks",
      { customerId: "c1" },
      makeCtx("runsheet_list_customer_tanks")
    );
    expect((tanksOutcome.result as { tanks: CustomerTank[] }).tanks).toHaveLength(1);
    expect(calls.tanks).toEqual(["c1"]);

    const productOutcome = await executeTool(
      "runsheet_validate_product",
      { productCode: "diesel" },
      makeCtx("runsheet_validate_product")
    );
    expect((productOutcome.result as { valid: boolean }).valid).toBe(true);
    expect(calls.products).toEqual(["diesel"]);
  });

  it("builds a transient order draft via buildOrderDraft and advances to order_finalized", async () => {
    const { apiClient } = makeFakeApiClient();
    session = makeSession({ apiClient, intakeClient: new MockIntakeClient({ secret: SECRET, expectedTenantId: TENANT_ID }) });

    const outcome = await executeTool(
      "runsheet_create_order_draft",
      {
        customerId: "c1",
        deliverySiteId: "s1",
        productCode: "diesel",
        quantity: "500",
        deliveryWindow: "tomorrow morning",
        urgency: "urgent",
        confidenceScore: 0.9,
      },
      makeCtx("runsheet_create_order_draft")
    );

    expect(outcome.status).toBe("ok");
    const result = outcome.result as { draft: OrderDraft; phaseEvent: string };
    expect(result.phaseEvent).toBe("draft_created");
    // Every collected (validated) value is recorded (Req 5.11); invalids dropped.
    expect(result.draft.slots.customer).toBe("c1");
    expect(result.draft.slots.product_code).toBe("DIESEL");
    expect(result.draft.slots.quantity).toEqual({ gallons: 500 });
    expect(result.draft.urgency).toBe("urgent");
    expect(result.draft.confidenceScore).toBe(0.9);
  });

  it("submits the transient draft + full transcript over the signed Intake_Contract", async () => {
    const { apiClient } = makeFakeApiClient();
    const intakeClient = new MockIntakeClient({
      secret: SECRET,
      expectedTenantId: TENANT_ID,
      now: () => 1_000,
    });
    const draft: OrderDraft = {
      slots: { customer: "c1", product_code: "DIESEL", quantity: { gallons: 500 } },
      missingSlots: [],
      urgency: "urgent",
      confidenceScore: 0.9,
    };
    const transcript: TranscriptTurn[] = [
      { role: "caller", text: "I need 500 gallons of diesel", at: 100 },
      { role: "agent", text: "Delivering tomorrow morning, confirmed.", at: 200 },
    ];
    session = makeSession({
      apiClient,
      intakeClient,
      draft,
      transcript,
      now: () => 1_000,
    });

    const outcome = await executeTool(
      "runsheet_queue_dispatch_review",
      { draftId: "draft_1" },
      makeCtx("runsheet_queue_dispatch_review")
    );

    expect(outcome.status).toBe("ok");
    const result = outcome.result as { placed: boolean; confirmed: boolean };
    expect(result.placed).toBe(true);
    expect(result.confirmed).toBe(true);

    // The mock received a correctly-signed payload carrying the FULL transcript
    // content and the extracted slots (Req 6.8, 10.9, 18.2).
    const receipt = intakeClient.getLastReceipt();
    expect(receipt).toBeDefined();
    expect(intakeClient.getOrdersCreated()).toBe(1);
    expect(receipt?.deserialized.transcript).toEqual(transcript);
    expect(receipt?.deserialized.transcriptId).toBe("transcript_1");
    expect(receipt?.deserialized.extractedSlots).toEqual(draft.slots);
    expect(receipt?.deserialized.callId).toBe("call_1");
    expect(receipt?.deserialized.tenantId).toBe(TENANT_ID);
  });

  it("reports unconfirmed placement when there is no transient draft to submit", async () => {
    const { apiClient } = makeFakeApiClient();
    const intakeClient = new MockIntakeClient({ secret: SECRET, expectedTenantId: TENANT_ID });
    session = makeSession({ apiClient, intakeClient, draft: undefined });

    const outcome = await executeTool(
      "runsheet_queue_dispatch_review",
      { draftId: "draft_1" },
      makeCtx("runsheet_queue_dispatch_review")
    );

    expect(outcome.status).toBe("ok");
    const result = outcome.result as { placed: boolean; confirmed: boolean };
    expect(result.placed).toBe(false);
    expect(result.confirmed).toBe(false);
    // No submission attempted; nothing persisted as an order-of-record.
    expect(intakeClient.getOrdersCreated()).toBe(0);
  });
});
