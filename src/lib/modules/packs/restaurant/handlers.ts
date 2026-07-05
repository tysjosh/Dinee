/**
 * Restaurant Pack — tool handler implementations and utilities.
 *
 * Re-expresses the real restaurant handlers, retry/fetch logic, and id
 * utilities extracted from the legacy `src/app/ws-server/tools.ts` against the
 * runtime tool-executor contract (Req 1.4, 1.6). Each handler matches the
 * {@link ToolHandler} signature so the generic session driver can dispatch a
 * permitted restaurant tool call through {@link executeTool} without depending
 * on any restaurant-specific code.
 *
 * The legacy Voice_Runtime path (`index.ts` → `tools.ts`) is intentionally left
 * intact until the restaurant compatibility test (task 4.2) passes; these
 * handlers reproduce that behavior exactly (same endpoints, same payload
 * shape — the per-call `callId` is merged from the executor context just as the
 * legacy dispatch merged `callId: callSid`). Task 4.8 removes the legacy copy
 * once the compatibility test is green.
 *
 * Requirements: 1.4, 1.6
 */

import { nanoid } from "nanoid";
import { createLogger } from "@/lib/logger";
import {
  registerToolHandler,
  type ToolHandler,
  type ToolExecContext,
} from "@/app/ws-server/runtime/toolExecutor";
import {
  wrapperGetRestaurantDetails,
  wrapperUpsertCallData,
  wrapperAddTranscriptDialogues,
  wrapperUpsertOrders,
  type CallData,
  type TranscriptData,
  type OrderData,
} from "@/lib/modules/packs/restaurant/wrappers";

const logger = createLogger("restaurant-pack-handlers");

// --- Argument shapes (typed to avoid `any`) ---

interface GetRestaurantDetailsArgs {
  restaurant_id?: string;
}

// --- ID utilities (moved from legacy tools.ts) ---

/** Generates a high-entropy internal order id using nanoid. */
export function generateOrderId(): string {
  return `ord_${nanoid(16)}`;
}

/** Characters used for the customer-facing public code (no I/O/0/1). */
const PUBLIC_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generates a 6-char uppercase alphanumeric public order code for
 * customer-facing references (voice readback, dashboard display).
 */
export function generatePublicOrderCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += PUBLIC_CODE_CHARS[Math.floor(Math.random() * PUBLIC_CODE_CHARS.length)];
  }
  return code;
}

// --- Tool handlers (ToolHandler: (args, ctx) => Promise<unknown>) ---

/**
 * `get_restaurant_details` — fetch restaurant profile and menu by id. Delegates
 * to {@link wrapperGetRestaurantDetails}.
 */
export const getRestaurantDetailsHandler: ToolHandler = async (args) => {
  const { restaurant_id } = args as GetRestaurantDetailsArgs;
  return wrapperGetRestaurantDetails(restaurant_id ?? "");
};

/**
 * `upsert_call_data` — insert/update the dashboard call row. Delegates to
 * {@link wrapperUpsertCallData}, merging the per-call `callId` from the executor
 * context as the legacy dispatch did.
 */
export const upsertCallDataHandler: ToolHandler = async (
  args,
  ctx: ToolExecContext
) => {
  const callData = args as Omit<CallData, "callId">;
  return wrapperUpsertCallData({ ...callData, callId: ctx.callSid });
};

/**
 * `add_transcript_dialogue` — append a dialogue turn to the live transcript.
 * Delegates to {@link wrapperAddTranscriptDialogues}, merging `callId` from
 * context.
 */
export const addTranscriptDialogueHandler: ToolHandler = async (
  args,
  ctx: ToolExecContext
) => {
  const dialogueData = args as Omit<TranscriptData, "callId">;
  return wrapperAddTranscriptDialogues({ ...dialogueData, callId: ctx.callSid });
};

/**
 * `upsert_order` — insert/update a food order. Delegates to
 * {@link wrapperUpsertOrders}, merging `callId` from context.
 */
export const upsertOrderHandler: ToolHandler = async (
  args,
  ctx: ToolExecContext
) => {
  const orderData = args as Omit<OrderData, "callId">;
  return wrapperUpsertOrders({ ...orderData, callId: ctx.callSid });
};

/**
 * `generate_order_id` — produce an internal order id plus a public readback
 * code. Mirrors the legacy inline dispatch (`generateOrderId` +
 * `generatePublicOrderCode`).
 */
export const generateOrderIdHandler: ToolHandler = async () => {
  return { orderId: generateOrderId(), publicOrderCode: generatePublicOrderCode() };
};

/**
 * Registers every restaurant tool handler with the runtime tool executor. Call
 * this during platform initialization (alongside pack registration) so the
 * session driver can resolve restaurant tool calls by their `handler` key.
 */
export function registerRestaurantVoiceHandlers(): void {
  registerToolHandler("get_restaurant_details", getRestaurantDetailsHandler);
  registerToolHandler("upsert_call_data", upsertCallDataHandler);
  registerToolHandler("add_transcript_dialogue", addTranscriptDialogueHandler);
  registerToolHandler("upsert_order", upsertOrderHandler);
  registerToolHandler("generate_order_id", generateOrderIdHandler);
  logger.info("Registered restaurant voice tool handlers", {});
}
