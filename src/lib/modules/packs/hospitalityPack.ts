/**
 * Hospitality Vertical Pack
 *
 * Provides hospitality-specific features: room reservations,
 * guest service requests, event booking, and concierge inquiries.
 *
 * Requirements: 9.4, 10.4
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

const hospitalityIntents: IntentDefinition[] = [
  {
    name: "room_reservation",
    description: "Guest wants to book, modify, or cancel a room reservation",
    requiredSlots: ["checkInDate", "checkOutDate"],
    handler: "api/intents/hospitality/roomReservation",
  },
  {
    name: "guest_service_request",
    description: "Guest requests room service, housekeeping, or amenities",
    requiredSlots: ["requestType"],
    handler: "api/intents/hospitality/guestServiceRequest",
  },
  {
    name: "event_booking",
    description: "Caller wants to book a venue or event space",
    requiredSlots: ["eventDate", "eventType"],
    handler: "api/intents/hospitality/eventBooking",
  },
  {
    name: "concierge_inquiry",
    description: "Guest asks about local attractions, dining, or transportation",
    requiredSlots: [],
    handler: "api/intents/hospitality/conciergeInquiry",
  },
];

const hospitalityPromptPack: PromptPack = {
  systemPrompt:
    "You are an AI concierge for a hospitality business. Help guests make reservations, " +
    "request services, book events, and get local recommendations. Be warm, attentive, " +
    "and focused on creating an exceptional guest experience.",
  intents: hospitalityIntents,
  toneGuidance:
    "Warm, gracious, and attentive. Anticipate guest needs and offer helpful suggestions. " +
    "Maintain a polished, welcoming tone that reflects the hospitality brand.",
  greetingTemplate:
    "Welcome to {{businessName}}! How may I assist you today?",
};

const hospitalityTools: ToolDefinition[] = [
  {
    name: "upsert_call_data",
    description: "Create or update call session data for the current call",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      data: { type: "object", description: "Call data fields to upsert", required: true },
    },
    handler: "api/tools/hospitality/upsertCallData",
  },
  {
    name: "add_transcript_dialogue",
    description: "Append a dialogue turn to the call transcript",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      role: { type: "string", description: "Speaker role: 'agent' or 'customer'", required: true },
      content: { type: "string", description: "Dialogue content", required: true },
    },
    handler: "api/tools/hospitality/addTranscriptDialogue",
  },
  {
    name: "create_reservation",
    description: "Create a room or venue reservation",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      checkInDate: { type: "string", description: "Check-in date (ISO 8601)", required: true },
      checkOutDate: { type: "string", description: "Check-out date (ISO 8601)", required: true },
      roomType: { type: "string", description: "Room type preference", required: false },
      guestName: { type: "string", description: "Guest name", required: false },
      guestPhone: { type: "string", description: "Guest phone number", required: false },
      specialRequests: { type: "string", description: "Special requests or notes", required: false },
    },
    handler: "api/tools/hospitality/createReservation",
  },
  {
    name: "submit_service_request",
    description: "Submit a guest service request (room service, housekeeping, etc.)",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      requestType: { type: "string", description: "Type of service requested", required: true },
      roomNumber: { type: "string", description: "Guest room number", required: false },
      details: { type: "string", description: "Request details", required: false },
    },
    handler: "api/tools/hospitality/submitServiceRequest",
  },
];

const hospitalityUISections: UISectionDescriptor[] = [];

const hospitalityAnalyticsQueries: AnalyticsQueryDescriptor[] = [
  {
    metricName: "call_to_reservation_conversion",
    query: "analytics/hospitality/callToReservationConversion",
    vertical: "hospitality",
  },
  {
    metricName: "service_request_fulfillment_rate",
    query: "analytics/hospitality/serviceRequestFulfillmentRate",
    vertical: "hospitality",
  },
];

export const hospitalityPack: VerticalPack = {
  moduleId: "hospitality_pack",
  vertical: "hospitality",
  promptPack: hospitalityPromptPack,
  toolPack: hospitalityTools,
  uiSections: hospitalityUISections,
  analyticsQueries: hospitalityAnalyticsQueries,
  intents: hospitalityIntents,
};

export function registerHospitalityPack(): void {
  registerPromptPack(hospitalityPack.vertical, hospitalityPack.promptPack);
  registerToolPack(hospitalityPack.vertical, hospitalityPack.toolPack);
  registerUISections(hospitalityPack.uiSections);
}
