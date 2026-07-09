/**
 * Feature: dinee-campus (Task 5.1)
 *
 * Pure draft persistence logic for the Creation_Flow. These functions carry NO
 * Convex `ctx` and perform no I/O, so they can be exercised directly by unit and
 * property tests and imported by the Creation_Service Convex functions
 * (`convex/campus/agents.ts` — `saveDraft`/`getDraft`).
 *
 * Requirement 4.3: WHILE the Agent_Creation_Flow is in progress, THE
 * Agent_Creation_Flow SHALL persist each entered field value ... and SHALL
 * retain the persisted values ... so that a Student_Creator who leaves and
 * returns resumes with previously entered values retained.
 *
 * To support that, a partially-entered creation field set (`CreationDraft`) is
 * normalized into a storage-ready form (`StoredDraft`) by `serializeDraft`, and
 * reconstructed on load by `deserializeDraft`, WITHOUT LOSS of any entered value
 * (Property 6: Draft persistence round-trip). The pair are exact inverses over
 * the normalized domain:
 *   - deserializeDraft(serializeDraft(d))  === normalizeDraft(d)
 *   - serializeDraft(deserializeDraft(s))  === s   (for any StoredDraft s)
 *
 * Normalization is value-preserving: it never trims, truncates, or otherwise
 * rewrites an entered value. It only drops fields the creator has not entered
 * yet (so an omitted field and an `undefined` field are treated identically),
 * which is exactly the semantics Convex storage of optional fields provides.
 */

/** The seven Agent_Types (Req 2.3). */
export type AgentType =
  | "ai_twin"
  | "study_agent"
  | "club_agent"
  | "campus_guide"
  | "funny_character"
  | "tutor_agent"
  | "advice_agent";

/** Visibility of a Campus_Agent (Req 2.3). */
export type Visibility = "public" | "private";

/** A single Knowledge_Source entered during creation (Req 5.1). */
export interface DraftKnowledgeSource {
  kind:
    | "instructions"
    | "faq"
    | "document"
    | "link"
    | "event"
    | "club"
    | "course";
  textContent?: string;
  faqEntries?: Array<{ question: string; answer: string }>;
  storageId?: string;
  fileMeta?: { fileName: string; sizeBytes: number; mimeType: string };
}

/** The optional creation fields (Req 2.4). */
export interface DraftOptionalFields {
  socialLink?: string;
  clubName?: string;
  courseCode?: string;
  eventDate?: number;
  contactEmail?: string;
}

/**
 * The full set of fields a Student_Creator can enter during the Creation_Flow.
 * Every field is optional because a draft may be saved at any point while the
 * flow is in progress (Req 4.3).
 */
export interface CreationDraft {
  name?: string;
  agentType?: AgentType;
  campusTag?: string;
  voiceId?: string;
  personalityTone?: string;
  description?: string;
  creatorDisplayName?: string;
  previewPrompts?: string[];
  visibility?: Visibility;
  representsRealPerson?: boolean;
  remixEnabled?: boolean;
  recordingEnabled?: boolean;
  summariesEnabled?: boolean;
  creatorContactLink?: string;
  monetizationLink?: string;
  optional?: DraftOptionalFields;
  knowledgeSources?: DraftKnowledgeSource[];
}

/**
 * The storage-ready form of a draft. Structurally identical to `CreationDraft`
 * but guaranteed to be normalized: it contains only keys whose value was
 * actually entered (never `undefined`), so it round-trips through Convex's
 * optional-field storage without introducing spurious keys.
 */
export type StoredDraft = CreationDraft;

/** Returns true when a value is neither `undefined` nor `null`. */
function isPresent<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

/** Deep-copies a knowledge source, dropping absent optional fields. */
function normalizeKnowledgeSource(
  source: DraftKnowledgeSource
): DraftKnowledgeSource {
  const normalized: DraftKnowledgeSource = { kind: source.kind };
  if (isPresent(source.textContent)) normalized.textContent = source.textContent;
  if (isPresent(source.faqEntries)) {
    normalized.faqEntries = source.faqEntries.map((entry) => ({
      question: entry.question,
      answer: entry.answer,
    }));
  }
  if (isPresent(source.storageId)) normalized.storageId = source.storageId;
  if (isPresent(source.fileMeta)) {
    normalized.fileMeta = {
      fileName: source.fileMeta.fileName,
      sizeBytes: source.fileMeta.sizeBytes,
      mimeType: source.fileMeta.mimeType,
    };
  }
  return normalized;
}

/** Deep-copies the optional-fields object, dropping absent members. */
function normalizeOptionalFields(
  optional: DraftOptionalFields
): DraftOptionalFields {
  const normalized: DraftOptionalFields = {};
  if (isPresent(optional.socialLink)) normalized.socialLink = optional.socialLink;
  if (isPresent(optional.clubName)) normalized.clubName = optional.clubName;
  if (isPresent(optional.courseCode)) normalized.courseCode = optional.courseCode;
  if (isPresent(optional.eventDate)) normalized.eventDate = optional.eventDate;
  if (isPresent(optional.contactEmail)) {
    normalized.contactEmail = optional.contactEmail;
  }
  return normalized;
}

/**
 * Returns the canonical form of a draft: a deep copy that contains only the
 * fields the creator has entered. Omitted and `undefined` fields are treated
 * identically (both absent). No entered value is trimmed or otherwise altered.
 */
export function normalizeDraft(draft: CreationDraft): CreationDraft {
  const normalized: CreationDraft = {};

  if (isPresent(draft.name)) normalized.name = draft.name;
  if (isPresent(draft.agentType)) normalized.agentType = draft.agentType;
  if (isPresent(draft.campusTag)) normalized.campusTag = draft.campusTag;
  if (isPresent(draft.voiceId)) normalized.voiceId = draft.voiceId;
  if (isPresent(draft.personalityTone)) {
    normalized.personalityTone = draft.personalityTone;
  }
  if (isPresent(draft.description)) normalized.description = draft.description;
  if (isPresent(draft.creatorDisplayName)) {
    normalized.creatorDisplayName = draft.creatorDisplayName;
  }
  if (isPresent(draft.previewPrompts)) {
    normalized.previewPrompts = [...draft.previewPrompts];
  }
  if (isPresent(draft.visibility)) normalized.visibility = draft.visibility;
  if (isPresent(draft.representsRealPerson)) {
    normalized.representsRealPerson = draft.representsRealPerson;
  }
  if (isPresent(draft.remixEnabled)) normalized.remixEnabled = draft.remixEnabled;
  if (isPresent(draft.recordingEnabled)) {
    normalized.recordingEnabled = draft.recordingEnabled;
  }
  if (isPresent(draft.summariesEnabled)) {
    normalized.summariesEnabled = draft.summariesEnabled;
  }
  if (isPresent(draft.creatorContactLink)) {
    normalized.creatorContactLink = draft.creatorContactLink;
  }
  if (isPresent(draft.monetizationLink)) {
    normalized.monetizationLink = draft.monetizationLink;
  }
  if (isPresent(draft.optional)) {
    normalized.optional = normalizeOptionalFields(draft.optional);
  }
  if (isPresent(draft.knowledgeSources)) {
    normalized.knowledgeSources = draft.knowledgeSources.map(
      normalizeKnowledgeSource
    );
  }

  return normalized;
}

/**
 * Normalizes an in-progress creation field set into its storage-ready form
 * (Req 4.3). Value-preserving: every entered value is stored exactly as
 * entered; only unentered fields are dropped.
 */
export function serializeDraft(draft: CreationDraft): StoredDraft {
  return normalizeDraft(draft);
}

/**
 * Reconstructs the creation field set from its stored form so a returning
 * Student_Creator resumes with previously entered values retained (Req 4.3).
 * The inverse of `serializeDraft` over the normalized domain — no value is lost.
 */
export function deserializeDraft(stored: StoredDraft): CreationDraft {
  return normalizeDraft(stored);
}
