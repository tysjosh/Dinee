/**
 * Feature: dinee-campus (Task 9.1)
 *
 * Pure, property-testable core for the campus Voice_Runtime session assembly:
 * session configuration, system-prompt assembly, knowledge grounding, and
 * creator-contact routing. These functions carry NO Convex `ctx` and perform
 * no I/O, so they can be exercised directly by unit and property tests and
 * imported both by the `campus` VoiceDomainPack / session driver (Task 27) and
 * the property tests.
 *
 * Per the design, the `campus` pack is product-agnostic: per-call behavior
 * (voice, personality, knowledge, boundaries, creator-contact routing) is
 * resolved from `campusAgents` + `Knowledge_Store.getGroundingContext` at
 * session start and injected here. These functions model exactly that
 * deterministic assembly and lookup.
 *
 * Covered behaviors:
 *   - 8.3: the session responds in the Campus_Agent's selected voice — the
 *     session config's `voiceId` is exactly the agent's `voiceId`.
 *   - 8.4: responses are constrained to the agent's configured name, purpose,
 *     Knowledge_Store content, and boundaries — the assembled system prompt
 *     reflects the agent's name, purpose, an approved-knowledge summary, and a
 *     boundary instruction.
 *   - 5.5 / 8.5: a question whose answer is not present in the associated
 *     (approved) Knowledge_Store content produces a no-answer signal that maps
 *     to the "cannot answer from available knowledge" fallback rather than an
 *     unsupported answer.
 *   - 8.6: WHERE a creator contact link is configured, WHEN a Caller's request
 *     matches the configured routing condition, the link is offered — offered
 *     iff a link is configured AND the request matches the routing condition.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The configured routing condition that governs when a Caller's request should
 * be routed to the creator contact link (Req 8.6). The condition matches when
 * the request contains any of the configured keywords (case-insensitive). An
 * empty keyword set never matches.
 */
export interface CreatorContactRouting {
  keywords: readonly string[];
}

/**
 * The per-call runtime configuration for a Campus_Agent, resolved from
 * `campusAgents` at session start and injected into the campus pack.
 */
export interface CampusAgentRuntimeConfig {
  agentId: string;
  /** Display name of the agent (Req 8.4). */
  name: string;
  /** The voice the agent responds in — becomes the session voice (Req 8.3). */
  voiceId: string;
  /** The agent's purpose/description that scopes its responses (Req 8.4). */
  purpose: string;
  /** Optional personality/tone guidance folded into the prompt (Req 8.4). */
  personalityTone?: string;
  /** Optional additional boundary text folded into the prompt (Req 8.4). */
  boundaries?: string;
  /** Optional creator contact link offered on a routing match (Req 8.6). */
  creatorContactLink?: string;
  /** Optional routing condition governing the creator-contact offer (Req 8.6). */
  creatorContactRouting?: CreatorContactRouting;
}

/**
 * A single unit of approved knowledge available for grounding, mirroring an
 * approved `campusKnowledgeSources` projection (Req 5.4). `keywords`, when
 * present, are used for matching; otherwise keywords are derived from
 * `content`.
 */
export interface GroundingEntry {
  sourceId: string;
  content: string;
  keywords?: readonly string[];
}

/** The assembled session configuration for a campus voice conversation. */
export interface CampusSessionConfig {
  agentId: string;
  /** Exactly the agent's `voiceId` (Req 8.3). */
  voiceId: string;
  /** The assembled system prompt (Req 8.4). */
  systemPrompt: string;
}

/**
 * The outcome of a grounding lookup for a Caller question. `answered: true`
 * carries the matching approved-knowledge entries; `answered: false` carries
 * the "cannot answer" fallback message (Req 5.5, 8.5).
 */
export type GroundingResult =
  | { answered: true; matches: GroundingEntry[] }
  | { answered: false; fallback: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The fallback message the agent uses when a question is not answerable from
 * the approved Knowledge_Store content (Req 5.5, 8.5). It indicates the agent
 * cannot answer from the available knowledge rather than generating an
 * unsupported answer.
 */
export const CANNOT_ANSWER_FALLBACK =
  "I'm sorry — that isn't in the knowledge I've been given, so I can't answer that.";

/**
 * The boundary instruction embedded in every campus system prompt (Req 8.4,
 * 5.5, 8.5). It constrains the model to answer only from the approved
 * knowledge and to use the fallback otherwise.
 */
export const BOUNDARY_INSTRUCTION =
  "Answer only using the approved knowledge above and your stated purpose. " +
  "If a question cannot be answered from that knowledge, do not guess or make " +
  `anything up — say: "${CANNOT_ANSWER_FALLBACK}"`;

/** The minimum token length considered meaningful for grounding matches. */
const MIN_TOKEN_LENGTH = 3;

// ---------------------------------------------------------------------------
// Tokenization (internal)
// ---------------------------------------------------------------------------

/**
 * Splits text into a set of lowercase alphanumeric tokens of at least
 * {@link MIN_TOKEN_LENGTH} characters. Deterministic and non-mutating.
 */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= MIN_TOKEN_LENGTH) {
      tokens.add(raw);
    }
  }
  return tokens;
}

/** Returns the matching tokens for a grounding entry (explicit or derived). */
function entryTokens(entry: GroundingEntry): Set<string> {
  if (entry.keywords && entry.keywords.length > 0) {
    const tokens = new Set<string>();
    for (const keyword of entry.keywords) {
      for (const token of tokenize(keyword)) {
        tokens.add(token);
      }
    }
    return tokens;
  }
  return tokenize(entry.content);
}

/** True iff sets `a` and `b` share at least one element. */
function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Knowledge summary + prompt assembly (Req 8.4)
// ---------------------------------------------------------------------------

/**
 * Produces a human-readable summary of the approved knowledge available to the
 * agent, used in the system prompt (Req 8.4). When there is no approved
 * knowledge, returns an explicit "no knowledge" line so the model still knows
 * it must fall back for every substantive question (Req 5.5, 8.5). Pure and
 * non-mutating.
 */
export function summarizeKnowledge(entries: readonly GroundingEntry[]): string {
  if (entries.length === 0) {
    return "No approved knowledge has been added for this agent yet.";
  }
  return entries
    .map((entry, index) => `${index + 1}. ${entry.content}`)
    .join("\n");
}

/**
 * Assembles the campus system prompt from the agent's configured name,
 * purpose, personality/tone, an approved-knowledge summary, and the boundary
 * instruction (Req 8.4). The prompt instructs the model to answer only from
 * the approved knowledge and to use the fallback otherwise (Req 5.5, 8.5).
 * Pure and non-mutating.
 */
export function assembleSystemPrompt(
  agent: CampusAgentRuntimeConfig,
  entries: readonly GroundingEntry[]
): string {
  const sections: string[] = [
    `You are "${agent.name}", an AI voice agent.`,
    `Purpose: ${agent.purpose}`,
  ];

  if (agent.personalityTone && agent.personalityTone.length > 0) {
    sections.push(`Personality and tone: ${agent.personalityTone}`);
  }
  if (agent.boundaries && agent.boundaries.length > 0) {
    sections.push(`Additional boundaries: ${agent.boundaries}`);
  }

  sections.push("Approved knowledge:", summarizeKnowledge(entries));
  sections.push(BOUNDARY_INSTRUCTION);

  if (agent.creatorContactLink && agent.creatorContactLink.length > 0) {
    sections.push(
      "If the caller's request matches the configured routing condition, " +
        `offer them the creator's contact link: ${agent.creatorContactLink}`
    );
  }

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Session config (Req 8.3, 8.4)
// ---------------------------------------------------------------------------

/**
 * Assembles the full session configuration for a campus voice conversation
 * (Req 8.3, 8.4). The session voice is exactly the agent's `voiceId` (Req 8.3)
 * and the system prompt reflects the agent's identity, purpose, approved
 * knowledge, and boundaries (Req 8.4). Pure and non-mutating.
 */
export function buildSessionConfig(
  agent: CampusAgentRuntimeConfig,
  entries: readonly GroundingEntry[] = []
): CampusSessionConfig {
  return {
    agentId: agent.agentId,
    voiceId: agent.voiceId,
    systemPrompt: assembleSystemPrompt(agent, entries),
  };
}

// ---------------------------------------------------------------------------
// Grounding retrieval (Req 5.5, 8.5)
// ---------------------------------------------------------------------------

/**
 * Retrieves the approved-knowledge entries relevant to a Caller question
 * (Req 5.4). A question matches an entry when they share at least one
 * meaningful token. When no approved entry matches — including when there is no
 * approved knowledge at all — the result is a no-answer signal carrying the
 * {@link CANNOT_ANSWER_FALLBACK} message (Req 5.5, 8.5), so the runtime
 * responds that it cannot answer rather than generating an unsupported answer.
 * Pure and non-mutating.
 */
export function retrieveGrounding(
  question: string,
  entries: readonly GroundingEntry[]
): GroundingResult {
  const questionTokens = tokenize(question);
  const matches = entries.filter((entry) =>
    intersects(questionTokens, entryTokens(entry))
  );

  if (matches.length === 0) {
    return { answered: false, fallback: CANNOT_ANSWER_FALLBACK };
  }
  return { answered: true, matches };
}

// ---------------------------------------------------------------------------
// Creator-contact routing (Req 8.6)
// ---------------------------------------------------------------------------

/**
 * True iff the Caller's request matches the configured routing condition — the
 * request contains any configured keyword (case-insensitive) (Req 8.6). An
 * undefined or empty routing condition never matches. Pure and non-mutating.
 */
export function requestMatchesRoutingCondition(
  requestText: string,
  routing: CreatorContactRouting | undefined
): boolean {
  if (!routing || routing.keywords.length === 0) {
    return false;
  }
  const normalized = requestText.toLowerCase();
  return routing.keywords.some((keyword) => {
    const trimmed = keyword.trim().toLowerCase();
    return trimmed.length > 0 && normalized.includes(trimmed);
  });
}

/**
 * The outcome of the creator-contact routing decision (Req 8.6). When the link
 * is offered, the configured link is included so the runtime can surface it.
 */
export type CreatorContactDecision =
  | { offer: true; link: string }
  | { offer: false };

/**
 * Decides whether to offer the Caller the creator contact link for a given
 * request (Req 8.6). The link is offered iff BOTH a non-empty
 * `creatorContactLink` is configured AND the request matches the configured
 * routing condition. Absent a configured link, or on a non-matching request,
 * no offer is made. Pure and non-mutating.
 */
export function decideCreatorContactOffer(
  agent: CampusAgentRuntimeConfig,
  requestText: string
): CreatorContactDecision {
  const link = agent.creatorContactLink;
  if (!link || link.length === 0) {
    return { offer: false };
  }
  if (!requestMatchesRoutingCondition(requestText, agent.creatorContactRouting)) {
    return { offer: false };
  }
  return { offer: true, link };
}
