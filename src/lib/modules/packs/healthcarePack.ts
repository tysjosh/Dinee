/**
 * Healthcare Vertical Pack
 *
 * Provides healthcare-specific features: appointment scheduling,
 * prescription refill requests, provider inquiries, and patient
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

const healthcareIntents: IntentDefinition[] = [
  {
    name: "appointment_scheduling",
    description: "Patient wants to book, reschedule, or cancel a medical appointment",
    requiredSlots: ["date", "provider"],
    handler: "api/intents/healthcare/appointmentScheduling",
  },
  {
    name: "prescription_refill",
    description: "Patient requests a prescription refill",
    requiredSlots: ["medicationName"],
    handler: "api/intents/healthcare/prescriptionRefill",
  },
  {
    name: "provider_inquiry",
    description: "Caller asks about available providers, specialties, or office hours",
    requiredSlots: [],
    handler: "api/intents/healthcare/providerInquiry",
  },
  {
    name: "patient_intake",
    description: "New patient registration or intake information capture",
    requiredSlots: ["patientName", "contactNumber"],
    handler: "api/intents/healthcare/patientIntake",
  },
];

const healthcarePromptPack: PromptPack = {
  systemPrompt:
    "You are an AI receptionist for a healthcare practice. Help patients schedule appointments, " +
    "request prescription refills, inquire about providers, and complete intake forms. " +
    "Be empathetic, clear, and mindful of patient privacy.",
  intents: healthcareIntents,
  toneGuidance:
    "Empathetic, calm, and reassuring. Use clear language and avoid medical jargon " +
    "unless the caller initiates it. Always confirm details carefully.",
  greetingTemplate:
    "Thank you for calling {{businessName}}. How may I help you today?",
};

const healthcareTools: ToolDefinition[] = [
  {
    name: "upsert_call_data",
    description: "Create or update call session data for the current call",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      data: { type: "object", description: "Call data fields to upsert", required: true },
    },
    handler: "api/tools/healthcare/upsertCallData",
  },
  {
    name: "add_transcript_dialogue",
    description: "Append a dialogue turn to the call transcript",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      role: { type: "string", description: "Speaker role: 'agent' or 'customer'", required: true },
      content: { type: "string", description: "Dialogue content", required: true },
    },
    handler: "api/tools/healthcare/addTranscriptDialogue",
  },
  {
    name: "schedule_appointment",
    description: "Schedule a patient appointment with a provider",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      date: { type: "string", description: "Appointment date (ISO 8601)", required: true },
      time: { type: "string", description: "Appointment time (HH:mm)", required: true },
      provider: { type: "string", description: "Provider name or ID", required: true },
      patientName: { type: "string", description: "Patient name", required: false },
      patientPhone: { type: "string", description: "Patient phone number", required: false },
      reason: { type: "string", description: "Reason for visit", required: false },
    },
    handler: "api/tools/healthcare/scheduleAppointment",
  },
  {
    name: "request_prescription_refill",
    description: "Submit a prescription refill request",
    parameters: {
      callId: { type: "string", description: "Unique call identifier", required: true },
      medicationName: { type: "string", description: "Medication name", required: true },
      pharmacyName: { type: "string", description: "Preferred pharmacy", required: false },
      patientName: { type: "string", description: "Patient name", required: false },
    },
    handler: "api/tools/healthcare/requestPrescriptionRefill",
  },
];

const healthcareUISections: UISectionDescriptor[] = [];

const healthcareAnalyticsQueries: AnalyticsQueryDescriptor[] = [
  {
    metricName: "call_to_appointment_conversion",
    query: "analytics/healthcare/callToAppointmentConversion",
    vertical: "healthcare",
  },
  {
    metricName: "refill_request_rate",
    query: "analytics/healthcare/refillRequestRate",
    vertical: "healthcare",
  },
];

export const healthcarePack: VerticalPack = {
  moduleId: "healthcare_pack",
  vertical: "healthcare",
  promptPack: healthcarePromptPack,
  toolPack: healthcareTools,
  uiSections: healthcareUISections,
  analyticsQueries: healthcareAnalyticsQueries,
  intents: healthcareIntents,
};

export function registerHealthcarePack(): void {
  registerPromptPack(healthcarePack.vertical, healthcarePack.promptPack);
  registerToolPack(healthcarePack.vertical, healthcarePack.toolPack);
  registerUISections(healthcarePack.uiSections);
}
