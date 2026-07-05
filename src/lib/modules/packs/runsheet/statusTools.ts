/**
 * Runsheet Pack — Status_Agent read-only tool definitions (later phase, Req 14).
 *
 * Declares the four READ-ONLY tools the Status_Agent uses during a
 * `runsheet_order_status` conversation so a fuel customer can check their order
 * without a dispatcher (Req 14.1):
 *   - runsheet_lookup_order_by_phone   (read-only)
 *   - runsheet_get_order_status        (read-only)
 *   - runsheet_get_eta                 (read-only)
 *   - runsheet_get_recent_deliveries   (read-only)
 *
 * Every tool declares:
 * - `requiresIntegration: "runsheet"` so it is excluded from the resolved tool
 *   set when the tenant's Runsheet_Integration is disabled or absent (Req 4.4);
 * - `readOnly: true` — the Status_Agent performs no mutations. Any mutation tool
 *   requested during a `runsheet_order_status` conversation is rejected by the
 *   registry's `isToolCallPermitted`, because the fuel-intake mutation tools do
 *   not include the status phase in their `allowedPhases` (Req 14.3, Property 6);
 * - `allowedPhases: [STATUS_LOOKUP_PHASE]` — these tools are permitted only in
 *   the status-lookup phase, the initial (and only) phase of the
 *   `runsheet_order_status` conversation.
 *
 * These are a DIFFERENT conversation type from the fuel-intake flow: they are
 * declared on the pack alongside the six-tool fuel-intake set, but phase gating
 * keeps the two disjoint — the fuel phases never permit the status tools and the
 * status phase never permits the fuel tools.
 *
 * Requirements: 14.1, 14.2
 */

import type { VoiceToolDefinition } from "@/lib/modules/voiceDomainPack";

/** Integration id every Runsheet status tool requires to be exposed (Req 4.4). */
const RUNSHEET_INTEGRATION_ID = "runsheet";

/**
 * The phase the `runsheet_order_status` conversation starts in and the only
 * phase the read-only status tools are permitted in. Declared here as the single
 * source of truth; the pack assembly module (`index.ts`) uses this id for the
 * status-lookup phase definition, and `conversationTypes.ts` starts the
 * `runsheet_order_status` conversation here, so the three never drift.
 */
export const STATUS_LOOKUP_PHASE = "status_lookup";

/**
 * Look up a caller's fuel orders by phone number (Req 14.2). Read-only. Returns
 * an ordered list of matching orders when one or more match, and an empty result
 * when none match, within the runtime's 5s tool deadline.
 */
export const runsheetLookupOrderByPhone: VoiceToolDefinition = {
  name: "runsheet_lookup_order_by_phone",
  description:
    "Look up the caller's fuel orders by phone number. Returns an ordered list of matching orders (most recent first) when one or more match, and an empty result when none match.",
  parameters: {
    type: "object",
    properties: {
      phone: {
        type: "string",
        description: "The caller's phone number, in any commonly spoken format.",
      },
    },
    required: ["phone"],
  },
  allowedPhases: [STATUS_LOOKUP_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: true,
  handler: "runsheet_lookup_order_by_phone",
};

/**
 * Get the current status of a specific order (Req 14.1). Read-only.
 */
export const runsheetGetOrderStatus: VoiceToolDefinition = {
  name: "runsheet_get_order_status",
  description:
    "Get the current status of a specific fuel order so the caller can hear where their order stands.",
  parameters: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description: "The order identifier returned by runsheet_lookup_order_by_phone.",
      },
    },
    required: ["orderId"],
  },
  allowedPhases: [STATUS_LOOKUP_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: true,
  handler: "runsheet_get_order_status",
};

/**
 * Get the estimated delivery time for a specific order (Req 14.1). Read-only.
 */
export const runsheetGetEta: VoiceToolDefinition = {
  name: "runsheet_get_eta",
  description:
    "Get the estimated delivery time (ETA) for a specific fuel order so the caller knows when to expect delivery.",
  parameters: {
    type: "object",
    properties: {
      orderId: {
        type: "string",
        description: "The order identifier to fetch the estimated delivery time for.",
      },
    },
    required: ["orderId"],
  },
  allowedPhases: [STATUS_LOOKUP_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: true,
  handler: "runsheet_get_eta",
};

/**
 * List a customer's recent deliveries (Req 14.1). Read-only.
 */
export const runsheetGetRecentDeliveries: VoiceToolDefinition = {
  name: "runsheet_get_recent_deliveries",
  description:
    "List the customer's recent fuel deliveries, most recent first, so the caller can confirm past deliveries.",
  parameters: {
    type: "object",
    properties: {
      customerId: {
        type: "string",
        description: "The Runsheet customer identifier whose recent deliveries to list.",
      },
      limit: {
        type: "number",
        description: "Optional maximum number of recent deliveries to return.",
      },
    },
    required: ["customerId"],
  },
  allowedPhases: [STATUS_LOOKUP_PHASE],
  requiresIntegration: RUNSHEET_INTEGRATION_ID,
  readOnly: true,
  handler: "runsheet_get_recent_deliveries",
};

/**
 * The complete Status_Agent read-only tool set — EXACTLY the four tools required
 * by Req 14.1, in a natural conversational order (look up by phone → status →
 * ETA → recent deliveries). All are read-only and permitted only in the
 * status-lookup phase.
 */
export const runsheetStatusTools: readonly VoiceToolDefinition[] = [
  runsheetLookupOrderByPhone,
  runsheetGetOrderStatus,
  runsheetGetEta,
  runsheetGetRecentDeliveries,
];
