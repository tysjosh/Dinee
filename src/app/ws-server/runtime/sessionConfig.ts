/**
 * Pack-driven session config builder.
 *
 * Builds the OpenAI Realtime `session.update` payload for a call from a
 * resolved {@link VoiceDomainPack} and the active conversation type. The
 * payload carries the system prompt (the conversation type's prompt override
 * or the pack's default prompt), the integration-gated tool set converted to
 * the OpenAI function-tool shape, and a transcription hint.
 *
 * The Voice_Runtime loads the tool definitions and system prompt from the
 * resolved pack (Req 3.3) and applies them via this payload before the
 * Realtime_Agent produces its first spoken response (Req 3.4). This module is
 * pure and deterministic so it is directly unit-testable.
 *
 * Requirements: 3.3, 3.4
 */

import type {
  ConversationTypeDefinition,
  JSONSchema,
  VoiceDomainPack,
  VoiceToolDefinition,
} from "@/lib/modules/voiceDomainPack";
import { resolveToolSet } from "@/lib/modules/voiceDomainPackRegistry";

/** An OpenAI Realtime function-tool definition (Req 3.3). */
export interface OpenAIFunctionTool {
  /** OpenAI tool discriminator; always "function" for pack tools. */
  type: "function";
  /** Tool name exposed to the model. */
  name: string;
  /** Natural-language description for the model. */
  description: string;
  /** JSON-schema parameter definition. */
  parameters: JSONSchema;
}

/** The transcription hint applied to the Realtime session (Req 3.3). */
export interface RealtimeTranscriptionConfig {
  /** Transcription model id. */
  model: string;
  /** Domain hint that biases transcription toward expected vocabulary. */
  prompt: string;
  /** BCP-47 language code. */
  language: string;
}

/** The Realtime `session` object applied before the first spoken response. */
export interface RealtimeSessionConfig {
  turn_detection: { type: string };
  input_audio_format: string;
  output_audio_format: string;
  voice: string;
  instructions: string;
  modalities: string[];
  temperature: number;
  input_audio_transcription: RealtimeTranscriptionConfig;
  tools: OpenAIFunctionTool[];
}

/** The full `session.update` message sent to the OpenAI Realtime socket. */
export interface SessionUpdatePayload {
  type: "session.update";
  session: RealtimeSessionConfig;
}

/**
 * Tunable session parameters. Defaults mirror the existing Voice_Runtime
 * (`src/app/ws-server/index.ts`) so the extracted builder produces a
 * byte-compatible `session.update` payload.
 */
export interface SessionConfigOptions {
  /** Realtime voice id. Defaults to "alloy". */
  voice?: string;
  /** Sampling temperature. Defaults to 0.8. */
  temperature?: number;
  /** Transcription model id. Defaults to "gpt-4o-mini-transcribe". */
  transcriptionModel?: string;
  /** Transcription language. Defaults to "en". */
  transcriptionLanguage?: string;
  /**
   * Optional domain hint for the transcription model. When omitted, a generic
   * hint is derived from the pack name.
   */
  transcriptionPrompt?: string;
  /** Input audio format. Defaults to "g711_ulaw". */
  inputAudioFormat?: string;
  /** Output audio format. Defaults to "g711_ulaw". */
  outputAudioFormat?: string;
}

const DEFAULT_VOICE = "alloy";
const DEFAULT_TEMPERATURE = 0.8;
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_TRANSCRIPTION_LANGUAGE = "en";
const DEFAULT_AUDIO_FORMAT = "g711_ulaw";

/**
 * Converts a pack tool definition into the OpenAI Realtime function-tool shape.
 * Only the fields OpenAI expects are projected; voice-only metadata such as
 * `allowedPhases`, `requiresIntegration`, and `handler` is intentionally
 * dropped from the payload sent to the model.
 */
function toOpenAIFunctionTool(tool: VoiceToolDefinition): OpenAIFunctionTool {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

/**
 * Finds the definition for `conversationType` within `pack`. The conversation
 * type is expected to be owned by the resolved pack (resolution precedes
 * session config building per Req 3.2); an unknown type is a programming error.
 */
function findConversation(
  pack: VoiceDomainPack,
  conversationType: string
): ConversationTypeDefinition {
  const conversation = pack.conversationTypes.find(
    (candidate) => candidate.type === conversationType
  );
  if (!conversation) {
    throw new Error(
      `Conversation type "${conversationType}" is not owned by pack "${pack.id}"`
    );
  }
  return conversation;
}

/**
 * Builds the OpenAI `session.update` payload for a resolved pack and
 * conversation type.
 *
 * - **Prompt (Req 3.3):** the conversation type's `prompt` override when
 *   present, otherwise the pack's `defaultPrompt`.
 * - **Tools (Req 3.3, 4.4):** the integration-gated tool set from
 *   {@link resolveToolSet}, converted to the OpenAI function-tool shape.
 * - **Transcription hint (Req 3.3):** the supplied `transcriptionPrompt` or a
 *   generic hint derived from the pack name.
 *
 * The returned payload is applied before the Realtime_Agent's first spoken
 * response (Req 3.4).
 *
 * @param pack             The resolved VoiceDomainPack.
 * @param conversationType The active conversation type owned by `pack`.
 * @param enabledIntegrations The tenant's enabled integration ids used for gating.
 * @param options          Optional session tunables (voice, temperature, etc.).
 * @returns The `session.update` message ready to send to the Realtime socket.
 */
export function buildSessionConfig(
  pack: VoiceDomainPack,
  conversationType: string,
  enabledIntegrations: string[],
  options: SessionConfigOptions = {}
): SessionUpdatePayload {
  const conversation = findConversation(pack, conversationType);

  const instructions = conversation.prompt ?? pack.defaultPrompt;

  const tools = resolveToolSet(pack, enabledIntegrations).map(
    toOpenAIFunctionTool
  );

  const transcriptionPrompt =
    options.transcriptionPrompt ??
    `Expect words related to ${pack.name}.`;

  return {
    type: "session.update",
    session: {
      turn_detection: { type: "server_vad" },
      input_audio_format: options.inputAudioFormat ?? DEFAULT_AUDIO_FORMAT,
      output_audio_format: options.outputAudioFormat ?? DEFAULT_AUDIO_FORMAT,
      voice: options.voice ?? DEFAULT_VOICE,
      instructions,
      modalities: ["text", "audio"],
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      input_audio_transcription: {
        model: options.transcriptionModel ?? DEFAULT_TRANSCRIPTION_MODEL,
        prompt: transcriptionPrompt,
        language:
          options.transcriptionLanguage ?? DEFAULT_TRANSCRIPTION_LANGUAGE,
      },
      tools,
    },
  };
}
