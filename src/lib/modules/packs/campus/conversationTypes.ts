/**
 * Campus Pack — conversation type definitions.
 *
 * The `campus` VoiceDomainPack owns a single conversation type,
 * `campus_agent_conversation`, aligned with the platform `ConversationType`
 * union and the Convex `conversationTypeValidator` (design §"Where Campus plugs
 * into the Voice_Runtime"). It starts in the `greeting` phase and, when the
 * agent cannot proceed, falls back with `apologize_and_end` (design §"`campus`
 * VoiceDomainPack") — appropriate for a knowledge-grounded student agent that
 * has no human queue to escalate to.
 *
 * The conversation type omits a per-conversation `prompt` override so it falls
 * back to the pack's `defaultPrompt` template, which the session driver
 * populates per call from the resolved Campus_Agent config and approved
 * knowledge (Req 8.4).
 *
 * Requirements: 5.5, 8.3, 8.4, 8.5, 8.6
 */

import type { ConversationTypeDefinition } from "@/lib/modules/voiceDomainPack";
import { CAMPUS_INITIAL_PHASE } from "@/lib/modules/packs/campus/phases";

/** The conversation type string owned by the campus pack. */
export const CAMPUS_AGENT_CONVERSATION_TYPE = "campus_agent_conversation";

/**
 * Transcript metadata captured for a campus voice conversation. `campusAgentId`
 * correlates the call to its Campus_Agent for analytics (Req 8.8, 9.1); the
 * remaining fields describe the agent context recorded on the transcript. All
 * are optional so a transcript record is complete without them.
 */
const campusTranscriptMetadata = {
  fields: {
    campusAgentId: { label: "Campus agent", type: "string", required: false },
    agentType: { label: "Agent type", type: "string", required: false },
    campusTag: { label: "Campus", type: "string", required: false },
  },
} as const;

/**
 * The knowledge-grounded Campus_Agent voice conversation. Begins in `greeting`;
 * the agent greets in its selected voice (Req 8.3), answers only from approved
 * knowledge (Req 8.4, 8.5), and may offer the creator contact link on a routing
 * match (Req 8.6). On an unrecoverable failure it apologizes and ends.
 */
export const campusAgentConversation: ConversationTypeDefinition = {
  type: CAMPUS_AGENT_CONVERSATION_TYPE,
  initialPhase: CAMPUS_INITIAL_PHASE,
  transcriptMetadata: campusTranscriptMetadata,
  fallbackBehavior: { kind: "apologize_and_end" },
};

/** The complete set of conversation types the campus pack declares. */
export const campusConversationTypes: readonly ConversationTypeDefinition[] = [
  campusAgentConversation,
];
