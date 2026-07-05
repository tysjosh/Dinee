/**
 * Restaurant Pack — inbound-order tool definitions.
 *
 * Re-expresses the legacy restaurant tool set inlined in
 * `src/app/ws-server/index.ts` (the `restaurantTools` array) against the
 * {@link VoiceToolDefinition} contract (Req 1.4, 1.6). Tool names, descriptions,
 * and parameter schemas are preserved verbatim so the restaurant compatibility
 * test (task 4.2) can assert equivalence against the Phase 0 baseline.
 *
 * Each tool's `allowedPhases` mirrors the legacy `call-phase.ts` `ALLOWED_TOOLS`
 * map so phase gating is identical once enforced by the registry's
 * `isToolCallPermitted`:
 * - await_restaurant_id: get_restaurant_details
 * - restaurant_verified: upsert_call_data, add_transcript_dialogue, generate_order_id
 * - order_open:          upsert_order, add_transcript_dialogue, generate_order_id
 * - order_finalized:     add_transcript_dialogue
 *
 * The restaurant flow uses the internal Dinee API and requires no external
 * integration, so no tool declares `requiresIntegration`. The `handler` key on
 * each tool resolves to the implementation registered by `handlers.ts` through
 * the runtime tool executor.
 *
 * Requirements: 1.4, 1.6
 */

import type { VoiceToolDefinition } from "@/lib/modules/voiceDomainPack";
import {
  AWAIT_RESTAURANT_ID_PHASE,
  RESTAURANT_VERIFIED_PHASE,
  ORDER_OPEN_PHASE,
  ORDER_FINALIZED_PHASE,
} from "@/lib/modules/packs/restaurant/phases";

/**
 * Fetch a restaurant's profile and menu by id. Read-only; permitted only in the
 * initial `await_restaurant_id` phase, where a successful fetch verifies the
 * restaurant and advances the phase (legacy `restaurant_verified` event).
 */
export const getRestaurantDetailsTool: VoiceToolDefinition = {
  name: "get_restaurant_details",
  description: "Fetch restaurant profile and menu for a given restaurant ID",
  parameters: {
    type: "object",
    properties: { restaurant_id: { type: "string" } },
    required: ["restaurant_id"],
  },
  allowedPhases: [AWAIT_RESTAURANT_ID_PHASE],
  readOnly: true,
  handler: "get_restaurant_details",
};

/**
 * Insert or update the call row shown on the restaurant dashboard. Mutation;
 * permitted only once the restaurant is verified (legacy `restaurant_verified`
 * phase).
 */
export const upsertCallDataTool: VoiceToolDefinition = {
  name: "upsert_call_data",
  description: "Insert or update a call row in the Convex `calls` table",
  parameters: {
    type: "object",
    properties: {
      restaurantId: {
        type: "string",
        description:
          "5-digit restaurant ID. This will be the same restaurant id provided by the user.",
      },
      orderId: { type: "string", description: "The generated order id." },
    },
    required: ["restaurantId"],
  },
  allowedPhases: [RESTAURANT_VERIFIED_PHASE],
  readOnly: false,
  handler: "upsert_call_data",
};

/**
 * Append a spoken dialogue turn to the live transcript. Permitted across the
 * post-verification phases (legacy: restaurant_verified, order_open,
 * order_finalized) so the dashboard reflects the full conversation.
 */
export const addTranscriptDialogueTool: VoiceToolDefinition = {
  name: "add_transcript_dialogue",
  description:
    "Use this tool always for appending the ai message. This ai message is the one that you speak to the user. Take a moment, think what to speak and then use this tool to add the response that you provided to the user. Make sure to use this tool. Once the restaurant id is confirmed and validated use this tool to update the messages you convey to the user.",
  parameters: {
    type: "object",
    properties: {
      dialogue: {
        type: "string",
        description:
          "Make sure not to change anything in the dialogues, direct as it is said to the user.",
      },
      speaker: { type: "string", enum: ["ai", "human"] },
    },
    required: ["dialogue", "speaker"],
  },
  allowedPhases: [
    RESTAURANT_VERIFIED_PHASE,
    ORDER_OPEN_PHASE,
    ORDER_FINALIZED_PHASE,
  ],
  readOnly: false,
  handler: "add_transcript_dialogue",
};

/**
 * Insert or update a food order. Mutation; permitted only while an order is
 * open (legacy `order_open` phase). Completing an order advances the phase to
 * the terminal `order_finalized`.
 */
export const upsertOrderTool: VoiceToolDefinition = {
  name: "upsert_order",
  description: "Insert or update a food order in the Convex `orders` table",
  parameters: {
    type: "object",
    properties: {
      orderId: { type: "string", description: "4-digit ID you gave to the caller" },
      restaurantId: { type: "string", description: "Restaurant ID" },
      customerName: { type: "string", description: "Customer's name" },
      items: {
        type: "array",
        description: "One row per menu item",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            quantity: { type: "integer" },
            price: { type: "number" },
          },
          required: ["name", "quantity", "price"],
        },
      },
      specialInstructions: {
        type: "string",
        description:
          "Overall instructions about a dish/order/anything that is extra and needs restaurant's attention to complete the order with ease.",
      },
      status: { type: "string", enum: ["active", "completed", "cancelled"] },
    },
    required: ["orderId", "restaurantId", "customerName", "items", "status"],
  },
  allowedPhases: [ORDER_OPEN_PHASE],
  readOnly: false,
  handler: "upsert_order",
};

/**
 * Generate a unique order id (internal id + customer-facing public code).
 * Permitted once the restaurant is verified and while an order is open (legacy
 * restaurant_verified, order_open phases). Generating an id advances
 * restaurant_verified → order_open (legacy `order_id_generated` event).
 */
export const generateOrderIdTool: VoiceToolDefinition = {
  name: "generate_order_id",
  description:
    "Generate a unique order ID. Returns an internal orderId for API lookups and a publicOrderCode (6-char alphanumeric) to read back to the customer as their order reference.",
  parameters: { type: "object", properties: {}, required: [] },
  allowedPhases: [RESTAURANT_VERIFIED_PHASE, ORDER_OPEN_PHASE],
  readOnly: false,
  handler: "generate_order_id",
};

/**
 * The complete restaurant inbound-order tool set, in the legacy declaration
 * order (`restaurantTools`). The pack exposes these through the VoiceDomainPack
 * contract; phase gating is enforced by each tool's `allowedPhases`.
 */
export const restaurantTools: readonly VoiceToolDefinition[] = [
  getRestaurantDetailsTool,
  upsertCallDataTool,
  addTranscriptDialogueTool,
  upsertOrderTool,
  generateOrderIdTool,
];
