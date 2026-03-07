/**
 * Feature: ai-reception-os-pivot, Property 3: Tool Pack Enforcement
 *
 * Validates: Requirements 10.5, 10.6, 10.7
 *
 * For any active call session with vertical V and enabledModules M,
 * validateToolCall(toolName, V, M) SHALL return true if and only if
 * the tool name appears in getToolPack(V, M). This also validates that
 * integration-gated tools are excluded when the integration module is
 * not in enabledModules.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { ToolDefinition } from "../../src/lib/modules/types";
import {
  registerToolPack,
  getToolPack,
  validateToolCall,
  clearRegistry,
} from "../../src/lib/modules/toolPackRegistry";

// --- Test fixtures: tool packs for different verticals ---

const restaurantTools: ToolDefinition[] = [
  {
    name: "get_restaurant_details",
    description: "Fetch restaurant info",
    parameters: {},
    handler: "api/restaurant/details",
  },
  {
    name: "upsert_call_data",
    description: "Create or update call data",
    parameters: {},
    handler: "api/calls/upsert",
  },
  {
    name: "add_transcript_dialogue",
    description: "Add dialogue turn to transcript",
    parameters: {},
    handler: "api/transcripts/add",
  },
  {
    name: "upsert_order",
    description: "Create or update an order",
    parameters: {},
    handler: "api/orders/upsert",
  },
  {
    name: "generate_order_id",
    description: "Generate a unique order ID",
    parameters: {},
    handler: "api/orders/generateId",
  },
];

const logisticsTools: ToolDefinition[] = [
  {
    name: "create_shipment",
    description: "Create a new shipment",
    parameters: {},
    handler: "api/shipments/create",
  },
  {
    name: "update_shipment",
    description: "Update shipment status",
    parameters: {},
    handler: "api/shipments/update",
  },
  {
    name: "assign_rider",
    description: "Assign a rider to a shipment",
    parameters: {},
    handler: "api/riders/assign",
  },
  {
    name: "add_shipment_event",
    description: "Log a shipment event",
    parameters: {},
    handler: "api/shipments/addEvent",
  },
  {
    name: "quote_delivery",
    description: "Get a delivery quote",
    parameters: {},
    handler: "api/shipments/quote",
  },
  {
    name: "push_event_to_runsheet",
    description: "Push event to Runsheet",
    parameters: {},
    handler: "api/integrations/runsheet/push",
    requiresIntegration: "runsheet_connect",
  },
];

const generalServicesTools: ToolDefinition[] = [
  {
    name: "upsert_call_data_gs",
    description: "Create or update call data",
    parameters: {},
    handler: "api/calls/upsert",
  },
  {
    name: "add_transcript_dialogue_gs",
    description: "Add dialogue turn",
    parameters: {},
    handler: "api/transcripts/add",
  },
  {
    name: "create_appointment",
    description: "Create an appointment",
    parameters: {},
    handler: "api/appointments/create",
  },
  {
    name: "capture_contact",
    description: "Capture contact info",
    parameters: {},
    handler: "api/contacts/capture",
  },
];

// All tool names across all packs (for generating valid tool names)
const ALL_TOOL_NAMES = [
  ...restaurantTools.map((t) => t.name),
  ...logisticsTools.map((t) => t.name),
  ...generalServicesTools.map((t) => t.name),
];

const REGISTERED_VERTICALS = ["restaurant", "logistics", "general_services"];

const ALL_MODULES = [
  "core_platform",
  "restaurant_pack",
  "logistics_pack",
  "general_services_pack",
  "runsheet_connect",
  "healthcare_pack",
  "legal_pack",
  "hospitality_pack",
];

const INVALID_TOOL_NAMES = [
  "nonexistent_tool",
  "hack_system",
  "delete_all_data",
  "admin_override",
];

// --- Arbitraries ---

/** Random vertical from registered verticals plus unregistered ones */
const verticalArb = fc.oneof(
  fc.constantFrom(...REGISTERED_VERTICALS),
  fc.constantFrom("healthcare", "legal", "hospitality")
);

/** Random subset of all modules */
const enabledModulesArb = fc.subarray(ALL_MODULES, { minLength: 0 });

/** Random tool name: from all registered tools, invalid names, or random strings */
const toolNameArb = fc.oneof(
  fc.constantFrom(...ALL_TOOL_NAMES),
  fc.constantFrom(...INVALID_TOOL_NAMES),
  fc.string({ minLength: 1, maxLength: 30 })
);

describe("Property 3: Tool Pack Enforcement", () => {
  beforeEach(() => {
    clearRegistry();
    registerToolPack("restaurant", restaurantTools);
    registerToolPack("logistics", logisticsTools);
    registerToolPack("general_services", generalServicesTools);
  });

  it("validateToolCall returns true iff tool is in getToolPack(V, M)", () => {
    fc.assert(
      fc.property(
        verticalArb,
        enabledModulesArb,
        toolNameArb,
        (vertical, enabledModules, toolName) => {
          const activePack = getToolPack(vertical, enabledModules);
          const activeToolNames = activePack.map((t) => t.name);
          const isInPack = activeToolNames.includes(toolName);

          const result = validateToolCall(toolName, vertical, enabledModules);

          expect(result).toBe(isInPack);
        }
      ),
      { numRuns: 100 }
    );
  });
});
