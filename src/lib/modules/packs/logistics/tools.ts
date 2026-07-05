/**
 * Logistics pack — voice tool definitions (extracted from the legacy runtime).
 *
 * Re-expresses the logistics tool set currently inlined in
 * `src/app/ws-server/index.ts` (and backed by the wrapper functions in
 * `src/app/ws-server/logistics-tools.ts`) as VoiceDomainPack
 * {@link VoiceToolDefinition}s. Part of the GRADUAL extraction (Req 1.4, 1.6):
 * the legacy inline tool array and wrappers stay intact and working until the
 * compatibility test (task 4.4) passes and legacy removal (task 4.8) runs.
 *
 * Each tool's `allowedPhases` mirrors the legacy `ALLOWED_TOOLS` matrix in
 * `logistics-call-phase.ts` exactly, so phase gating is preserved:
 * - await_org_verification: get_organization_details
 * - org_verified:           get_organization_details, create_shipment, quote_delivery
 * - shipment_open:          + update_shipment, assign_rider, add_shipment_event
 * - shipment_confirmed:     get_organization_details, quote_delivery (read-only)
 *
 * Module bridge (Req 2.9): the five tools that have a counterpart in the
 * existing logistics tool-pack registration (`create_shipment`,
 * `update_shipment`, `assign_rider`, `add_shipment_event`, `quote_delivery`)
 * set `reusesModuleTool` so the registry reuses that registration rather than
 * duplicating it. `get_organization_details` has no module counterpart, so it
 * is a voice-only tool carried through the bridge's `extend` mode.
 *
 * The parameter schemas are copied verbatim from the runtime's inline
 * definitions so the tool surface exposed to the model is unchanged.
 *
 * Requirements: 1.4, 1.6, 2.9
 */

import type { VoiceToolDefinition } from "@/lib/modules/voiceDomainPack";
import {
  AWAIT_ORG_VERIFICATION_PHASE,
  ORG_VERIFIED_PHASE,
  SHIPMENT_OPEN_PHASE,
  SHIPMENT_CONFIRMED_PHASE,
} from "@/lib/modules/packs/logistics/phases";

/**
 * Look up a logistics organization by ID to verify the caller's company.
 * Read-only; permitted in every phase (the caller may re-verify at any point).
 * Voice-only — it has no counterpart in the logistics tool-pack registration,
 * so it carries no `reusesModuleTool` and is surfaced via the bridge's `extend`
 * mode.
 */
export const logisticsGetOrganizationDetails: VoiceToolDefinition = {
  name: "get_organization_details",
  description:
    "Look up a logistics organization by ID to verify the caller's company",
  parameters: {
    type: "object",
    properties: {
      organization_id: {
        type: "string",
        description: "The organization ID to look up",
      },
    },
    required: ["organization_id"],
  },
  allowedPhases: [
    AWAIT_ORG_VERIFICATION_PHASE,
    ORG_VERIFIED_PHASE,
    SHIPMENT_OPEN_PHASE,
    SHIPMENT_CONFIRMED_PHASE,
  ],
  readOnly: true,
  handler: "get_organization_details",
};

/**
 * Create a new shipment for delivery. Mutation; permitted once the organization
 * is verified (org_verified) and while a shipment is open. Reuses the existing
 * logistics tool-pack `create_shipment` registration (Req 2.9).
 */
export const logisticsCreateShipment: VoiceToolDefinition = {
  name: "create_shipment",
  description: "Create a new shipment for delivery",
  parameters: {
    type: "object",
    properties: {
      shipmentId: { type: "string", description: "Unique shipment identifier" },
      organizationId: { type: "string", description: "Organization ID" },
      sender: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
        },
        required: ["name", "phone", "address", "city", "state"],
      },
      recipient: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
        },
        required: ["name", "phone", "address", "city", "state"],
      },
      parcel: {
        type: "object",
        properties: {
          type: { type: "string" },
          weightKg: { type: "number" },
          notes: { type: "string" },
        },
        required: ["type"],
      },
      serviceType: {
        type: "string",
        enum: ["same_day", "next_day", "express", "scheduled"],
      },
    },
    required: [
      "shipmentId",
      "organizationId",
      "sender",
      "recipient",
      "parcel",
      "serviceType",
    ],
  },
  allowedPhases: [ORG_VERIFIED_PHASE, SHIPMENT_OPEN_PHASE],
  readOnly: false,
  handler: "create_shipment",
  reusesModuleTool: "create_shipment",
};

/**
 * Get a delivery cost and ETA estimate. Read-only; permitted from org
 * verification through shipment confirmation. Reuses the existing logistics
 * tool-pack `quote_delivery` registration (Req 2.9).
 */
export const logisticsQuoteDelivery: VoiceToolDefinition = {
  name: "quote_delivery",
  description:
    "Get a delivery cost and ETA estimate based on sender/recipient locations and service type",
  parameters: {
    type: "object",
    properties: {
      sender: {
        type: "object",
        properties: {
          city: { type: "string" },
          state: { type: "string" },
        },
        required: ["city", "state"],
      },
      recipient: {
        type: "object",
        properties: {
          city: { type: "string" },
          state: { type: "string" },
        },
        required: ["city", "state"],
      },
      serviceType: {
        type: "string",
        enum: ["same_day", "next_day", "express", "scheduled"],
      },
    },
    required: ["sender", "recipient", "serviceType"],
  },
  allowedPhases: [
    ORG_VERIFIED_PHASE,
    SHIPMENT_OPEN_PHASE,
    SHIPMENT_CONFIRMED_PHASE,
  ],
  readOnly: true,
  handler: "quote_delivery",
  reusesModuleTool: "quote_delivery",
};

/**
 * Update a shipment's status or details. Mutation; permitted only while a
 * shipment is open. Reuses the existing logistics tool-pack `update_shipment`
 * registration (Req 2.9).
 */
export const logisticsUpdateShipment: VoiceToolDefinition = {
  name: "update_shipment",
  description: "Update a shipment's status or details",
  parameters: {
    type: "object",
    properties: {
      shipmentId: { type: "string" },
      newStatus: {
        type: "string",
        enum: [
          "created",
          "assigned",
          "picked_up",
          "in_transit",
          "delivered",
          "failed",
          "cancelled",
        ],
      },
      failureReason: { type: "string" },
    },
    required: ["shipmentId", "newStatus"],
  },
  allowedPhases: [SHIPMENT_OPEN_PHASE],
  readOnly: false,
  handler: "update_shipment",
  reusesModuleTool: "update_shipment",
};

/**
 * Assign an available rider to a shipment. Mutation; permitted only while a
 * shipment is open. Reuses the existing logistics tool-pack `assign_rider`
 * registration (Req 2.9).
 */
export const logisticsAssignRider: VoiceToolDefinition = {
  name: "assign_rider",
  description: "Assign an available rider to a shipment",
  parameters: {
    type: "object",
    properties: {
      shipmentId: { type: "string" },
      riderId: { type: "string" },
    },
    required: ["shipmentId", "riderId"],
  },
  allowedPhases: [SHIPMENT_OPEN_PHASE],
  readOnly: false,
  handler: "assign_rider",
  reusesModuleTool: "assign_rider",
};

/**
 * Add an event to the shipment's audit log. Mutation; permitted only while a
 * shipment is open. Reuses the existing logistics tool-pack `add_shipment_event`
 * registration (Req 2.9).
 */
export const logisticsAddShipmentEvent: VoiceToolDefinition = {
  name: "add_shipment_event",
  description: "Add an event to the shipment's audit log",
  parameters: {
    type: "object",
    properties: {
      shipmentId: { type: "string" },
      eventType: { type: "string" },
      payload: { type: "object" },
    },
    required: ["shipmentId", "eventType"],
  },
  allowedPhases: [SHIPMENT_OPEN_PHASE],
  readOnly: false,
  handler: "add_shipment_event",
  reusesModuleTool: "add_shipment_event",
};

/**
 * The complete logistics voice tool set, in the order the legacy runtime
 * declared them. Five of the six tools reuse the existing logistics tool-pack
 * registration through `reusesModuleTool`; `get_organization_details` is the
 * one voice-only tool carried by the bridge's `extend` mode.
 */
export const logisticsTools: readonly VoiceToolDefinition[] = [
  logisticsGetOrganizationDetails,
  logisticsCreateShipment,
  logisticsQuoteDelivery,
  logisticsUpdateShipment,
  logisticsAssignRider,
  logisticsAddShipmentEvent,
];
