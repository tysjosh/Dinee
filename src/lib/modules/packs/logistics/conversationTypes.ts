/**
 * Logistics pack — conversation type definitions (extracted from the runtime).
 *
 * Declares the three logistics conversation types the runtime routes today
 * (see `src/lib/call-routing/phone-lookup.ts` and the `isLogistics` branch in
 * `src/app/ws-server/index.ts`):
 *   - logistics_booking        (default — new shipment)
 *   - logistics_followup       (existing shipment follow-up)
 *   - logistics_failure_notice (outbound delivery-failure notification)
 *
 * Each starts in the `await_org_verification` phase, matching the legacy
 * `logisticsPhase` default, and carries its subtype-specific prompt override so
 * the resolved pack drives the agent exactly as the legacy inline selection did
 * (Req 1.4, 1.6).
 *
 * Requirements: 1.4, 1.6
 */

import type { ConversationTypeDefinition } from "@/lib/modules/voiceDomainPack";
import { AWAIT_ORG_VERIFICATION_PHASE } from "@/lib/modules/packs/logistics/phases";
import {
  LOGISTICS_BOOKING_PROMPT,
  LOGISTICS_FOLLOWUP_PROMPT,
  LOGISTICS_FAILURE_NOTICE_PROMPT,
} from "@/lib/modules/packs/logistics/prompts";

/** Transcript metadata shared by the logistics conversations (Req 2.7). */
const logisticsTranscriptMetadata = {
  fields: {
    organizationId: { label: "Organization", type: "string" as const, required: false },
    shipmentId: { label: "Shipment", type: "string" as const, required: false },
    serviceType: { label: "Service type", type: "string" as const, required: false },
  },
};

/** New-shipment booking conversation (default logistics route). */
export const logisticsBooking: ConversationTypeDefinition = {
  type: "logistics_booking",
  prompt: LOGISTICS_BOOKING_PROMPT,
  initialPhase: AWAIT_ORG_VERIFICATION_PHASE,
  transcriptMetadata: logisticsTranscriptMetadata,
  fallbackBehavior: { kind: "apologize_and_end" },
};

/** Follow-up on an existing shipment. */
export const logisticsFollowup: ConversationTypeDefinition = {
  type: "logistics_followup",
  prompt: LOGISTICS_FOLLOWUP_PROMPT,
  initialPhase: AWAIT_ORG_VERIFICATION_PHASE,
  transcriptMetadata: logisticsTranscriptMetadata,
  fallbackBehavior: { kind: "apologize_and_end" },
};

/** Outbound delivery-failure notification. */
export const logisticsFailureNotice: ConversationTypeDefinition = {
  type: "logistics_failure_notice",
  prompt: LOGISTICS_FAILURE_NOTICE_PROMPT,
  initialPhase: AWAIT_ORG_VERIFICATION_PHASE,
  transcriptMetadata: logisticsTranscriptMetadata,
  fallbackBehavior: { kind: "apologize_and_end" },
};

/** The complete set of conversation types the logistics pack owns. */
export const logisticsConversationTypes: readonly ConversationTypeDefinition[] = [
  logisticsBooking,
  logisticsFollowup,
  logisticsFailureNotice,
];
