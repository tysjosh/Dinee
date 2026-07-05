/**
 * VoiceDomainPack Registry — pure, in-memory, deterministic.
 *
 * Validates and stores {@link VoiceDomainPack}s, resolves the pack that owns a
 * conversation type, derives the integration-gated tool set for a tenant
 * (honoring any {@link ModulePackBridge} so module-level gating is never
 * bypassed), and answers tool-call gating questions (membership ∧ phase).
 *
 * The registry BRIDGES to the existing Module_Pack_System
 * (`src/lib/modules/toolPackRegistry.ts`) rather than duplicating it: when a
 * pack carries a `moduleBridge`, references are validated against the module
 * pack system and, in `reuse` mode, the exposed tool set is derived from the
 * linked tool packs' membership.
 *
 * Requirements: 2.2, 2.3, 2.4, 2.6, 2.8, 2.9, 3.1, 3.6, 4.2, 4.3, 4.4
 */

import type {
  VoiceDomainPack,
  VoiceToolDefinition,
} from "./voiceDomainPack";
import { getRegisteredToolPack, hasToolPack } from "./toolPackRegistry";

/** Result of a registration attempt (Req 2.2–2.4, 2.6, 2.8, 2.9). */
export type RegisterResult =
  | { ok: true }
  | { ok: false; error: RegistrationError };

/** Describes why a registration was rejected. */
export interface RegistrationError {
  code:
    | "duplicate_id" // Req 2.3
    | "invalid_id" // Req 2.2, 2.4
    | "missing_field" // Req 2.4
    | "field_out_of_bounds" // Req 2.4
    | "invalid_tool_phase" // Req 2.6
    | "unknown_module_bridge"; // Req 2.8, 2.9 (bridge target not in Module_Pack_System)
  /**
   * Names the offending field / conflicting id / invalid phase / missing bridge
   * reference (Req 2.3, 2.4, 2.6, 2.9).
   */
  detail: string;
}

/** Reason a tool call was not permitted (Req 3.6). */
export type ToolCallRejectionReason = "not_in_set" | "not_in_phase";

/** Outcome of a tool-call gating check (Req 3.6). */
export interface ToolCallPermission {
  permitted: boolean;
  reason?: ToolCallRejectionReason;
}

// Field bounds (Req 2.1, 2.4).
const ID_MIN = 1;
const ID_MAX = 64;
const NAME_MIN = 1;
const NAME_MAX = 128;
const DESCRIPTION_MAX = 1024;
const CONVERSATION_TYPES_MIN = 1;
const CONVERSATION_TYPES_MAX = 50;
const TOOLS_MAX = 100;
const PHASES_MIN = 1;
const PHASES_MAX = 20;

/**
 * The single source of truth for registered voice packs, keyed by pack id.
 * A Map keeps iteration order deterministic for resolution.
 */
const registry = new Map<string, VoiceDomainPack>();

/**
 * Validates a pack against the ordered rules. Returns the error to report, or
 * `null` when the pack is valid. This performs NO mutation, so callers can run
 * it before inserting to keep registration atomic (Req 2.3, 2.4, 2.6).
 */
function validatePack(pack: VoiceDomainPack): RegistrationError | null {
  // 1. id present, 1–64 chars → invalid_id (Req 2.2, 2.4).
  if (
    typeof pack.id !== "string" ||
    pack.id.length < ID_MIN ||
    pack.id.length > ID_MAX
  ) {
    return { code: "invalid_id", detail: "id" };
  }

  // 2. id unique → duplicate_id (Req 2.3).
  if (registry.has(pack.id)) {
    return { code: "duplicate_id", detail: pack.id };
  }

  // 3. Remaining field bounds → missing_field / field_out_of_bounds (Req 2.4).
  if (typeof pack.name !== "string" || pack.name.length < NAME_MIN) {
    return { code: "missing_field", detail: "name" };
  }
  if (pack.name.length > NAME_MAX) {
    return { code: "field_out_of_bounds", detail: "name" };
  }
  if (typeof pack.description !== "string") {
    return { code: "missing_field", detail: "description" };
  }
  if (pack.description.length > DESCRIPTION_MAX) {
    return { code: "field_out_of_bounds", detail: "description" };
  }
  if (!Array.isArray(pack.conversationTypes)) {
    return { code: "missing_field", detail: "conversationTypes" };
  }
  if (
    pack.conversationTypes.length < CONVERSATION_TYPES_MIN ||
    pack.conversationTypes.length > CONVERSATION_TYPES_MAX
  ) {
    return { code: "field_out_of_bounds", detail: "conversationTypes" };
  }
  if (!Array.isArray(pack.tools)) {
    return { code: "missing_field", detail: "tools" };
  }
  if (pack.tools.length > TOOLS_MAX) {
    return { code: "field_out_of_bounds", detail: "tools" };
  }
  if (!Array.isArray(pack.phases)) {
    return { code: "missing_field", detail: "phases" };
  }
  if (pack.phases.length < PHASES_MIN || pack.phases.length > PHASES_MAX) {
    return { code: "field_out_of_bounds", detail: "phases" };
  }

  // 4. Every tool.allowedPhases entry ∈ phases[].id → invalid_tool_phase (Req 2.6).
  const phaseIds = new Set(pack.phases.map((phase) => phase.id));
  for (const tool of pack.tools) {
    for (const phaseId of tool.allowedPhases) {
      if (!phaseIds.has(phaseId)) {
        return { code: "invalid_tool_phase", detail: phaseId };
      }
    }
  }

  // 5. Every conversationType.initialPhase ∈ phases[].id → field_out_of_bounds.
  for (const conversation of pack.conversationTypes) {
    if (!phaseIds.has(conversation.initialPhase)) {
      return { code: "field_out_of_bounds", detail: "initialPhase" };
    }
  }

  // 6. moduleBridge references must exist in the Module_Pack_System (Req 2.8, 2.9).
  if (pack.moduleBridge) {
    const { verticalPackId, reuseToolPackIds } = pack.moduleBridge;
    if (!hasToolPack(verticalPackId)) {
      return { code: "unknown_module_bridge", detail: verticalPackId };
    }
    for (const toolPackId of reuseToolPackIds) {
      if (!hasToolPack(toolPackId)) {
        return { code: "unknown_module_bridge", detail: toolPackId };
      }
    }
  }

  return null;
}

/**
 * Validates and registers a voice pack. On failure the registry is left
 * unchanged — validation completes fully before any insertion, so a rejected
 * pack never mutates the registry (Req 2.2, 2.3, 2.4, 2.6, 4.3).
 */
export function registerVoiceDomainPack(pack: VoiceDomainPack): RegisterResult {
  const error = validatePack(pack);
  if (error) {
    return { ok: false, error };
  }
  registry.set(pack.id, pack);
  return { ok: true };
}

/**
 * Resolves the single pack whose `conversationTypes` include `type`, or `null`
 * when no pack owns it. Conversation-type ownership is unique across the
 * registry (Req 3.1).
 */
export function resolvePackByConversationType(
  type: string
): VoiceDomainPack | null {
  for (const pack of registry.values()) {
    if (pack.conversationTypes.some((conversation) => conversation.type === type)) {
      return pack;
    }
  }
  return null;
}

/** True when a tool is allowed given the tenant's enabled integrations (Req 4.4). */
function integrationEnabled(
  tool: VoiceToolDefinition,
  enabledIntegrations: string[]
): boolean {
  if (!tool.requiresIntegration) {
    return true;
  }
  return enabledIntegrations.includes(tool.requiresIntegration);
}

/**
 * Returns the tools exposed for a tenant: voice-level integration gating plus,
 * when the pack carries a `moduleBridge`, module-level gating derived from the
 * linked tool packs so a tool disabled at the module level is never re-exposed
 * (Req 2.9, 4.4).
 *
 * - No bridge: the pack's own tools filtered by voice integration gating.
 * - Bridge `reuse`: only voice tools whose `reusesModuleTool` still appears in
 *   the module-gated membership of the reused tool packs.
 * - Bridge `extend`: the reused set plus voice-only tools (those with no
 *   `reusesModuleTool`) that pass voice integration gating.
 */
export function resolveToolSet(
  pack: VoiceDomainPack,
  enabledIntegrations: string[]
): VoiceToolDefinition[] {
  if (!pack.moduleBridge) {
    return pack.tools.filter((tool) =>
      integrationEnabled(tool, enabledIntegrations)
    );
  }

  // Collect the module-level (already integration-gated) tool names across all
  // reused tool packs. Any tool absent here is disabled at the module level.
  const moduleToolNames = new Set<string>();
  for (const toolPackId of pack.moduleBridge.reuseToolPackIds) {
    for (const moduleTool of getRegisteredToolPack(
      toolPackId,
      enabledIntegrations
    )) {
      moduleToolNames.add(moduleTool.name);
    }
  }

  const reused = pack.tools.filter(
    (tool) =>
      tool.reusesModuleTool !== undefined &&
      moduleToolNames.has(tool.reusesModuleTool) &&
      integrationEnabled(tool, enabledIntegrations)
  );

  if (pack.moduleBridge.mode === "reuse") {
    return reused;
  }

  // extend: add voice-only tools (no module counterpart) on top of the reused set.
  const voiceOnly = pack.tools.filter(
    (tool) =>
      tool.reusesModuleTool === undefined &&
      integrationEnabled(tool, enabledIntegrations)
  );
  return [...reused, ...voiceOnly];
}

/**
 * Reports whether `toolName` may be called in `phaseId`: permitted iff the tool
 * is present in the resolved `toolSet` AND `phaseId` is in that tool's
 * `allowedPhases` (Req 3.6). Membership is checked before phase so the reason
 * distinguishes `not_in_set` from `not_in_phase`.
 */
export function isToolCallPermitted(
  toolSet: VoiceToolDefinition[],
  toolName: string,
  phaseId: string
): ToolCallPermission {
  const tool = toolSet.find((candidate) => candidate.name === toolName);
  if (!tool) {
    return { permitted: false, reason: "not_in_set" };
  }
  if (!tool.allowedPhases.includes(phaseId)) {
    return { permitted: false, reason: "not_in_phase" };
  }
  return { permitted: true };
}

/** Clears all registered packs. Intended for testing only. */
export function clearRegistry(): void {
  registry.clear();
}
