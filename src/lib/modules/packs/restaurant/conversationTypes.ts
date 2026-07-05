/**
 * Restaurant Pack — conversation type definitions.
 *
 * Declares the restaurant conversation types owned by the pack, aligned with
 * the platform `ConversationType` union
 * (`src/lib/call-routing/phone-lookup.ts`) and the Convex
 * `conversationTypeValidator`:
 *   - restaurant_inbound_order  (primary inbound order flow)
 *   - restaurant_followup       (outbound callback to clarify an order)
 *   - restaurant_cancellation   (outbound callback to notify of a cancellation)
 *
 * Each definition provides its `initialPhase` (from the sibling `phases.ts`),
 * its per-conversation prompt override (from `prompts.ts`), a
 * `transcriptMetadata` shape, and a `fallbackBehavior` (Req 2.7). This
 * re-expresses the restaurant conversation routing previously branched inline in
 * `src/app/ws-server/index.ts` against the {@link ConversationTypeDefinition}
 * contract (Req 1.4, 1.6).
 *
 * Requirements: 1.4, 1.6
 */

import type { ConversationTypeDefinition } from "@/lib/modules/voiceDomainPack";
import {
  AWAIT_RESTAURANT_ID_PHASE,
  ORDER_OPEN_PHASE,
  ORDER_FINALIZED_PHASE,
} from "@/lib/modules/packs/restaurant/phases";
import {
  RESTAURANT_INBOUND_ORDER_PROMPT,
  RESTAURANT_FOLLOWUP_PROMPT,
  RESTAURANT_CANCELLATION_PROMPT,
} from "@/lib/modules/packs/restaurant/prompts";

/** Transcript metadata shared by the restaurant conversation types. */
const restaurantTranscriptMetadata = {
  fields: {
    restaurantId: { label: "Restaurant", type: "string", required: false },
    orderId: { label: "Order", type: "string", required: false },
    customerName: { label: "Customer name", type: "string", required: false },
  },
} as const;

/**
 * Primary inbound-order conversation. Starts in `await_restaurant_id`; the agent
 * greets, collects the restaurant id, fetches details, and takes the order.
 */
export const restaurantInboundOrder: ConversationTypeDefinition = {
  type: "restaurant_inbound_order",
  prompt: RESTAURANT_INBOUND_ORDER_PROMPT,
  initialPhase: AWAIT_RESTAURANT_ID_PHASE,
  transcriptMetadata: restaurantTranscriptMetadata,
  fallbackBehavior: { kind: "escalate" },
};

/**
 * Follow-up (outbound callback) conversation. The order already exists and is
 * being clarified, so the session begins in `order_open` where `upsert_order`
 * is permitted.
 */
export const restaurantFollowup: ConversationTypeDefinition = {
  type: "restaurant_followup",
  prompt: RESTAURANT_FOLLOWUP_PROMPT,
  initialPhase: ORDER_OPEN_PHASE,
  transcriptMetadata: restaurantTranscriptMetadata,
  fallbackBehavior: { kind: "escalate" },
};

/**
 * Cancellation (outbound notify) conversation. The order was already cancelled
 * by the restaurant; the agent only informs the customer, so the session begins
 * in the terminal `order_finalized` phase where dialogue capture is permitted
 * but order mutations are not.
 */
export const restaurantCancellation: ConversationTypeDefinition = {
  type: "restaurant_cancellation",
  prompt: RESTAURANT_CANCELLATION_PROMPT,
  initialPhase: ORDER_FINALIZED_PHASE,
  transcriptMetadata: restaurantTranscriptMetadata,
  fallbackBehavior: { kind: "apologize_and_end" },
};

/**
 * The complete, ordered set of restaurant conversation types the pack declares.
 */
export const restaurantConversationTypes: readonly ConversationTypeDefinition[] = [
  restaurantInboundOrder,
  restaurantFollowup,
  restaurantCancellation,
];
