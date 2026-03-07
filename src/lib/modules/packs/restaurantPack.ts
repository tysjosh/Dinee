/**
 * Restaurant Vertical Pack
 *
 * Preserves all existing restaurant-specific features as an activatable
 * module pack: menu item management, food order capture/tracking, order
 * status workflow, upsell/cross-sell prompts, and restaurant-specific
 * voice agent tools.
 *
 * Requirements: 4.1, 4.4, 9.2, 10.2, 13.2
 */

import type {
  VerticalPack,
  PromptPack,
  IntentDefinition,
  ToolDefinition,
  UISectionDescriptor,
  AnalyticsQueryDescriptor,
} from "../types";
import { registerPromptPack } from "../promptPackRegistry";
import { registerToolPack } from "../toolPackRegistry";
import { registerUISections } from "../uiSectionRegistry";

// --- Intents (Req 9.2) ---

const restaurantIntents: IntentDefinition[] = [
  {
    name: "menu_inquiry",
    description: "Customer asks about menu items, ingredients, pricing, or availability",
    requiredSlots: [],
    handler: "api/intents/restaurant/menuInquiry",
  },
  {
    name: "place_order",
    description: "Customer wants to place a food order",
    requiredSlots: ["items"],
    handler: "api/intents/restaurant/placeOrder",
  },
  {
    name: "order_status",
    description: "Customer asks about the status of an existing order",
    requiredSlots: ["orderId"],
    handler: "api/intents/restaurant/orderStatus",
  },
  {
    name: "reservation",
    description: "Customer wants to make, modify, or cancel a reservation",
    requiredSlots: ["date", "partySize"],
    handler: "api/intents/restaurant/reservation",
  },
  {
    name: "general_inquiry",
    description: "General questions about the restaurant such as hours, location, or policies",
    requiredSlots: [],
    handler: "api/intents/restaurant/generalInquiry",
  },
];

// --- Prompt Pack (Req 9.2) ---

const restaurantPromptPack: PromptPack = {
  systemPrompt:
    "You are an AI receptionist for a restaurant. Help customers with menu questions, " +
    "placing orders, checking order status, making reservations, and answering general " +
    "inquiries. Be warm, knowledgeable about the menu, and efficient with order-taking.",
  intents: restaurantIntents,
  toneGuidance:
    "Friendly, welcoming, and knowledgeable. Use appetizing language when describing " +
    "menu items. Be patient with indecisive customers and offer helpful suggestions.",
  greetingTemplate:
    "Thank you for calling {{businessName}}! How can I help you today?",
};

// --- Tool Pack (Req 4.4, 10.2) ---

const restaurantTools: ToolDefinition[] = [
  {
    name: "get_restaurant_details",
    description: "Retrieve restaurant information including name, hours, location, and menu",
    parameters: {
      restaurantId: {
        type: "string",
        description: "The unique identifier of the restaurant",
        required: true,
      },
    },
    handler: "api/tools/restaurant/getRestaurantDetails",
  },
  {
    name: "upsert_call_data",
    description: "Create or update call session data for the current call",
    parameters: {
      callId: {
        type: "string",
        description: "The unique identifier of the call",
        required: true,
      },
      data: {
        type: "object",
        description: "Call data fields to upsert",
        required: true,
      },
    },
    handler: "api/tools/restaurant/upsertCallData",
  },
  {
    name: "add_transcript_dialogue",
    description: "Append a dialogue turn to the call transcript",
    parameters: {
      callId: {
        type: "string",
        description: "The unique identifier of the call",
        required: true,
      },
      role: {
        type: "string",
        description: "Speaker role: 'agent' or 'customer'",
        required: true,
      },
      content: {
        type: "string",
        description: "The dialogue content",
        required: true,
      },
    },
    handler: "api/tools/restaurant/addTranscriptDialogue",
  },
  {
    name: "upsert_order",
    description: "Create or update a food order for the current call",
    parameters: {
      callId: {
        type: "string",
        description: "The unique identifier of the call",
        required: true,
      },
      orderId: {
        type: "string",
        description: "The order identifier (generated or existing)",
        required: true,
      },
      items: {
        type: "array",
        description: "Array of order items with name, quantity, and customizations",
        required: true,
      },
      customerName: {
        type: "string",
        description: "Customer name for the order",
        required: false,
      },
      customerPhone: {
        type: "string",
        description: "Customer phone number",
        required: false,
      },
    },
    handler: "api/tools/restaurant/upsertOrder",
  },
  {
    name: "generate_order_id",
    description: "Generate a unique order identifier for a new order",
    parameters: {
      restaurantId: {
        type: "string",
        description: "The restaurant to generate the order ID for",
        required: true,
      },
    },
    handler: "api/tools/restaurant/generateOrderId",
  },
];

// --- UI Sections (Req 13.2) ---

const restaurantUISections: UISectionDescriptor[] = [
  {
    id: "restaurant-orders",
    label: "Orders",
    icon: "ShoppingBag",
    tabId: "orders",
    component: "src/components/dashboard/CurrentOrders",
    requiredModule: "restaurant_pack",
  },
  {
    id: "restaurant-menu",
    label: "Menu Management",
    icon: "UtensilsCrossed",
    tabId: "menu",
    component: "src/components/dashboard/MenuManagement",
    requiredModule: "restaurant_pack",
  },
  {
    id: "restaurant-upsell",
    label: "Upsell Prompts",
    icon: "TrendingUp",
    tabId: "upsell",
    component: "src/components/dashboard/UpsellPrompts",
    requiredModule: "restaurant_pack",
  },
  {
    id: "restaurant-analytics",
    label: "Restaurant Analytics",
    icon: "BarChart3",
    tabId: "restaurant-analytics",
    component: "src/components/dashboard/RestaurantAnalytics",
    requiredModule: "restaurant_pack",
  },
];

// --- Analytics Queries ---

const restaurantAnalyticsQueries: AnalyticsQueryDescriptor[] = [
  {
    metricName: "call_to_order_conversion",
    query: "analytics/restaurant/callToOrderConversion",
    vertical: "restaurant",
  },
  {
    metricName: "average_order_value",
    query: "analytics/restaurant/averageOrderValue",
    vertical: "restaurant",
  },
  {
    metricName: "order_completion_rate",
    query: "analytics/restaurant/orderCompletionRate",
    vertical: "restaurant",
  },
];

// --- Vertical Pack Definition ---

export const restaurantPack: VerticalPack = {
  moduleId: "restaurant_pack",
  vertical: "restaurant",
  promptPack: restaurantPromptPack,
  toolPack: restaurantTools,
  uiSections: restaurantUISections,
  analyticsQueries: restaurantAnalyticsQueries,
  intents: restaurantIntents,
};

/**
 * Registers the restaurant pack with all platform registries.
 * Call this during application initialization to make restaurant
 * capabilities available to the module resolver and voice agent.
 */
export function registerRestaurantPack(): void {
  registerPromptPack(restaurantPack.vertical, restaurantPack.promptPack);
  registerToolPack(restaurantPack.vertical, restaurantPack.toolPack);
  registerUISections(restaurantPack.uiSections);
}
