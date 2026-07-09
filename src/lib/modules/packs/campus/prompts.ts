/**
 * Campus Pack — default system prompt template.
 *
 * The `campus` VoiceDomainPack is product-agnostic: the concrete per-call system
 * prompt (agent name, purpose, personality, approved-knowledge summary, and
 * boundaries) is assembled from `campusAgents` + `Knowledge_Store` at session
 * start by `assembleSystemPrompt` in the shared session logic
 * (`convex/campus/logic/session.ts`, re-exported via `@/lib/campus/session`).
 *
 * This module contributes only the pack's `defaultPrompt` — the template used
 * when a conversation type omits its own prompt. It is a placeholder template
 * populated per call, and it reuses the single-source-of-truth
 * {@link BOUNDARY_INSTRUCTION} / {@link CANNOT_ANSWER_FALLBACK} so the
 * answer-only-from-knowledge boundary and the "cannot answer" fallback stay
 * identical to the assembled per-call prompt (Req 5.5, 8.5). The template
 * placeholders below mirror the sections `assembleSystemPrompt` fills in
 * (Req 8.4).
 *
 * Requirements: 5.5, 8.3, 8.4, 8.5, 8.6
 */

import {
  BOUNDARY_INSTRUCTION,
  CANNOT_ANSWER_FALLBACK,
} from "@/lib/campus/session";

/** Re-exported for callers assembling campus fallbacks alongside the template. */
export { BOUNDARY_INSTRUCTION, CANNOT_ANSWER_FALLBACK };

/**
 * The campus default system prompt template. `{{name}}`, `{{purpose}}`,
 * `{{personalityTone}}`, and `{{knowledgeSummary}}` are populated per call by
 * the session driver from the resolved Campus_Agent config and approved
 * knowledge (Req 8.4); the trailing boundary instruction constrains the model
 * to answer only from that knowledge and to use the fallback otherwise
 * (Req 5.5, 8.5).
 */
export const CAMPUS_DEFAULT_PROMPT = [
  `You are "{{name}}", an AI voice agent.`,
  "Purpose: {{purpose}}",
  "Personality and tone: {{personalityTone}}",
  "Approved knowledge:\n{{knowledgeSummary}}",
  BOUNDARY_INSTRUCTION,
].join("\n\n");
