/**
 * Restaurant Pack — system prompts per conversation type.
 *
 * These prompts drive the spoken behavior of the restaurant Voice_Runtime
 * agents. They are the canonical restaurant prompts extracted from the legacy
 * Voice_Runtime (`src/app/ws-server/server-constants.ts` +
 * `src/app/ws-server/index.ts`) and re-expressed against the
 * {@link VoiceDomainPack} contract (Req 1.4, 1.6).
 *
 * The gradual-extraction plan (design §"Migration Plan") keeps the legacy
 * runtime path intact until the restaurant compatibility test (task 4.2)
 * passes, so these prompts import the canonical constants from
 * `server-constants` rather than duplicating the long prompt text. This keeps a
 * single source of truth and prevents drift while both paths coexist.
 *
 * Requirements: 1.4, 1.6
 */

import {
  SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  CANCELLATION_SYSTEM_PROMPT,
} from "@/app/ws-server/server-constants";

/**
 * The primary inbound-order system prompt (legacy `SYSTEM_PROMPT`). Drives the
 * restaurant-id → order-open → order-finalized flow: greet, collect the
 * restaurant id, fetch restaurant details, take the order, and record it.
 */
export const RESTAURANT_INBOUND_ORDER_PROMPT = SYSTEM_PROMPT;

/**
 * The follow-up (outbound callback) prompt (legacy `FOLLOWUP_SYSTEM_PROMPT`).
 * Used when the agent calls a customer back to clarify an existing order and
 * updates it via `upsert_order`.
 */
export const RESTAURANT_FOLLOWUP_PROMPT = FOLLOWUP_SYSTEM_PROMPT;

/**
 * The cancellation (outbound notify) prompt (legacy
 * `CANCELLATION_SYSTEM_PROMPT`). Used when the agent calls a customer to inform
 * them a restaurant cancelled their order.
 */
export const RESTAURANT_CANCELLATION_PROMPT = CANCELLATION_SYSTEM_PROMPT;

/**
 * Default restaurant system prompt used when a conversation type omits its own.
 * The inbound-order conversation is the primary flow, so the default falls back
 * to the inbound-order behavior.
 */
export const RESTAURANT_DEFAULT_PROMPT = RESTAURANT_INBOUND_ORDER_PROMPT;
