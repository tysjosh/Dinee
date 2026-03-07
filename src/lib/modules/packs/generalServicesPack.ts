/**
 * General Services Vertical Pack
 *
 * Provides general services features as an activatable module pack:
 * appointment booking, service inquiries, callback requests, contact
 * capture, and general inquiry handling. This pack also serves as the
 * fallback prompt pack for verticals without a dedicated pack.
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

// --- Intents (Req 9.4) ---

const generalServicesIntents: IntentDefinition[] = [
  {
    name: "appointment_booking",
    description:
      "Customer wants to book, reschedule, or cancel an appointment",
    requiredSlots: ["date", "serviceType"],
    handler: "api/intents/generalServices/appointmentBooking",
  },
  {
    name: "service_inquiry",
    description:
      "Customer asks about available services, pricing, or service details",
    requiredSlots: [],
    handler: "api/intents/generalServices/serviceInquiry",
  },
  {
    name: "callback_request",
    description:
      "Customer requests a callback from a staff member or specialist",
    requiredSlots: ["contactNumber"],
    handler: "api/intents/generalServices/callbackRequest",
  },
  {
    name: "general_inquiry",
    description:
      "General questions about the business such as hours, location, or policies",
    requiredSlots: [],
    handler: "api/intents/generalServices/generalInquiry",
  },
];

// --- Prompt Pack (Req 9.4) ---

const generalServicesPromptPack: PromptPack = {
  systemPrompt:
    "You are an AI receptionist for a service business. Help customers book appointments, " +
    "inquire about services, request callbacks, and answer general questions. Be professional, " +
    "helpful, and efficient in capturing customer needs and scheduling.",
  intents: generalServicesIntents,
  toneGuidance:
    "Professional, warm, and helpful. Listen carefully to customer needs and provide " +
    "clear information about services and availability. Be proactive in offering to " +
    "schedule appointments or arrange callbacks.",
  greetingTemplate:
    "Thank you for calling {{businessName}}! How can I assist you today?",
};

// --- Tool Pack (Req 10.4) ---

const generalServicesTools: ToolDefinition[] = [
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
    handler: "api/tools/generalServices/upsertCallData",
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
    handler: "api/tools/generalServices/addTranscriptDialogue",
  },
  {
    name: "create_appointment",
    description:
      "Create a new appointment record with date, time, service type, and customer details",
    parameters: {
      callId: {
        type: "string",
        description: "The unique identifier of the call",
        required: true,
      },
      date: {
        type: "string",
        description: "Appointment date in ISO 8601 format",
        required: true,
      },
      time: {
        type: "string",
        description: "Appointment time in HH:mm format",
        required: true,
      },
      serviceType: {
        type: "string",
        description: "Type of service requested",
        required: true,
      },
      customerName: {
        type: "string",
        description: "Customer name for the appointment",
        required: false,
      },
      customerPhone: {
        type: "string",
        description: "Customer phone number",
        required: false,
      },
    },
    handler: "api/tools/generalServices/createAppointment",
  },
  {
    name: "capture_contact",
    description:
      "Capture and store customer contact information from the call",
    parameters: {
      callId: {
        type: "string",
        description: "The unique identifier of the call",
        required: true,
      },
      name: {
        type: "string",
        description: "Customer name",
        required: false,
      },
      phone: {
        type: "string",
        description: "Customer phone number",
        required: false,
      },
      email: {
        type: "string",
        description: "Customer email address",
        required: false,
      },
      notes: {
        type: "string",
        description: "Additional notes about the contact",
        required: false,
      },
    },
    handler: "api/tools/generalServices/captureContact",
  },
];

// --- UI Sections ---
// General services does not register vertical-specific UI sections;
// it relies on Core Platform sections (Calls, Transcripts, Contacts,
// Appointments/Tasks, Settings).

const generalServicesUISections: UISectionDescriptor[] = [];

// --- Analytics Queries ---

const generalServicesAnalyticsQueries: AnalyticsQueryDescriptor[] = [
  {
    metricName: "call_to_appointment_conversion",
    query: "analytics/generalServices/callToAppointmentConversion",
    vertical: "general_services",
  },
  {
    metricName: "callback_fulfillment_rate",
    query: "analytics/generalServices/callbackFulfillmentRate",
    vertical: "general_services",
  },
];

// --- Vertical Pack Definition ---

export const generalServicesPack: VerticalPack = {
  moduleId: "general_services_pack",
  vertical: "general_services",
  promptPack: generalServicesPromptPack,
  toolPack: generalServicesTools,
  uiSections: generalServicesUISections,
  analyticsQueries: generalServicesAnalyticsQueries,
  intents: generalServicesIntents,
};

/**
 * Registers the general services pack with all platform registries.
 * Call this during application initialization to make general services
 * capabilities available to the module resolver and voice agent.
 */
export function registerGeneralServicesPack(): void {
  registerPromptPack(generalServicesPack.vertical, generalServicesPack.promptPack);
  registerToolPack(generalServicesPack.vertical, generalServicesPack.toolPack);
  registerUISections(generalServicesPack.uiSections);
}
