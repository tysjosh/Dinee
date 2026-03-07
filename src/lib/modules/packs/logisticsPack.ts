/**
 * Logistics Vertical Pack
 *
 * Provides logistics-specific features as an activatable module pack:
 * shipment lifecycle management, rider assignment and dispatch,
 * delivery status tracking, ETA inquiries, and Runsheet Connect
 * integration for automated dispatch.
 *
 * Requirements: 5A, 5B, 5C, 5D, 9.3, 10.3, 13.3
 */

import type {
  VerticalPack,
  PromptPack,
  IntentDefinition,
  ToolDefinition,
  UISectionDescriptor,
  AnalyticsQueryDescriptor,
  IntegrationHook,
} from "../types";
import { registerPromptPack } from "../promptPackRegistry";
import { registerToolPack } from "../toolPackRegistry";
import { registerUISections } from "../uiSectionRegistry";

// --- Intents (Req 9.3, 5C) ---

const logisticsIntents: IntentDefinition[] = [
  {
    name: "shipment_status_inquiry",
    description:
      "Customer asks about the current status and ETA of a shipment by tracking number or phone",
    requiredSlots: ["trackingNumberOrPhone"],
    handler: "api/intents/logistics/shipmentStatusInquiry",
  },
  {
    name: "pickup_scheduling",
    description:
      "Customer wants to schedule a new pickup, creating a shipment with origin, destination, and pickup time",
    requiredSlots: ["origin", "destination", "pickupTime"],
    handler: "api/intents/logistics/pickupScheduling",
  },
  {
    name: "failed_delivery_callback",
    description:
      "Customer reports a failed delivery, logs the reason, and schedules redelivery or callback",
    requiredSlots: ["shipmentId", "failureReason"],
    handler: "api/intents/logistics/failedDeliveryCallback",
  },
  {
    name: "rider_eta_inquiry",
    description:
      "Customer asks about the assigned rider's estimated arrival time",
    requiredSlots: ["shipmentId"],
    handler: "api/intents/logistics/riderEtaInquiry",
  },
  {
    name: "general_inquiry",
    description:
      "General questions about the logistics service such as coverage areas, pricing, or policies",
    requiredSlots: [],
    handler: "api/intents/logistics/generalInquiry",
  },
];

// --- Prompt Pack (Req 9.3) ---

const logisticsPromptPack: PromptPack = {
  systemPrompt:
    "You are an AI receptionist for a logistics company. Help customers track shipments, " +
    "schedule pickups, handle failed delivery callbacks, check rider ETAs, and answer " +
    "general inquiries. Be clear, efficient, and reassuring when providing delivery updates.",
  intents: logisticsIntents,
  toneGuidance:
    "Professional, clear, and reassuring. Provide precise tracking information and " +
    "ETAs. Be empathetic when handling failed deliveries and proactive with solutions.",
  greetingTemplate:
    "Thank you for calling {{businessName}}! How can I help you with your shipment today?",
};

// --- Tool Pack (Req 10.3, 5A, 5B) ---

const logisticsTools: ToolDefinition[] = [
  {
    name: "create_shipment",
    description:
      "Create a new shipment with origin, destination, package description, and pickup time",
    parameters: {
      businessId: {
        type: "string",
        description: "The unique identifier of the logistics business",
        required: true,
      },
      origin: {
        type: "string",
        description: "Origin location or location ID",
        required: true,
      },
      destination: {
        type: "string",
        description: "Destination address",
        required: true,
      },
      packageDescription: {
        type: "string",
        description: "Description of the package contents",
        required: true,
      },
      requestedPickupTime: {
        type: "string",
        description: "Requested pickup time in ISO 8601 format",
        required: true,
      },
    },
    handler: "api/tools/logistics/createShipment",
  },
  {
    name: "update_shipment",
    description:
      "Update shipment status or details through the lifecycle: pending → assigned → picked_up → in_transit → delivered → failed",
    parameters: {
      shipmentId: {
        type: "string",
        description: "The unique identifier of the shipment",
        required: true,
      },
      status: {
        type: "string",
        description: "New shipment status",
        required: false,
      },
      details: {
        type: "object",
        description: "Additional shipment details to update",
        required: false,
      },
    },
    handler: "api/tools/logistics/updateShipment",
  },
  {
    name: "assign_rider",
    description:
      "Assign an available rider to a pending shipment and update status to assigned",
    parameters: {
      shipmentId: {
        type: "string",
        description: "The unique identifier of the shipment",
        required: true,
      },
      riderId: {
        type: "string",
        description: "The unique identifier of the rider to assign",
        required: true,
      },
    },
    handler: "api/tools/logistics/assignRider",
  },
  {
    name: "add_shipment_event",
    description:
      "Record a shipment lifecycle event for audit and tracking purposes",
    parameters: {
      shipmentId: {
        type: "string",
        description: "The unique identifier of the shipment",
        required: true,
      },
      eventType: {
        type: "string",
        description: "Type of shipment event (e.g. status_change, note, exception)",
        required: true,
      },
      details: {
        type: "object",
        description: "Event details and metadata",
        required: false,
      },
    },
    handler: "api/tools/logistics/addShipmentEvent",
  },
  {
    name: "quote_delivery",
    description:
      "Calculate and return an estimated delivery cost and ETA based on origin and destination",
    parameters: {
      origin: {
        type: "string",
        description: "Origin location or address",
        required: true,
      },
      destination: {
        type: "string",
        description: "Destination address",
        required: true,
      },
      packageDescription: {
        type: "string",
        description: "Description of the package for weight/size estimation",
        required: false,
      },
    },
    handler: "api/tools/logistics/quoteDelivery",
  },
  {
    name: "push_event_to_runsheet",
    description:
      "Push a shipment event to the connected Runsheet dispatch system",
    parameters: {
      shipmentId: {
        type: "string",
        description: "The unique identifier of the shipment",
        required: true,
      },
      eventType: {
        type: "string",
        description: "Type of event to push to Runsheet",
        required: true,
      },
      payload: {
        type: "object",
        description: "Event payload for Runsheet",
        required: true,
      },
    },
    handler: "api/tools/logistics/pushEventToRunsheet",
    requiresIntegration: "runsheet_connect",
  },
];

// --- UI Sections (Req 13.3) ---

const logisticsUISections: UISectionDescriptor[] = [
  {
    id: "logistics-shipments",
    label: "Shipments",
    icon: "Package",
    tabId: "shipments",
    component: "src/components/dashboard/Shipments",
    requiredModule: "logistics_pack",
  },
  {
    id: "logistics-riders",
    label: "Riders",
    icon: "Bike",
    tabId: "riders",
    component: "src/components/dashboard/Riders",
    requiredModule: "logistics_pack",
  },
  {
    id: "logistics-dispatch",
    label: "Dispatch",
    icon: "MapPin",
    tabId: "dispatch",
    component: "src/components/dashboard/Dispatch",
    requiredModule: "logistics_pack",
  },
  {
    id: "logistics-analytics",
    label: "Logistics Analytics",
    icon: "BarChart3",
    tabId: "logistics-analytics",
    component: "src/components/dashboard/LogisticsAnalytics",
    requiredModule: "logistics_pack",
  },
];

// --- Analytics Queries ---

const logisticsAnalyticsQueries: AnalyticsQueryDescriptor[] = [
  {
    metricName: "call_to_shipment_conversion",
    query: "analytics/logistics/callToShipmentConversion",
    vertical: "logistics",
  },
  {
    metricName: "average_delivery_time",
    query: "analytics/logistics/averageDeliveryTime",
    vertical: "logistics",
  },
  {
    metricName: "delivery_success_rate",
    query: "analytics/logistics/deliverySuccessRate",
    vertical: "logistics",
  },
];

// --- Integration Hooks ---

const logisticsIntegrationHooks: IntegrationHook[] = [
  {
    integrationId: "runsheet_connect",
    onEvent: "shipment_status_change",
    handler: "api/integrations/runsheet/onShipmentStatusChange",
  },
  {
    integrationId: "runsheet_connect",
    onEvent: "rider_assignment",
    handler: "api/integrations/runsheet/onRiderAssignment",
  },
];

// --- Vertical Pack Definition ---

export const logisticsPack: VerticalPack = {
  moduleId: "logistics_pack",
  vertical: "logistics",
  promptPack: logisticsPromptPack,
  toolPack: logisticsTools,
  uiSections: logisticsUISections,
  analyticsQueries: logisticsAnalyticsQueries,
  intents: logisticsIntents,
  integrationHooks: logisticsIntegrationHooks,
};

/**
 * Registers the logistics pack with all platform registries.
 * Call this during application initialization to make logistics
 * capabilities available to the module resolver and voice agent.
 */
export function registerLogisticsPack(): void {
  registerPromptPack(logisticsPack.vertical, logisticsPack.promptPack);
  registerToolPack(logisticsPack.vertical, logisticsPack.toolPack);
  registerUISections(logisticsPack.uiSections);
}
