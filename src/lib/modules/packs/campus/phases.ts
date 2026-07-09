/**
 * Campus Pack — conversation phase machine.
 *
 * Declares the `campus` VoiceDomainPack phase machine against the
 * {@link CallPhaseDefinition} contract: a Campus_Agent voice conversation
 * moves `greeting → conversing → wrap_up`, ending in the terminal `wrap_up`
 * phase (design §"`campus` VoiceDomainPack").
 *
 * Phase flow:
 *   greeting   --(caller_engaged)---> conversing
 *   conversing --(wrap_up_started)--> wrap_up (terminal)
 *
 * Per-phase tool permissions (mirrored onto each tool's `allowedPhases` in
 * `tools.ts`, enforced by the registry's `isToolCallPermitted`):
 * - greeting (initial):   campus_lookup_knowledge
 * - conversing:           campus_lookup_knowledge, campus_offer_creator_contact
 * - wrap_up (terminal):   campus_offer_creator_contact
 *
 * Requirements: 5.5, 8.3, 8.4, 8.5, 8.6
 */

import type { CallPhaseDefinition } from "@/lib/modules/voiceDomainPack";

/** Initial phase: the agent greets the Caller in its selected voice (Req 8.3). */
export const GREETING_PHASE = "greeting";

/** Active Q&A phase: the agent answers grounded questions (Req 8.4, 8.5). */
export const CONVERSING_PHASE = "conversing";

/** Terminal phase: the conversation is wrapping up before it ends (Req 8.7). */
export const WRAP_UP_PHASE = "wrap_up";

/** Event that advances greeting → conversing once the Caller engages. */
export const CALLER_ENGAGED_EVENT = "caller_engaged";

/** Event that advances conversing → wrap_up as the conversation closes. */
export const WRAP_UP_STARTED_EVENT = "wrap_up_started";

/** The phase a campus_agent_conversation starts in. */
export const CAMPUS_INITIAL_PHASE = GREETING_PHASE;

/**
 * The campus conversation phase machine. Only the declared transitions advance
 * the phase; any other event leaves the phase unchanged (generic
 * `phaseEngine.nextPhase` semantics). `wrap_up` is terminal: it has no outgoing
 * transitions, matching the restaurant pack's terminal-phase convention.
 *
 * Requirements: 5.5, 8.3, 8.4, 8.5, 8.6
 */
export const campusPhases: CallPhaseDefinition[] = [
  {
    id: GREETING_PHASE,
    transitions: [{ event: CALLER_ENGAGED_EVENT, to: CONVERSING_PHASE }],
  },
  {
    id: CONVERSING_PHASE,
    transitions: [{ event: WRAP_UP_STARTED_EVENT, to: WRAP_UP_PHASE }],
  },
  {
    id: WRAP_UP_PHASE,
    transitions: [],
    terminal: true,
  },
];
