/**
 * Legal Vertical Pack
 *
 * Provides legal practice features: consultation scheduling,
 * case status inquiries, document request handling, and client
 * intake capture.
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

const legalIntents: IntentDefinition[] = [
  {
    name: "consultation_booking",
    description: "Caller wants to book an initial or follow-up legal consultation",
    requiredSlots: ["date", "caseType"],
    handler: "api/intents/legal/consultationBooking",
  },
  {
    name: "case_status_inquiry",
    description: "Client asks about the status of an existing case or matter",
    requiredSlots: ["caseReference"],
    handler: "api/intents/legal/caseStatusInquiry",
  },
  {
    name: "document_request",
    description: "Client requests documents or needs to submit documents",
    requiredSlots: ["documentType"],
    handler: "api/intents/legal/documentRequest",
  },
  {
    name: "client_intake",
    description: "New client registration and initial information capture",
    requiredSlots: ["clientName", "contactNumber"],
    handler: "api/intents/legal/clientIntake",
  },
];

const legalPromptPack: PromptPack = {
  systemPrompt:
    "You are an AI receptionist for a legal practice. Help callers schedule consultations, " +
    "check case status, request documents, and complete client intake. Be professional, " +
    "discreet, and mindful of confidentiality at all times.",
  intents: legalIntents,
  toneGuidance:
    "Professional, measured, and discreet. Avoid giving legal advice. Focus on scheduling, " +
    "information capture, and routing callers to the appropriate attorney or staff member.",
  greetingTemplate:
    "Thank you for calling {{businessName}}. How may I direct your call today?",
};

const legalTools: ToolDefinition[] = [
  {
    name: "upsert_call_data",
    description: "Create or update call session data for the current call",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      data: { type: "object", description: "Call data fields to upsert", required: true },
    },
    handler: "api/tools/legal/upsertCallData",
  },
  {
    name: "add_transcript_dialogue",
    description: "Append a dialogue turn to the call transcript",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      role: { type: "string", description: "Speaker role: 'agent' or 'customer'", required: true },
      content: { type: "string", description: "Dialogue content", required: true },
    },
    handler: "api/tools/legal/addTranscriptDialogue",
  },
  {
    name: "book_consultation",
    description: "Book a legal consultation with an attorney",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      date: { type: "string", description: "Consultation date (ISO 8601)", required: true },
      time: { type: "string", description: "Consultation time (HH:mm)", required: true },
      caseType: { type: "string", description: "Area of law or case type", required: true },
      clientName: { type: "string", description: "Client name", required: false },
      clientPhone: { type: "string", description: "Client phone number", required: false },
    },
    handler: "api/tools/legal/bookConsultation",
  },
  {
    name: "capture_client_info",
    description: "Capture new client intake information",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      name: { type: "string", description: "Client name", required: true },
      phone: { type: "string", description: "Client phone number", required: false },
      email: { type: "string", description: "Client email address", required: false },
      caseType: { type: "string", description: "Area of law", required: false },
      notes: { type: "string", description: "Additional notes", required: false },
    },
    handler: "api/tools/legal/captureClientInfo",
  },
];

const legalUISections: UISectionDescriptor[] = [];

const legalAnalyticsQueries: AnalyticsQueryDescriptor[] = [
  {
    metricName: "call_to_consultation_conversion",
    query: "analytics/legal/callToConsultationConversion",
    vertical: "legal",
  },
  {
    metricName: "intake_completion_rate",
    query: "analytics/legal/intakeCompletionRate",
    vertical: "legal",
  },
];

export const legalPack: VerticalPack = {
  moduleId: "legal_pack",
  vertical: "legal",
  promptPack: legalPromptPack,
  toolPack: legalTools,
  uiSections: legalUISections,
  analyticsQueries: legalAnalyticsQueries,
  intents: legalIntents,
};

export function registerLegalPack(): void {
  registerPromptPack(legalPack.vertical, legalPack.promptPack);
  registerToolPack(legalPack.vertical, legalPack.toolPack);
  registerUISections(legalPack.uiSections);
}
