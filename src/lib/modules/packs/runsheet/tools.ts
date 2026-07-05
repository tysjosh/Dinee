/**
 * Runsheet Pack — fuel-intake tool definitions (review-only MVP set).
 *
 * Declares EXACTLY the six tools that make up the review-only MVP fuel-intake
 * tool set (Req 6.1):
 *   - runsheet_lookup_customer        (read-only)
 *   - runsheet_list_customer_sites    (read-only)
 *   - runsheet_list_customer_tanks    (read-only)
 *   - runsheet_validate_product       (read-only)
 *   - runsheet_create_order_draft     (mutation)
 *   - runsheet_queue_dispatch_review  (mutation)
 *
 * Every tool declares `requiresIntegration: "runsheet"` so it is excluded from
 * the resolved tool set when the tenant's Runsheet_Integration is disabled or
 * absent (Req 4.4).
 *
 * LATER-PHASE tool (Auto_Submit, Req 13, task 12.1):
 * - `runsheet_submit_order` is the later-phase tool tied to Auto_Submit. It is
 *   defined here now that the Auto_Submit feature is delivered, but it is NOT a
 *   member of the review-only MVP six-tool set (`runsheetFuelIntakeTools`) and
 *   is gated behind a DISTINCT integration id (`runsheet_auto_submit`) rather
 *   than the base `runsheet` integration. Because `resolveToolSet` filters by
 *   `requiresIntegration`, the tool is only ever placed in the resolved tool
 *   set when the tenant's Auto_Submit feature is enabled (its enabled-
 *   integration list includes `runsheet_auto_submit`). A tenant with only the
 *   base `runsheet` integration enabled still resolves EXACTLY the six MVP
 *   tools, preserving the review-only invariant (Req 6.2, 13.5).
 *
 * Deliberate exclusions:
 * - There is NO model-invoked transcript-capture tool (e.g.
 *   `runsheet_append_call_transcript`). Transcript capture is a Voice_Runtime
 *   side-effect handled by the runtime's `transcriptBuffer` (Req 6.1, 18.1),
 *   not a tool the model calls.
 *
 * Phase gating (Req 7.1–7.3), enforced by the registry's `isToolCallPermitted`
 * against each tool's `allowedPhases`:
 * - customer_identification: lookup + site/tank listing (read-only) only.
 * - order_building:          product validation + order-draft creation.
 * - order_finalized (terminal): ONLY dispatch-review queueing.
 *
 * Phase ids are imported from the sibling `phases.ts` (task 6.2) so this module
 * and the phase machine never drift.
 *
 * Requirements: 6.1, 6.2, 7.1, 7.2, 7.3
 */

import type { VoiceToolDefinition } from "@/lib/modules/voiceDomainPack";
import {
  CUSTOMER_IDENTIFICATION_PHASE,
  ORDER_BUILDING_PHASE,
  ORDER_FINALIZED_PHASE,
} from "@/lib/modules/packs/runsheet/phases";

/** Integration id every Runsheet fuel-intake tool requires to be exposed (Req 4.4). */
const RUNSHEET_INTEGRATION_ID = "runsheet";

/**
 * Integration id that gates the later-phase Auto_Submit tool
 * (`runsheet_submit_order`, Req 13). It is DISTINCT from the base
 * `runsheet` integration so the tool is exposed only when a tenant has the
 * Auto_Submit feature enabled (its enabled-integration list includes this id).
 * Tenants with only the base integration enabled resolve exactly the six
 * review-only MVP tools (Req 6.2, 13.5).
 */
export const RUNSHEET_AUTO_SUBMIT_INTEGRATION_ID = "runsheet_auto_submit";

/**
 * Look up a Runsheet customer by phone number or account identifier (Req 6.3).
 * Read-only; permitted only in the customer-identification phase (Req 7.1). The
 * invocation requires at least one of `phone` or `accountId`; supplying neither
 * is rejected by the integration (Req 6.4).
 */
export const runsheetLookupCustomer: VoiceToolDefinition = {
  name: "runsheet_lookup_customer",
  description:
    "Look up a fuel customer by phone number or account identifier. Returns a single customer when exactly one matches, an ordered list when more than one matches, and an empty result when none match. Provide at least one of phone or accountId.",
  parameters: {
    type: "object",
    properties: {
      phone: {
        type: "string",
        description: "The caller's phone number, in any commonly spoken format.",
      },
      accountId: {
        type: "string",
        description: "The customer's Runsheet account identifier, if provided.",
      },
    },
    required: [],
  },
  allowedPhases: [CUSTOMER_IDENTIFICATION_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: true,
  handler: "runsheet_lookup_customer",
};

/**
 * List the delivery sites on file for an identified customer. Read-only;
 * permitted only in the customer-identification phase (Req 7.1).
 */
export const runsheetListCustomerSites: VoiceToolDefinition = {
  name: "runsheet_list_customer_sites",
  description:
    "List the delivery sites on file for an identified customer so the caller can confirm which site the fuel should be delivered to.",
  parameters: {
    type: "object",
    properties: {
      customerId: {
        type: "string",
        description: "The Runsheet customer identifier returned by runsheet_lookup_customer.",
      },
    },
    required: ["customerId"],
  },
  allowedPhases: [CUSTOMER_IDENTIFICATION_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: true,
  handler: "runsheet_list_customer_sites",
};

/**
 * List the tanks on file for an identified customer (optionally scoped to a
 * site). Read-only; permitted only in the customer-identification phase
 * (Req 7.1).
 */
export const runsheetListCustomerTanks: VoiceToolDefinition = {
  name: "runsheet_list_customer_tanks",
  description:
    "List the fuel tanks on file for an identified customer, optionally scoped to a delivery site, so the caller can confirm which tank the order is for.",
  parameters: {
    type: "object",
    properties: {
      customerId: {
        type: "string",
        description: "The Runsheet customer identifier returned by runsheet_lookup_customer.",
      },
      siteId: {
        type: "string",
        description: "Optional delivery site identifier to scope the tank list to a single site.",
      },
    },
    required: ["customerId"],
  },
  allowedPhases: [CUSTOMER_IDENTIFICATION_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: true,
  handler: "runsheet_list_customer_tanks",
};

/**
 * Validate a fuel product code for the tenant (Req 6.5). Read-only; permitted
 * only in the order-building phase (Req 7.2).
 */
export const runsheetValidateProduct: VoiceToolDefinition = {
  name: "runsheet_validate_product",
  description:
    "Validate a fuel product code for the tenant. Returns whether the product code is valid so an invalid product is not recorded on the order.",
  parameters: {
    type: "object",
    properties: {
      productCode: {
        type: "string",
        description: "The fuel product code to validate.",
      },
    },
    required: ["productCode"],
  },
  allowedPhases: [ORDER_BUILDING_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: true,
  handler: "runsheet_validate_product",
};

/**
 * Create the transient, non-authoritative in-session Order_Draft from the
 * collected slots (Req 5.8, 5.11). This is a MUTATION; permitted only in the
 * order-building phase (Req 7.2) and never before customer identification
 * completes (Req 7.4). The draft lives only in session memory — the Runsheet
 * backend is the system of record once submitted.
 */
export const runsheetCreateOrderDraft: VoiceToolDefinition = {
  name: "runsheet_create_order_draft",
  description:
    "Create the order draft from the collected fuel-order details once the required slots are gathered. Records the extracted slots, urgency, and a confidence score for dispatcher review.",
  parameters: {
    type: "object",
    properties: {
      customerId: {
        type: "string",
        description: "The identified customer's Runsheet identifier.",
      },
      deliverySiteId: {
        type: "string",
        description: "The delivery site the fuel should be delivered to.",
      },
      productCode: {
        type: "string",
        description: "The validated fuel product code.",
      },
      quantity: {
        type: "string",
        description: "The requested quantity in gallons, or a fill-to-full indication.",
      },
      deliveryWindow: {
        type: "string",
        description: "The requested delivery window.",
      },
      urgency: {
        type: "string",
        description: "The urgency level reported by the caller.",
        enum: ["normal", "urgent", "emergency"],
      },
      poNumber: {
        type: "string",
        description: "The purchase order number, where the tenant requires one.",
      },
    },
    required: ["customerId", "deliverySiteId", "productCode", "quantity", "deliveryWindow"],
  },
  allowedPhases: [ORDER_BUILDING_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: false,
  handler: "runsheet_create_order_draft",
};

/**
 * Submit the finalized transient Order_Draft to the Runsheet backend over the
 * Intake_Contract for placement in the Dispatcher_Review_Queue (Req 6.8). This
 * is a MUTATION and the ONLY tool permitted in the terminal `order_finalized`
 * phase (Req 7.3).
 */
export const runsheetQueueDispatchReview: VoiceToolDefinition = {
  name: "runsheet_queue_dispatch_review",
  description:
    "Submit the finalized order draft to the Runsheet backend so it is placed in the dispatcher review queue. Call this once the caller has confirmed the order details.",
  parameters: {
    type: "object",
    properties: {
      draftId: {
        type: "string",
        description: "The in-session identifier of the order draft to submit for review.",
      },
    },
    required: ["draftId"],
  },
  allowedPhases: [ORDER_FINALIZED_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: false,
  handler: "runsheet_queue_dispatch_review",
};

/**
 * The complete review-only MVP fuel-intake tool set — EXACTLY the six tools
 * required by Req 6.1, in phase order (customer identification → order building
 * → order finalized). No `runsheet_submit_order` (Req 6.2) and no transcript-
 * capture tool (Req 6.1, 18.1) appear here.
 */
export const runsheetFuelIntakeTools: readonly VoiceToolDefinition[] = [
  runsheetLookupCustomer,
  runsheetListCustomerSites,
  runsheetListCustomerTanks,
  runsheetValidateProduct,
  runsheetCreateOrderDraft,
  runsheetQueueDispatchReview,
];

/**
 * The later-phase Auto_Submit tool (Req 13.5). Submits a low-risk finalized
 * Order_Draft directly, bypassing the Dispatcher_Review_Queue, ONLY when the
 * auto-submit eligibility conjunction holds (see `autoSubmit.ts`, Req 13.1).
 *
 * This tool is NOT part of `runsheetFuelIntakeTools` (the six-tool review-only
 * MVP set, Req 6.1/6.2). It is a MUTATION permitted only in the terminal
 * `order_finalized` phase (Req 7.3) and requires the distinct
 * `runsheet_auto_submit` integration so `resolveToolSet` exposes it only when a
 * tenant has Auto_Submit enabled (Req 6.2, 13.5). Under `always_review` (or any
 * tenant without Auto_Submit enabled) it is never resolved, so the review-only
 * six-tool invariant is preserved.
 */
export const runsheetSubmitOrder: VoiceToolDefinition = {
  name: "runsheet_submit_order",
  description:
    "Submit a fully confirmed, low-risk fuel order directly to the Runsheet backend, bypassing dispatcher review. Only available when the tenant has auto-submit enabled and the order meets every low-risk condition; otherwise the order must be queued for dispatcher review instead.",
  parameters: {
    type: "object",
    properties: {
      draftId: {
        type: "string",
        description: "The in-session identifier of the finalized order draft to submit.",
      },
    },
    required: ["draftId"],
  },
  allowedPhases: [ORDER_FINALIZED_PHASE],
  requiresIntegration: RUNSHEET_AUTO_SUBMIT_INTEGRATION_ID,
  readOnly: false,
  handler: "runsheet_submit_order",
};
