/**
 * VoiceDomainPack contract — the voice-specific layer of the Dinee platform.
 *
 * A VoiceDomainPack is a dynamically loadable definition of an external
 * product's VOICE capabilities (identity, prompts, conversation types, tools,
 * call phases, escalation rules, and required integration configuration).
 *
 * It is a voice-specific layer that EXTENDS and BRIDGES TO the existing
 * Module_Pack_System (`src/lib/modules/types.ts` `VerticalPack`,
 * `src/lib/modules/toolPackRegistry.ts`) rather than introducing a parallel
 * registry. Where a `VerticalPack` or tool pack already exists for a product,
 * a VoiceDomainPack references/wraps that registration through a
 * {@link ModulePackBridge} and adds only the voice concerns the module-pack
 * system does not model.
 *
 * Requirements: 2.1, 2.5, 2.7, 2.8
 */

// The bridge references an existing Module_Pack_System VerticalPack. The type
// import documents the linkage even though the bridge stores ids, not the pack.
import type { VerticalPack } from "@/lib/modules/types";

/**
 * A minimal JSON-Schema description of a tool's parameters, matching the
 * OpenAI function-tool parameter shape. Kept intentionally permissive so packs
 * can declare arbitrary nested object schemas.
 */
export interface JSONSchema {
  /** JSON Schema type, typically "object" at the top level. */
  type: string;
  /** Property definitions keyed by parameter name. */
  properties?: Record<string, JSONSchema>;
  /** Names of required properties. */
  required?: string[];
  /** Human-readable description of the parameter. */
  description?: string;
  /** Allowed values for an enum-constrained parameter. */
  enum?: unknown[];
  /** Item schema when `type` is "array". */
  items?: JSONSchema;
  /** Additional JSON-Schema keywords are permitted. */
  [key: string]: unknown;
}

/**
 * The shape/labels of transcript metadata captured for a conversation type
 * (Req 2.7). Each entry names a metadata field the runtime records for the
 * conversation, along with its value type and whether it is required.
 */
export interface TranscriptMetadataShape {
  /**
   * Metadata field descriptors keyed by field name. For example a fuel-intake
   * conversation might capture `customerId`, `siteId`, and `urgency`.
   */
  fields: Record<string, TranscriptMetadataField>;
}

/** A single transcript-metadata field descriptor (Req 2.7). */
export interface TranscriptMetadataField {
  /** Human-readable label for the field. */
  label: string;
  /** Value type of the captured metadata. */
  type: "string" | "number" | "boolean";
  /** Whether the field must be present for a complete transcript record. */
  required: boolean;
}

/**
 * A dynamically loadable definition of an external product's VOICE capabilities.
 * It bridges to the existing Module_Pack_System rather than duplicating it (Req 2.8, 2.9).
 */
export interface VoiceDomainPack {
  /** Unique identifier, 1–64 chars, unique across the registry (Req 2.1, 2.2). */
  id: string;
  /** Human-readable name, 1–128 chars (Req 2.1). */
  name: string;
  /** Description, 0–1024 chars (Req 2.1). */
  description: string;
  /** 1–50 conversation types this pack owns (Req 2.1). */
  conversationTypes: ConversationTypeDefinition[];
  /** At most 100 tool definitions (Req 2.1). */
  tools: VoiceToolDefinition[];
  /** 1–20 call-phase definitions (Req 2.1). */
  phases: CallPhaseDefinition[];
  /** Default system prompt used when a conversation type omits its own (Req 2.1). */
  defaultPrompt: string;
  /** Escalation rules applied when the agent cannot complete (Req 2.1). */
  escalationRules: EscalationRule[];
  /** Integrations this pack requires to operate (Req 2.1, 4.4). */
  integrations: IntegrationRequirement[];
  /**
   * Bridge to the Module_Pack_System (Req 2.8, 2.9).
   * When set, the registry links this voice pack to an existing VerticalPack /
   * tool-pack registration instead of creating a parallel one. The voice pack
   * REUSES the linked pack's tool-pack membership for integration gating and
   * dashboard/analytics registration; it only adds voice-specific behavior.
   */
  moduleBridge?: ModulePackBridge;
}

/** Links a VoiceDomainPack to an existing Module_Pack_System registration (Req 2.8, 2.9). */
export interface ModulePackBridge {
  /**
   * The {@link VerticalPack} id already registered in `src/lib/modules`
   * (e.g. "logistics").
   */
  verticalPackId: string;
  /** Existing tool-pack ids whose registrations should be reused/wrapped, not duplicated. */
  reuseToolPackIds: string[];
  /**
   * How to resolve tools: "reuse" pulls tool membership from the linked tool packs,
   * "extend" adds voice-only tools on top of the reused set. Prevents blind duplication.
   */
  mode: "reuse" | "extend";
}

/** One conversation type owned by a pack (Req 2.7). */
export interface ConversationTypeDefinition {
  /** e.g. "runsheet_fuel_order_intake". */
  type: string;
  /** Optional per-conversation prompt override; falls back to defaultPrompt. */
  prompt?: string;
  /** The phase the session starts in (must be a defined phase id). */
  initialPhase: string;
  /** Shape/labels of transcript metadata captured for this conversation (Req 2.7). */
  transcriptMetadata: TranscriptMetadataShape;
  /** Behavior when the agent cannot proceed (Req 2.7). */
  fallbackBehavior: FallbackBehavior;
}

/** A backend tool the agent may call (Req 2.5). */
export interface VoiceToolDefinition {
  /** Tool name exposed to the model. */
  name: string;
  /** Natural-language description for the model. */
  description: string;
  /** JSON-schema parameter definition (OpenAI function-tool shape). */
  parameters: JSONSchema;
  /** Phase ids in which this tool is permitted (Req 2.5, 2.6). */
  allowedPhases: string[];
  /** Integration id required for this tool to be exposed (Req 4.4). */
  requiresIntegration?: string;
  /** true for read-only tools; mutation tools are gated more strictly. */
  readOnly: boolean;
  /** Handler key resolved by the tool executor to an implementation. */
  handler: string;
  /**
   * When the pack bridges in "reuse" mode, this names the tool-pack tool this
   * voice tool wraps, so the same handler/registration is reused (Req 2.9).
   */
  reusesModuleTool?: string;
}

/** A named call phase and the events that advance it (Req 2.1). */
export interface CallPhaseDefinition {
  /** Phase id, referenced by tools' allowedPhases and transitions. */
  id: string;
  /** Ordered transitions: on `event` in this phase, move to `to`. */
  transitions: Array<{ event: string; to: string }>;
  /** true when the phase represents a finalized order (Req 7.3). */
  terminal?: boolean;
}

/** Escalation target + trigger (Req 2.1, 9.4). */
export interface EscalationRule {
  trigger: "max_slot_retries" | "tool_failure" | "explicit_request" | "no_pack";
  target: EscalationTarget;
}

export type EscalationTarget =
  | { kind: "phone"; value: string }
  | { kind: "email"; value: string }
  | { kind: "webhook"; value: string };

/** Declares an integration the pack needs; presence is resolved per tenant (Req 4.4). */
export interface IntegrationRequirement {
  /** e.g. "runsheet". */
  id: string;
  /** Whether the pack can operate at all without it. */
  required: boolean;
}

export type FallbackBehavior =
  | { kind: "escalate" }
  | { kind: "voicemail" }
  | { kind: "apologize_and_end" };
