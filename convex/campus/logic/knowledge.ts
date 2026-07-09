/**
 * Feature: dinee-campus (Task 6.1)
 *
 * Pure, property-testable core for the Knowledge_Store acceptance and
 * association behavior (Requirements 5.1, 5.2, 5.6, 13.1). These functions
 * carry NO Convex `ctx` and perform no I/O, so they can be exercised directly
 * by unit and property tests and imported by the Convex `knowledge.ts` service
 * that wraps them with storage + persistence.
 *
 * Covered behaviors:
 *   - 5.1: type limits — typed instructions ≤ 10,000 chars; FAQ ≤ 500 entries,
 *     each answer ≤ 2,000 chars; supported document type + size within limits.
 *   - 5.6: reject unsupported document type or a document exceeding the
 *     platform maximum of 20 MB, identifying the specific reason and leaving
 *     previously stored content unchanged.
 *   - 13.1: layered document-size limits — the platform maximum (20 MB) is
 *     evaluated FIRST; a per-tier per-document limit (free tier: 10 MB) is
 *     evaluated only when the platform maximum is satisfied.
 *   - 5.2: an accepted source is associated with (and only with) its owning
 *     agent id.
 */

// ---------------------------------------------------------------------------
// Limits (Req 5.1, 5.6, 13.1)
// ---------------------------------------------------------------------------

/** Maximum length, in characters, of a typed-instructions source (Req 5.1). */
export const MAX_INSTRUCTIONS_CHARS = 10_000;

/** Maximum number of FAQ entries in a single FAQ source (Req 5.1). */
export const MAX_FAQ_ENTRIES = 500;

/** Maximum length, in characters, of a single FAQ answer (Req 5.1). */
export const MAX_FAQ_ANSWER_CHARS = 2_000;

/** One mebibyte in bytes. */
const MIB = 1024 * 1024;

/**
 * Platform-wide maximum document size in bytes (20 MB). Applies to every
 * upload regardless of account tier and is the FIRST size layer checked
 * (Req 5.6, 13.1).
 */
export const PLATFORM_MAX_DOCUMENT_BYTES = 20 * MIB;

/**
 * Per-tier per-document size limits in bytes. The free tier's 10 MB limit is
 * stricter than the platform maximum and is the SECOND size layer checked,
 * only after the platform maximum is satisfied (Req 13.1).
 */
export const PER_TIER_DOCUMENT_LIMIT_BYTES: Readonly<Record<AccountTier, number>> = {
  free: 10 * MIB,
  paid: PLATFORM_MAX_DOCUMENT_BYTES,
};

/**
 * Document MIME types the Knowledge_Store accepts (Req 5.6). Any type outside
 * this set is rejected as `unsupported_document_type`.
 */
export const SUPPORTED_DOCUMENT_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Account tiers that carry a per-document size limit (Req 13.1). */
export type AccountTier = "free" | "paid";

/**
 * The Knowledge_Source kinds accepted for a Campus_Agent (Req 5.1), matching
 * the `campusKnowledgeSources.kind` union in the schema.
 */
export type KnowledgeSourceKind =
  | "instructions"
  | "faq"
  | "document"
  | "link"
  | "event"
  | "club"
  | "course";

/** A single FAQ question/answer pair (Req 5.1). */
export interface FaqEntry {
  question: string;
  answer: string;
}

/** Metadata for an uploaded document, mirroring `campusKnowledgeSources.fileMeta`. */
export interface DocumentMeta {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}

/**
 * A Knowledge_Source submission before it is accepted and associated with an
 * agent. `textContent` carries the body for instructions/link/event/club/course
 * kinds; `faqEntries` carries FAQ content; `fileMeta` carries document metadata.
 */
export interface KnowledgeSubmission {
  sourceId: string;
  kind: KnowledgeSourceKind;
  textContent?: string;
  faqEntries?: readonly FaqEntry[];
  fileMeta?: DocumentMeta;
}

/**
 * A Knowledge_Source that has been accepted and associated with its owning
 * agent (the pure in-memory model of a stored source; Req 5.2).
 */
export interface StoredKnowledgeSource {
  sourceId: string;
  agentId: string;
  kind: KnowledgeSourceKind;
  textContent?: string;
  faqEntries?: readonly FaqEntry[];
  fileMeta?: DocumentMeta;
}

/** The specific reason a Knowledge_Source submission was rejected (Req 5.6). */
export type KnowledgeRejectionReason =
  | "instructions_too_long"
  | "faq_too_many_entries"
  | "faq_answer_too_long"
  | "missing_document_meta"
  | "unsupported_document_type"
  | "document_too_large_platform"
  | "document_too_large_tier";

/**
 * The outcome of validating a Knowledge_Source against its type limits. On
 * rejection the specific violated limit is returned; for a size-limit
 * rejection the applicable byte limit is included so the client can surface it.
 */
export type AcceptanceResult =
  | { accepted: true }
  | { accepted: false; reason: KnowledgeRejectionReason; limitBytes?: number };

// ---------------------------------------------------------------------------
// Acceptance (Req 5.1, 5.6, 13.1)
// ---------------------------------------------------------------------------

/**
 * Resolves the per-tier per-document size limit in bytes for an account tier,
 * defaulting to the free-tier limit for an unknown tier (the strictest, safe
 * default) (Req 13.1).
 */
export function perTierDocumentLimitBytes(tier: AccountTier): number {
  return PER_TIER_DOCUMENT_LIMIT_BYTES[tier] ?? PER_TIER_DOCUMENT_LIMIT_BYTES.free;
}

/**
 * Decides whether a submitted Knowledge_Source satisfies its type limits
 * (Req 5.1, 5.6, 13.1). Pure and non-mutating; returns `{ accepted: true }`
 * iff every applicable bound holds, otherwise the specific violated reason.
 *
 * Document size is checked in a strict layered order: the platform maximum
 * (20 MB) FIRST (`document_too_large_platform`), and only when that passes the
 * owning account's per-tier per-document limit (`document_too_large_tier`).
 * A document over the platform maximum is therefore always reported as
 * exceeding the platform maximum regardless of tier.
 */
export function evaluateKnowledgeSource(
  submission: KnowledgeSubmission,
  tier: AccountTier = "free"
): AcceptanceResult {
  switch (submission.kind) {
    case "instructions": {
      const length = submission.textContent?.length ?? 0;
      if (length > MAX_INSTRUCTIONS_CHARS) {
        return { accepted: false, reason: "instructions_too_long" };
      }
      return { accepted: true };
    }

    case "faq": {
      const entries = submission.faqEntries ?? [];
      if (entries.length > MAX_FAQ_ENTRIES) {
        return { accepted: false, reason: "faq_too_many_entries" };
      }
      for (const entry of entries) {
        if (entry.answer.length > MAX_FAQ_ANSWER_CHARS) {
          return { accepted: false, reason: "faq_answer_too_long" };
        }
      }
      return { accepted: true };
    }

    case "document": {
      const meta = submission.fileMeta;
      if (!meta) {
        return { accepted: false, reason: "missing_document_meta" };
      }
      if (!SUPPORTED_DOCUMENT_MIME_TYPES.includes(meta.mimeType)) {
        return { accepted: false, reason: "unsupported_document_type" };
      }
      // Layer 1 (checked first): platform maximum (Req 5.6).
      if (meta.sizeBytes > PLATFORM_MAX_DOCUMENT_BYTES) {
        return {
          accepted: false,
          reason: "document_too_large_platform",
          limitBytes: PLATFORM_MAX_DOCUMENT_BYTES,
        };
      }
      // Layer 2: per-tier per-document limit (Req 13.1).
      const tierLimit = perTierDocumentLimitBytes(tier);
      if (meta.sizeBytes > tierLimit) {
        return {
          accepted: false,
          reason: "document_too_large_tier",
          limitBytes: tierLimit,
        };
      }
      return { accepted: true };
    }

    // link / event / club / course carry no defined size or count bound, so
    // they are accepted at this layer (Req 5.1).
    default:
      return { accepted: true };
  }
}

// ---------------------------------------------------------------------------
// Association (Req 5.2)
// ---------------------------------------------------------------------------

/**
 * Associates an accepted Knowledge_Source with its owning agent, returning the
 * stored-source projection (Req 5.2). Pure and non-mutating.
 */
export function associateSource(
  submission: KnowledgeSubmission,
  agentId: string
): StoredKnowledgeSource {
  const stored: StoredKnowledgeSource = {
    sourceId: submission.sourceId,
    agentId,
    kind: submission.kind,
  };
  if (submission.textContent !== undefined) stored.textContent = submission.textContent;
  if (submission.faqEntries !== undefined) stored.faqEntries = submission.faqEntries;
  if (submission.fileMeta !== undefined) stored.fileMeta = submission.fileMeta;
  return stored;
}

/**
 * Returns the sources currently associated with a given agent, preserving
 * insertion order (Req 5.2). Pure and non-mutating.
 */
export function listSourcesForAgent(
  sources: readonly StoredKnowledgeSource[],
  agentId: string
): StoredKnowledgeSource[] {
  return sources.filter((source) => source.agentId === agentId);
}

/** The outcome of submitting a Knowledge_Source against an existing source list. */
export interface SubmitOutcome {
  /**
   * The resulting source list. On acceptance the new source is appended; on
   * rejection this is the input list unchanged (Req 5.6 — prior content is
   * left unchanged).
   */
  sources: readonly StoredKnowledgeSource[];
  result: AcceptanceResult;
}

/**
 * Validates a Knowledge_Source submission against its type limits and, iff it
 * is accepted, associates it with the owning agent and appends it to the source
 * list (Req 5.1, 5.2, 5.6, 13.1). On rejection the source list is returned
 * unchanged along with the specific violated-limit reason. Pure and
 * non-mutating: a new array is returned on acceptance and the original is
 * returned by reference on rejection.
 */
export function submitKnowledgeSource(
  sources: readonly StoredKnowledgeSource[],
  agentId: string,
  submission: KnowledgeSubmission,
  tier: AccountTier = "free"
): SubmitOutcome {
  const result = evaluateKnowledgeSource(submission, tier);
  if (!result.accepted) {
    // Reject: leave previously stored content unchanged (Req 5.6).
    return { sources, result };
  }
  const stored = associateSource(submission, agentId);
  return { sources: [...sources, stored], result };
}
