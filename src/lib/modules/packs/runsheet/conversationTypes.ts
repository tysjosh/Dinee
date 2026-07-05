/**
 * Runsheet Pack — conversation type definitions.
 *
 * Declares EXACTLY the four conversation types the Runsheet_Pack owns, and no
 * others (Req 4.1):
 *   - runsheet_fuel_order_intake
 *   - runsheet_order_status
 *   - runsheet_driver_exception
 *   - runsheet_dispatch_callback
 *
 * Each definition provides its `initialPhase`, `transcriptMetadata` shape, and
 * `fallbackBehavior` (Req 2.7). Phase ids referenced here are defined by the
 * sibling `phases.ts` module (task 6.2); they are referenced by string and must
 * remain consistent with the phase machine declared there.
 *
 * Requirements: 4.1
 */

import type { ConversationTypeDefinition } from "@/lib/modules/voiceDomainPack";
import { RUNSHEET_DRIVER_EXCEPTION_PROMPT } from "@/lib/modules/packs/runsheet/prompts";

/**
 * Phase ids referenced by the conversation types below. Declared as string
 * constants so this module and the sibling `phases.ts` (task 6.2) refer to the
 * same phase ids without drift. The pack registry validates that each
 * `initialPhase` is present in the pack's declared phases (Req 4.1, design §5).
 */
const PHASE_CUSTOMER_IDENTIFICATION = "customer_identification";
const PHASE_STATUS_LOOKUP = "status_lookup";
const PHASE_DRIVER_VERIFICATION = "driver_verification";
const PHASE_CALLBACK_IDENTIFICATION = "callback_identification";

/**
 * Fuel order intake (Req 4.1, 5.x, 6.1, 7.x). Starts in customer identification
 * and, when the agent cannot proceed, escalates/transfers per the tenant's
 * configured Escalation_Target rather than silently dropping the session.
 */
export const runsheetFuelOrderIntake: ConversationTypeDefinition = {
  type: "runsheet_fuel_order_intake",
  initialPhase: PHASE_CUSTOMER_IDENTIFICATION,
  transcriptMetadata: {
    fields: {
      customerId: { label: "Customer", type: "string", required: false },
      deliverySiteId: { label: "Delivery site", type: "string", required: false },
      productCode: { label: "Product code", type: "string", required: false },
      urgency: { label: "Urgency", type: "string", required: false },
      confidenceScore: { label: "Confidence score", type: "number", required: false },
    },
  },
  fallbackBehavior: { kind: "escalate" },
};

/**
 * Read-only order status lookups handled by the Status_Agent (Req 4.1, 14.x).
 * Callers are matched by phone, so caller phone is the required metadata anchor.
 */
export const runsheetOrderStatus: ConversationTypeDefinition = {
  type: "runsheet_order_status",
  initialPhase: PHASE_STATUS_LOOKUP,
  transcriptMetadata: {
    fields: {
      callerPhone: { label: "Caller phone", type: "string", required: true },
      orderId: { label: "Order", type: "string", required: false },
    },
  },
  fallbackBehavior: { kind: "escalate" },
};

/**
 * Driver exception reporting handled by the Driver_Agent (Req 4.1, 15.x). Starts
 * in driver verification; reporting tools are gated until identity is confirmed
 * and an active assignment is present.
 */
export const runsheetDriverException: ConversationTypeDefinition = {
  type: "runsheet_driver_exception",
  prompt: RUNSHEET_DRIVER_EXCEPTION_PROMPT,
  initialPhase: PHASE_DRIVER_VERIFICATION,
  transcriptMetadata: {
    fields: {
      driverId: { label: "Driver", type: "string", required: false },
      assignmentId: { label: "Active assignment", type: "string", required: false },
      exceptionType: { label: "Exception type", type: "string", required: false },
    },
  },
  fallbackBehavior: { kind: "escalate" },
};

/**
 * Dispatch callback conversation (Req 4.1). Starts by identifying the party the
 * callback concerns, then escalates/transfers when the agent cannot proceed.
 */
export const runsheetDispatchCallback: ConversationTypeDefinition = {
  type: "runsheet_dispatch_callback",
  initialPhase: PHASE_CALLBACK_IDENTIFICATION,
  transcriptMetadata: {
    fields: {
      callbackId: { label: "Callback reference", type: "string", required: false },
      customerId: { label: "Customer", type: "string", required: false },
    },
  },
  fallbackBehavior: { kind: "escalate" },
};

/**
 * The complete, ordered set of conversation types the Runsheet_Pack declares.
 * This array is EXACTLY the four types required by Req 4.1 — no others. The pack
 * assembly module (`index.ts`) uses this as the pack's `conversationTypes`.
 */
export const runsheetConversationTypes: readonly ConversationTypeDefinition[] = [
  runsheetFuelOrderIntake,
  runsheetOrderStatus,
  runsheetDriverException,
  runsheetDispatchCallback,
];
