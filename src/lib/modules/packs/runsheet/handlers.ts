/**
 * Runsheet pack — tool handler registration and the per-call runtime seam.
 *
 * Binds each Runsheet fuel-intake {@link VoiceToolDefinition.handler} key to an
 * implementation in the tool-executor registry (`registerToolHandler`), exactly
 * as the logistics pack does (`logistics/handlers.ts`). The six review-only MVP
 * tools are wired here:
 *
 *   - `runsheet_lookup_customer`      → {@link RunsheetApiClient.lookupCustomer}
 *   - `runsheet_list_customer_sites`  → {@link RunsheetApiClient.listCustomerSites}
 *   - `runsheet_list_customer_tanks`  → {@link RunsheetApiClient.listCustomerTanks}
 *   - `runsheet_validate_product`     → {@link RunsheetApiClient.validateProduct}
 *   - `runsheet_create_order_draft`   → {@link buildOrderDraft} (transient draft)
 *   - `runsheet_queue_dispatch_review`→ submit over the signed Intake_Contract
 *
 * OWNERSHIP BOUNDARY (Req 20.3, 10.7): the `runsheet_create_order_draft` handler
 * produces a transient, in-memory {@link OrderDraft} only — it is NEVER written
 * to a Dinee Convex table. The `runsheet_queue_dispatch_review` handler submits
 * that transient draft to the Runsheet backend over the signed Intake_Contract
 * ({@link IntakeClient}), carrying the FULL confirmed transcript content plus the
 * transcript id (Req 6.8, 10.9, 18.2). The Runsheet backend is the system of
 * record once the draft is submitted.
 *
 * TRANSCRIPT CAPTURE IS A RUNTIME SIDE-EFFECT (Req 18.1): there is no
 * model-invoked transcript-append tool here. The session driver's
 * `TranscriptBuffer` appends confirmed turns automatically; the dispatch-review
 * handler reads that captured transcript through the bound call session
 * ({@link RunsheetCallSession.getTranscript}) and carries it in the payload.
 *
 * PER-CALL RUNTIME SEAM: the handlers are registered once globally, but they act
 * on behalf of a specific in-progress call. Per-call materials — the read/
 * validate client, the tenant slot config, the signed Intake_Contract client and
 * its secret, and accessors for the transient draft and the captured transcript —
 * are bound by the runtime via {@link bindRunsheetCallSession} when a runsheet
 * call starts and released via {@link releaseRunsheetCallSession} at call end.
 * Handlers resolve the session by `callSid`. Per-tenant construction of those
 * clients from the stored integration config is wired by the runtime; tests may
 * inject a resolver directly.
 *
 * Requirements: 6.7, 6.8, 6.9, 6.10, 18.1, 18.3, 20.3
 */

import {
  registerToolHandler,
  type ToolExecContext,
  type ToolHandler,
} from "@/app/ws-server/runtime/toolExecutor";
import type { TranscriptTurn } from "@/app/ws-server/runtime/transcriptBuffer";
import type {
  IntakeClient,
  IntakeResult,
  VoiceIntakePayload,
} from "@/lib/integrations/runsheet/voiceIntakeClient";
import type { RunsheetApiClient } from "@/lib/integrations/runsheet/apiClient";
import {
  buildOrderDraft,
  type OrderDraft,
  type OrderDraftInput,
  type RunsheetTenantConfig,
  type SlotCollectionState,
  type SlotKey,
  type UrgencyLevel,
} from "@/lib/modules/packs/runsheet/slots";
import {
  CUSTOMER_IDENTIFIED_EVENT,
  DRAFT_CREATED_EVENT,
} from "@/lib/modules/packs/runsheet/phases";

// ============================================================================
// Per-call runtime seam
// ============================================================================

/**
 * Static submission metadata the dispatch-review handler needs to assemble the
 * {@link VoiceIntakePayload}. The transcript content and transient draft are
 * resolved through the session's accessors, not carried here, because they
 * evolve over the life of the call.
 */
export interface RunsheetIntakeMeta {
  /** Intake payload schema version (Req 10.3, `X-Schema-Version`). */
  schemaVersion: string;
  /** Dinee-owned transcript-store id referenced by the payload (Req 10.2, 18.2). */
  transcriptId: string;
  /** Unique idempotency key for this call/order attempt (Req 11.3). */
  idempotencyKey: string;
  /** Optional call-recording reference (Req 10.2). */
  recordingRef: string | null;
  /** Voice agent identifier (Req 10.2). */
  agentId: string;
  /** Voice session identifier (Req 10.2). */
  sessionId: string;
  /** Calling party phone number (Req 10.2, 10.5). */
  callerPhone: string;
  /** Whether the intake requires dispatcher review (review-only MVP: `true`). */
  reviewRequired: boolean;
  /** Injectable clock for the payload timestamp; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Per-call materials the runtime binds so the globally-registered handlers can
 * act on behalf of one in-progress call without the executor coupling to any
 * pack-specific shape.
 */
export interface RunsheetCallSession {
  /** Read/validate client scoped to this call's Runsheet tenant. */
  apiClient: RunsheetApiClient;
  /** Tenant slot/PO configuration governing the transient draft (Req 5.6). */
  tenantConfig: RunsheetTenantConfig;
  /** Signed Intake_Contract client used to submit the finalized draft (Req 6.8). */
  intakeClient: IntakeClient;
  /** HMAC signing secret for the Intake_Contract submission (Req 11.1). */
  intakeSecret: string;
  /** Static submission metadata for the intake payload. */
  intakeMeta: RunsheetIntakeMeta;
  /**
   * Returns the transient in-session {@link OrderDraft} to submit, or
   * `undefined` when none has been built yet. The runtime wires this to the
   * session driver's captured draft; it is never a Dinee order-of-record.
   */
  getDraft: () => OrderDraft | undefined;
  /**
   * Returns the FULL confirmed transcript content captured by the runtime's
   * `TranscriptBuffer` side-effect (Req 18.1). Carried in the signed payload so
   * the Runsheet backend receives the transcript without a callback (Req 10.9).
   */
  getTranscript: () => TranscriptTurn[];
}

/** Resolves the bound {@link RunsheetCallSession} for a tool-exec context. */
export type RunsheetSessionResolver = (
  ctx: ToolExecContext
) => RunsheetCallSession | Promise<RunsheetCallSession>;

/** Module-level registry of bound call sessions, keyed by `callSid`. */
const callSessions = new Map<string, RunsheetCallSession>();

/**
 * Binds per-call materials for a runsheet call so the registered handlers can
 * serve it. Call when a runsheet conversation starts (Req 18.1 side-effect
 * wiring). Replaces any existing binding for the same `callSid`.
 */
export function bindRunsheetCallSession(
  callSid: string,
  session: RunsheetCallSession
): void {
  callSessions.set(callSid, session);
}

/** Releases the bound call session at call end so no state outlives the call. */
export function releaseRunsheetCallSession(callSid: string): void {
  callSessions.delete(callSid);
}

/** Returns the bound call session for `callSid`, or `undefined` if none. */
export function getRunsheetCallSession(
  callSid: string
): RunsheetCallSession | undefined {
  return callSessions.get(callSid);
}

/** Clears every bound call session. Testing only. */
export function clearRunsheetCallSessions(): void {
  callSessions.clear();
}

/** Default resolver: looks the session up in the module-level registry. */
const defaultResolveSession: RunsheetSessionResolver = (ctx) => {
  const session = callSessions.get(ctx.callSid);
  if (!session) {
    throw new Error(
      `no runsheet call session bound for callSid "${ctx.callSid}"`
    );
  }
  return session;
};

// ============================================================================
// Tool argument shapes (mirror the runsheet tool schemas in tools.ts)
// ============================================================================

/** Arguments for `runsheet_lookup_customer`. */
interface LookupCustomerArgs {
  phone?: string;
  accountId?: string;
}

/** Arguments for `runsheet_list_customer_sites`. */
interface ListCustomerSitesArgs {
  customerId: string;
}

/** Arguments for `runsheet_list_customer_tanks`. */
interface ListCustomerTanksArgs {
  customerId: string;
  siteId?: string;
}

/** Arguments for `runsheet_validate_product`. */
interface ValidateProductArgs {
  productCode: string;
}

/** Arguments for `runsheet_lookup_order_by_phone`. */
interface LookupOrderByPhoneArgs {
  phone: string;
}

/** Arguments for `runsheet_get_order_status` and `runsheet_get_eta`. */
interface OrderIdArgs {
  orderId: string;
}

/** Arguments for `runsheet_get_recent_deliveries`. */
interface RecentDeliveriesArgs {
  customerId: string;
  limit?: number;
}

/** Arguments for `runsheet_create_order_draft`. */
interface CreateOrderDraftArgs {
  customerId?: string;
  deliverySiteId?: string;
  productCode?: string;
  quantity?: string;
  deliveryWindow?: string;
  urgency?: string;
  poNumber?: string;
  /** Optional model-supplied extraction confidence in `[0, 1]` (Req 5.8). */
  confidenceScore?: number;
}

/** Maps a `runsheet_create_order_draft` argument name to its slot key (Req 5.11). */
const DRAFT_ARG_TO_SLOT: ReadonlyArray<readonly [keyof CreateOrderDraftArgs, SlotKey]> = [
  ["customerId", "customer"],
  ["deliverySiteId", "delivery_site"],
  ["productCode", "product_code"],
  ["quantity", "quantity"],
  ["deliveryWindow", "delivery_window"],
  ["poNumber", "po_number"],
  ["urgency", "urgency"],
];

// ============================================================================
// Handlers
// ============================================================================

/**
 * Builds an {@link OrderDraftInput} from the flat model-supplied draft arguments.
 * Each provided value becomes a single-request slot collection state so
 * {@link buildOrderDraft} applies the per-slot validators — invalid values are
 * discarded and never recorded (Req 5.10).
 */
function toOrderDraftInput(args: CreateOrderDraftArgs): OrderDraftInput {
  const slots: Partial<Record<SlotKey, SlotCollectionState>> = {};
  for (const [argKey, slotKey] of DRAFT_ARG_TO_SLOT) {
    const raw = args[argKey];
    if (typeof raw === "string" && raw.length > 0) {
      slots[slotKey] = { rawValue: raw, requestCount: 1 };
    }
  }
  return {
    slots,
    urgency: isUrgencyLevel(args.urgency) ? args.urgency : undefined,
    confidenceScore:
      typeof args.confidenceScore === "number" ? args.confidenceScore : 1,
  };
}

/** Type guard for the urgency enum without importing the runtime list. */
function isUrgencyLevel(value: unknown): value is UrgencyLevel {
  return value === "normal" || value === "urgent" || value === "emergency";
}

const makeLookupCustomerHandler = (
  resolveSession: RunsheetSessionResolver
): ToolHandler => async (args: unknown, ctx: ToolExecContext) => {
  const { phone, accountId } = args as LookupCustomerArgs;
  const session = await resolveSession(ctx);
  const result = await session.apiClient.lookupCustomer({ phone, accountId });
  // A single confident match advances customer_identification → order_building
  // (Req 7.1, 7.2). Ambiguous (list) or empty results stay in-phase for
  // disambiguation/retry. The transport reads `phaseEvent` off the result.
  const phaseEvent = result.kind === "single" ? CUSTOMER_IDENTIFIED_EVENT : undefined;
  return { ...result, phaseEvent };
};

const makeListCustomerSitesHandler = (
  resolveSession: RunsheetSessionResolver
): ToolHandler => async (args: unknown, ctx: ToolExecContext) => {
  const { customerId } = args as ListCustomerSitesArgs;
  const session = await resolveSession(ctx);
  const sites = await session.apiClient.listCustomerSites(customerId);
  return { sites };
};

const makeListCustomerTanksHandler = (
  resolveSession: RunsheetSessionResolver
): ToolHandler => async (args: unknown, ctx: ToolExecContext) => {
  const { customerId } = args as ListCustomerTanksArgs;
  const session = await resolveSession(ctx);
  const tanks = await session.apiClient.listCustomerTanks(customerId);
  return { tanks };
};

const makeValidateProductHandler = (
  resolveSession: RunsheetSessionResolver
): ToolHandler => async (args: unknown, ctx: ToolExecContext) => {
  const { productCode } = args as ValidateProductArgs;
  const session = await resolveSession(ctx);
  const valid = await session.apiClient.validateProduct(productCode);
  return { valid };
};

const makeCreateOrderDraftHandler = (
  resolveSession: RunsheetSessionResolver
): ToolHandler => async (args: unknown, ctx: ToolExecContext) => {
  const session = await resolveSession(ctx);
  // Build the TRANSIENT in-session draft (Req 5.8, 5.11, 20.3). buildOrderDraft
  // is pure and performs no persistence — the draft lives only in memory.
  const draft = buildOrderDraft(
    toOrderDraftInput(args as CreateOrderDraftArgs),
    session.tenantConfig
  );
  // Advance order_building → order_finalized (Req 7.2, 7.3). The session driver
  // captures `draft` for the dispatch-review fail-safe (Req 6.10).
  return { draft, phaseEvent: DRAFT_CREATED_EVENT };
};

const makeQueueDispatchReviewHandler = (
  resolveSession: RunsheetSessionResolver
): ToolHandler => async (_args: unknown, ctx: ToolExecContext) => {
  const session = await resolveSession(ctx);

  const draft = session.getDraft();
  if (!draft) {
    // No transient draft to submit: report unconfirmed placement so the session
    // driver retains state and applies the call-end escalation fail-safe
    // (Req 6.9, 6.10). Never fabricate or persist an order-of-record.
    return { placed: false, confirmed: false, error: "no_order_draft" };
  }

  const meta = session.intakeMeta;
  const now = meta.now ? meta.now() : Date.now();

  // Assemble the signed payload from the transient draft + the FULL confirmed
  // transcript content + call metadata (Req 6.8, 10.9, 18.2). The transcript is
  // read from the runtime's capture side-effect — no model tool produced it.
  const payload: VoiceIntakePayload = {
    schemaVersion: meta.schemaVersion,
    tenantId: ctx.tenantId,
    idempotencyKey: meta.idempotencyKey,
    timestamp: now,
    callId: ctx.callSid,
    transcriptId: meta.transcriptId,
    transcript: session.getTranscript(),
    recordingRef: meta.recordingRef,
    confidenceScore: draft.confidenceScore,
    agentId: meta.agentId,
    sessionId: meta.sessionId,
    callerPhone: meta.callerPhone,
    reviewRequired: meta.reviewRequired,
    extractedSlots: draft.slots,
  };

  const result: IntakeResult = await session.intakeClient.submit(
    payload,
    session.intakeSecret
  );
  const placed = result.status === "accepted";

  // `placed`/`confirmed` drive the session driver's placement fail-safe: on a
  // rejected submission the driver retains the transient draft for retry and
  // never persists it as a Dinee order-of-record (Req 6.8, 6.9, 6.10).
  return {
    placed,
    confirmed: placed,
    reference: result.reference,
    disposition: result.disposition,
    httpStatus: result.httpStatus,
    error: result.error,
  };
};

// ============================================================================
// Status_Agent read-only handlers (Req 14.1, 14.2)
// ============================================================================
//
// These serve the `runsheet_order_status` conversation. Each delegates to a
// read method on the per-call session's {@link RunsheetApiClient}; none mutates
// state and none advances a phase (the status conversation has a single phase).

const makeLookupOrderByPhoneHandler = (
  resolveSession: RunsheetSessionResolver
): ToolHandler => async (args: unknown, ctx: ToolExecContext) => {
  const { phone } = args as LookupOrderByPhoneArgs;
  const session = await resolveSession(ctx);
  const orders = await session.apiClient.lookupOrderByPhone(phone);
  return { orders };
};

const makeGetOrderStatusHandler = (
  resolveSession: RunsheetSessionResolver
): ToolHandler => async (args: unknown, ctx: ToolExecContext) => {
  const { orderId } = args as OrderIdArgs;
  const session = await resolveSession(ctx);
  return session.apiClient.getOrderStatus(orderId);
};

const makeGetEtaHandler = (
  resolveSession: RunsheetSessionResolver
): ToolHandler => async (args: unknown, ctx: ToolExecContext) => {
  const { orderId } = args as OrderIdArgs;
  const session = await resolveSession(ctx);
  return session.apiClient.getEta(orderId);
};

const makeGetRecentDeliveriesHandler = (
  resolveSession: RunsheetSessionResolver
): ToolHandler => async (args: unknown, ctx: ToolExecContext) => {
  const { customerId, limit } = args as RecentDeliveriesArgs;
  const session = await resolveSession(ctx);
  const deliveries = await session.apiClient.getRecentDeliveries(customerId, limit);
  return { deliveries };
};

/**
 * Registers every Runsheet tool handler with the tool-executor registry — the
 * six fuel-intake handlers plus the four read-only Status_Agent handlers
 * (Req 14.1, 14.2). Safe to call more than once — `registerToolHandler` replaces
 * any existing entry for a key, so repeated registration is idempotent.
 *
 * @param resolveSession Resolver for the per-call {@link RunsheetCallSession}.
 *   Defaults to the module-level registry populated by
 *   {@link bindRunsheetCallSession}; tests may inject a resolver directly.
 */
export function registerRunsheetHandlers(
  resolveSession: RunsheetSessionResolver = defaultResolveSession
): void {
  registerToolHandler(
    "runsheet_lookup_customer",
    makeLookupCustomerHandler(resolveSession)
  );
  registerToolHandler(
    "runsheet_list_customer_sites",
    makeListCustomerSitesHandler(resolveSession)
  );
  registerToolHandler(
    "runsheet_list_customer_tanks",
    makeListCustomerTanksHandler(resolveSession)
  );
  registerToolHandler(
    "runsheet_validate_product",
    makeValidateProductHandler(resolveSession)
  );
  registerToolHandler(
    "runsheet_create_order_draft",
    makeCreateOrderDraftHandler(resolveSession)
  );
  registerToolHandler(
    "runsheet_queue_dispatch_review",
    makeQueueDispatchReviewHandler(resolveSession)
  );

  // Status_Agent read-only handlers for the `runsheet_order_status` conversation
  // (Req 14.1, 14.2). They read from the same per-call session's api client.
  registerToolHandler(
    "runsheet_lookup_order_by_phone",
    makeLookupOrderByPhoneHandler(resolveSession)
  );
  registerToolHandler(
    "runsheet_get_order_status",
    makeGetOrderStatusHandler(resolveSession)
  );
  registerToolHandler("runsheet_get_eta", makeGetEtaHandler(resolveSession));
  registerToolHandler(
    "runsheet_get_recent_deliveries",
    makeGetRecentDeliveriesHandler(resolveSession)
  );
}
