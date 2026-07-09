/**
 * Feature: dinee-campus (browser voice transport) — pure realtime-config logic.
 *
 * The decision logic behind the browser WebRTC voice path, factored out of the
 * Next token route (`/campus/api/realtime-token`) and the Convex
 * `getCallRealtimeConfig` query so it carries NO Convex `ctx` and no I/O and can
 * be exercised directly by unit/property tests (matching this repo's
 * pure-predicate testing convention):
 *
 *   - {@link mapCampusVoiceToOpenAI}: maps a Campus_Agent `voiceId` to a
 *     supported OpenAI Realtime voice, defaulting for unknown ids (Req 8.3).
 *   - {@link buildRealtimeSessionConfig}: assembles the ephemeral-session config
 *     body sent to OpenAI when minting a client secret (voice + instructions).
 *   - {@link isCallRealtimeEligible}: the capability gate — a realtime session
 *     may be configured only for an active campus call (Req 8.1).
 */

/** The OpenAI Realtime voices a session may request. */
export const OPENAI_REALTIME_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

export type OpenAiRealtimeVoice = (typeof OPENAI_REALTIME_VOICES)[number];

/** The neutral fallback voice used for an unmapped Campus_Agent voice id. */
export const DEFAULT_REALTIME_VOICE: OpenAiRealtimeVoice = "alloy";

/**
 * Maps each Campus_Agent voice option (`CAMPUS_VOICES` in the client) to a
 * supported OpenAI Realtime voice. `campus_voice_sol` has no exact OpenAI
 * counterpart and maps to the calm `sage` voice.
 */
export const CAMPUS_VOICE_TO_OPENAI: Readonly<Record<string, OpenAiRealtimeVoice>> = {
  campus_voice_alloy: "alloy",
  campus_voice_verse: "verse",
  campus_voice_shimmer: "shimmer",
  campus_voice_sol: "sage",
};

/**
 * Maps a Campus_Agent `voiceId` to a supported OpenAI Realtime voice, falling
 * back to {@link DEFAULT_REALTIME_VOICE} for any unknown/empty id so a session
 * is never rejected for an unmapped voice. Pure.
 */
export function mapCampusVoiceToOpenAI(voiceId: string): OpenAiRealtimeVoice {
  // Own-property lookup only: a bare index (`map[voiceId]`) would resolve
  // inherited members like `toString`/`constructor` to functions, bypassing the
  // fallback. Guard so any non-mapped id — including such names — maps to the
  // neutral default.
  return Object.prototype.hasOwnProperty.call(CAMPUS_VOICE_TO_OPENAI, voiceId)
    ? CAMPUS_VOICE_TO_OPENAI[voiceId]
    : DEFAULT_REALTIME_VOICE;
}

// ---------------------------------------------------------------------------
// Live knowledge-lookup tool (Req 5.5, 8.4, 8.5)
// ---------------------------------------------------------------------------

/** The name of the read-only knowledge-grounding tool exposed to the model. */
export const CAMPUS_LOOKUP_TOOL_NAME = "campus_lookup_knowledge";

/** A Realtime function-tool declaration included in the session config. */
export interface RealtimeFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/**
 * The tools advertised to the model on a campus call. Exactly one, read-only:
 * `campus_lookup_knowledge` retrieves approved knowledge for the Caller's
 * question so the model answers strictly from the agent's Knowledge_Store, and
 * says it does not know when nothing matches (Req 5.5, 8.4, 8.5).
 */
export const CAMPUS_REALTIME_TOOLS: readonly RealtimeFunctionTool[] = [
  {
    type: "function",
    name: CAMPUS_LOOKUP_TOOL_NAME,
    description:
      "Retrieve approved knowledge relevant to the caller's question. Call this " +
      "before answering any factual question so you answer strictly from the " +
      "agent's approved knowledge. If it returns a no-answer result, tell the " +
      "caller you don't know rather than guessing.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The caller's question to retrieve approved knowledge for.",
        },
      },
      required: ["question"],
    },
  },
];

/** The ephemeral-session config body posted to OpenAI's client-secret endpoint. */
export interface RealtimeSessionConfig {
  session: {
    type: "realtime";
    model: string;
    instructions: string;
    audio: { output: { voice: OpenAiRealtimeVoice } };
    tools: readonly RealtimeFunctionTool[];
    tool_choice: "auto";
  };
}

/**
 * Builds the OpenAI Realtime ephemeral-session config for a campus call: the
 * requested model, the agent's assembled system prompt as the session
 * `instructions` (so the model answers only from the agent's knowledge, Req
 * 8.4), the mapped output voice (Req 8.3), and the read-only knowledge-lookup
 * tool so the model can ground answers live (Req 5.5, 8.5). Pure and
 * non-mutating.
 */
export function buildRealtimeSessionConfig(input: {
  model: string;
  voiceId: string;
  systemPrompt: string;
}): RealtimeSessionConfig {
  return {
    session: {
      type: "realtime",
      model: input.model,
      instructions: input.systemPrompt,
      audio: { output: { voice: mapCampusVoiceToOpenAI(input.voiceId) } },
      tools: CAMPUS_REALTIME_TOOLS,
      tool_choice: "auto",
    },
  };
}

/**
 * The grounding result shape the lookup tool formats into model output — a
 * minimal view of the pure `retrieveGrounding` result (answered with matched
 * approved-knowledge content, or a no-answer fallback message). Kept local so
 * this module stays free of a runtime import cycle with `session.ts`.
 */
export type GroundingToolResult =
  | { answered: true; matches: readonly { content: string }[] }
  | { answered: false; fallback: string };

/**
 * Formats a grounding lookup result into the plain-text `output` returned to the
 * model as the tool result (Req 8.4, 8.5). An answered result concatenates the
 * matched approved-knowledge content; a no-answer result returns the fallback
 * message verbatim so the model tells the Caller it does not know rather than
 * fabricating an answer. Pure and non-mutating.
 */
export function formatGroundingToolOutput(result: GroundingToolResult): string {
  if (!result.answered) {
    return result.fallback;
  }
  return result.matches
    .map((m) => m.content.trim())
    .filter((c) => c.length > 0)
    .join("\n\n");
}

/** The minimal `calls` view the realtime capability gate inspects. */
export interface RealtimeCallView {
  status?: string | null;
  campusAgentId?: string | null;
}

/**
 * The realtime capability gate: a realtime media session may be configured only
 * for a call that exists, is still `active`, and is correlated to a
 * Campus_Agent (Req 8.1). An absent call, a non-`active` call (e.g. already
 * ended), or a non-campus call is ineligible, so a guessed/expired call id
 * yields no session config. Pure and non-mutating.
 */
export function isCallRealtimeEligible(
  call: RealtimeCallView | null | undefined
): boolean {
  return (
    !!call &&
    call.status === "active" &&
    typeof call.campusAgentId === "string" &&
    call.campusAgentId.length > 0
  );
}
