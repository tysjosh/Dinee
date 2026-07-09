/**
 * Campus Pack — voice tool definitions.
 *
 * The `campus` VoiceDomainPack exposes exactly two voice-only tools, both
 * read-only. Neither mutates state: `campus_lookup_knowledge` retrieves grounded
 * content from the agent's approved Knowledge_Store, and
 * `campus_offer_creator_contact` surfaces the creator's configured contact link.
 * Both are backed by internal Campus Convex functions (no external
 * integration), so no tool declares `requiresIntegration`.
 *
 * The tools are intentionally product-agnostic: the per-call knowledge and the
 * creator-contact link/routing condition are resolved from `campusAgents` +
 * `Knowledge_Store.getGroundingContext` and injected by the session driver at
 * session start (task 27.2), not baked into the tool definitions here.
 *
 * Phase gating (mirrors `phases.ts`, enforced by the registry's
 * `isToolCallPermitted`):
 * - campus_lookup_knowledge:      greeting, conversing
 * - campus_offer_creator_contact: conversing, wrap_up
 *
 * Requirements: 5.5, 8.3, 8.4, 8.5, 8.6
 */

import type { VoiceToolDefinition } from "@/lib/modules/voiceDomainPack";
import {
  GREETING_PHASE,
  CONVERSING_PHASE,
  WRAP_UP_PHASE,
} from "@/lib/modules/packs/campus/phases";

/**
 * Retrieve grounded content for a Caller question from the Campus_Agent's
 * approved Knowledge_Store (Req 8.4). Read-only. When the question matches no
 * approved knowledge, the grounding lookup returns a no-answer signal so the
 * agent responds that it does not know rather than guessing (Req 5.5, 8.5).
 * Permitted while the agent is greeting or actively conversing.
 */
export const campusLookupKnowledgeTool: VoiceToolDefinition = {
  name: "campus_lookup_knowledge",
  description:
    "Retrieve approved knowledge relevant to the caller's question so the agent " +
    "can answer strictly from the Campus_Agent's Knowledge_Store. Returns a " +
    "no-answer signal when nothing in the approved knowledge matches, in which " +
    "case the agent must say it does not know rather than guessing.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The caller's question, used to retrieve matching approved knowledge.",
      },
    },
    required: ["question"],
  },
  allowedPhases: [GREETING_PHASE, CONVERSING_PHASE],
  readOnly: true,
  handler: "campus_lookup_knowledge",
};

/**
 * Offer the Caller the creator's configured contact link — but only when a link
 * is configured AND the Caller's request matches the configured routing
 * condition (Req 8.6). Read-only: it surfaces an already-configured link and
 * mutates nothing. Permitted while conversing or wrapping up.
 */
export const campusOfferCreatorContactTool: VoiceToolDefinition = {
  name: "campus_offer_creator_contact",
  description:
    "Offer the caller the creator's contact link. Only call this when the " +
    "Campus_Agent has a creator contact link configured and the caller's request " +
    "matches the configured routing condition; otherwise do not offer the link.",
  parameters: {
    type: "object",
    properties: {
      requestText: {
        type: "string",
        description:
          "The caller's request, evaluated against the configured routing " +
          "condition to decide whether the creator contact link should be offered.",
      },
    },
    required: ["requestText"],
  },
  allowedPhases: [CONVERSING_PHASE, WRAP_UP_PHASE],
  readOnly: true,
  handler: "campus_offer_creator_contact",
};

/**
 * The complete campus voice tool set. Both tools are read-only; phase gating is
 * enforced by each tool's `allowedPhases`.
 */
export const campusTools: readonly VoiceToolDefinition[] = [
  campusLookupKnowledgeTool,
  campusOfferCreatorContactTool,
];
