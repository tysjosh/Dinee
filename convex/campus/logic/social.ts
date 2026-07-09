/**
 * Feature: dinee-campus (Task 36.1)
 *
 * Pure, property-testable core for the Social_Service: distinct-saver counting
 * with idempotent save/unsave, and the remix transform (Requirements
 * 15.1–15.9). These functions carry NO Convex `ctx` and perform no I/O, so they
 * can be exercised directly by unit and property tests and imported by the
 * Convex `convex/campus/social.ts` service that wraps them with `campusSaves` /
 * `campusAgents` / `campusPrivateLinks` reads (`saveAgent` / `unsaveAgent` /
 * `getSaveCount` / `isSaved` / `remixAgent`).
 *
 * Covered behaviors:
 *   - 15.1 / 15.2 / 15.3: a Caller's save adds the agent to that Caller's saved
 *     list, an unsave removes it, and the save count is the number of DISTINCT
 *     Callers who currently save the agent — each Caller counted at most once.
 *     Save and unsave are idempotent per `(agentId, callerKey)`: re-saving an
 *     already-saved Caller or re-unsaving a not-saved Caller never changes the
 *     count.
 *   - 15.4: a save on a private agent by a caller who is neither the owner nor
 *     presenting a valid Private_Link token is rejected (`access_denied`) and
 *     leaves the save set unchanged.
 *   - 15.5 / 15.6 / 15.7 / 15.8 / 15.9: the remix transform copies ONLY the
 *     configurable fields (agent type, personality/tone, preview prompts) into
 *     a new `draft` agent owned by the remixing Student_Creator, EXCLUDES the
 *     source's private data (uploaded documents/knowledge sources, call
 *     history, analytics, creator contact link, monetization link, voice-clone
 *     consent artifact), records the source agent id as its remix source, and
 *     increments the source's remix count by exactly 1 — gated on the source's
 *     `remixEnabled` flag and, for a private source, owner-or-valid-token
 *     authorization.
 *
 * The save access check reuses {@link evaluateAccess} from the access module so
 * saving and the profile/call-link gate can never diverge on who may reach a
 * private agent; the remix authorization reuses {@link isOwner} and
 * {@link hasValidPrivateLinkToken} for the same reason.
 */

import {
  evaluateAccess,
  hasValidPrivateLinkToken,
  isOwner,
  type AccessDenialCode,
  type AgentAccessView,
  type AgentType,
  type PrivateLinkRecord,
  type Visibility,
} from "./access";

// ===========================================================================
// Distinct-saver counting + idempotent save / unsave (Req 15.1–15.4)
// ===========================================================================

/**
 * A single save/unsave operation issued by a Caller against one agent — the
 * unit that a `campusSaves` mutation records. `callerKey` is the hashed caller
 * identity (matching `campusSaves.callerKey`); `action` is the requested change
 * to that Caller's membership in the agent's saved set.
 */
export interface SaveOperation {
  callerKey: string;
  action: "save" | "unsave";
}

/**
 * True iff `callerKey` currently saves the agent — i.e., it is a member of the
 * distinct-saver set (`campusSaves` has a `(agentId, callerKey)` row). Backs the
 * `isSaved` query. Pure.
 */
export function isSavedBy(
  savers: ReadonlySet<string>,
  callerKey: string
): boolean {
  return savers.has(callerKey);
}

/**
 * Idempotently adds `callerKey` to the distinct-saver set (Req 15.1). Returns a
 * new `Set` (the input is not modified); re-adding an already-present Caller
 * yields an equal set, so repeated saves never inflate the count (Req 15.3).
 */
export function addSaver(
  savers: ReadonlySet<string>,
  callerKey: string
): Set<string> {
  const next = new Set(savers);
  next.add(callerKey);
  return next;
}

/**
 * Idempotently removes `callerKey` from the distinct-saver set (Req 15.2).
 * Returns a new `Set` (the input is not modified); removing a Caller who is not
 * present is a no-op, so repeated unsaves never change the count (Req 15.3).
 */
export function removeSaver(
  savers: ReadonlySet<string>,
  callerKey: string
): Set<string> {
  const next = new Set(savers);
  next.delete(callerKey);
  return next;
}

/**
 * Computes an agent's save count as the number of DISTINCT Callers currently in
 * the saved set, counting each Caller at most once (Req 15.3). Because the set
 * is keyed by `callerKey`, duplicates are impossible by construction. Backs the
 * `getSaveCount` query. Pure.
 */
export function computeSaveCount(savers: ReadonlySet<string>): number {
  return savers.size;
}

/**
 * Folds a sequence of save/unsave operations over an initial distinct-saver set
 * (Req 15.1, 15.2, 15.3). The resulting set contains exactly the Callers whose
 * MOST RECENT operation is a `save`; a Caller whose most recent operation is an
 * `unsave` (or who never saved) is absent. Every operation is idempotent, so
 * the count depends only on each Caller's latest action, never on how many
 * times it was repeated. Returns a new `Set`; the input is not modified. Pure.
 *
 * This models the authoritative `campusSaves` ledger after applying a batch of
 * operations and is the counting core exercised by Property 36; the per-op
 * access check for private agents is applied separately by {@link saveAgent}.
 */
export function applySaveOperations(
  initialSavers: ReadonlySet<string>,
  operations: readonly SaveOperation[]
): Set<string> {
  let savers = new Set(initialSavers);
  for (const op of operations) {
    if (op.action === "save") {
      savers.add(op.callerKey);
    } else {
      savers.delete(op.callerKey);
    }
  }
  return savers;
}

/**
 * A save request against a (possibly private) agent. `agent` is the resolved
 * target (or `null`/`undefined` when nothing matched); `callerKey` is the
 * hashed caller identity to record; `requesterId` is the authenticated user's
 * id (used for the owner check); `token` + `privateLinks` resolve a presented
 * Private_Link token (Req 15.4).
 */
export interface SaveRequest {
  agent: AgentAccessView | null | undefined;
  callerKey: string;
  requesterId?: string | null;
  token?: string | null;
  privateLinks?: readonly PrivateLinkRecord[];
}

/**
 * The outcome of an access-gated {@link saveAgent}. On a grant the agent is now
 * in the returned `savers` set; on a denial the set is returned UNCHANGED
 * (Req 15.4) alongside the reason it was withheld.
 */
export type SaveResult =
  | { granted: true; savers: Set<string> }
  | { granted: false; denial: AccessDenialCode; savers: Set<string> };

/**
 * Applies a Caller's save, gated by the shared access rule (Req 15.1, 15.4).
 * A save is granted only when the agent is reachable per {@link evaluateAccess}
 * — published, and either public, owned by the requester, or accessed with a
 * valid, non-revoked Private_Link token. On a grant `callerKey` is added to the
 * distinct-saver set (idempotent, Req 15.1). On a denial (e.g. a private agent
 * requested by a non-owner without a valid token, Req 15.4) the save set is
 * returned unchanged with the denial code. Pure and non-mutating: a new set is
 * always returned; the input set is never modified.
 */
export function saveAgent(
  savers: ReadonlySet<string>,
  request: SaveRequest
): SaveResult {
  const decision = evaluateAccess({
    agent: request.agent,
    requesterId: request.requesterId,
    token: request.token,
    privateLinks: request.privateLinks,
  });
  if (!decision.granted) {
    // Rejected — leave the save set unchanged (Req 15.4).
    return { granted: false, denial: decision.denial, savers: new Set(savers) };
  }
  return { granted: true, savers: addSaver(savers, request.callerKey) };
}

/**
 * Removes a Caller's save (Req 15.2). Unsaving is idempotent and needs no
 * access check — a Caller only ever removes their own membership — so this is a
 * thin, always-succeeding wrapper over {@link removeSaver}. Returns a new set;
 * the input is not modified. Pure.
 */
export function unsaveAgent(
  savers: ReadonlySet<string>,
  callerKey: string
): { savers: Set<string> } {
  return { savers: removeSaver(savers, callerKey) };
}

// ===========================================================================
// Remix transform (Req 15.5–15.9)
// ===========================================================================

/**
 * The source Campus_Agent a remix reads from. Only the configurable fields
 * ({@link RemixedDraft}) are copied into the new draft; the remaining fields are
 * present here solely so the transform can be shown to EXCLUDE them (they are
 * the source's private data — Req 15.5) and so authorization can be evaluated
 * (`ownerId`, `visibility`, `remixEnabled`). Structurally satisfied by a full
 * `campusAgents` row.
 */
export interface RemixSourceAgent {
  agentId: string;
  ownerId: string;
  visibility: Visibility;
  /** Whether remixing is permitted for this agent (Req 6.5, 15.5, 15.8). */
  remixEnabled?: boolean;
  /** Successful-remix tally; treated as 0 when absent (Req 15.7). */
  remixCount?: number;

  // --- Copied configurable fields (Req 15.5) ---
  agentType: AgentType;
  personalityTone: string;
  previewPrompts: readonly string[];

  // --- Excluded private data (declared to make the exclusion explicit; never
  //     copied into the produced draft — Req 15.5) ---
  creatorContactLink?: string;
  monetizationLink?: string;
}

/**
 * The new draft Campus_Agent produced by a successful remix (Req 15.5, 15.6).
 * It contains ONLY the copied configurable fields plus the remixing owner, a
 * `draft` Publish_State, and the source attribution. It deliberately carries
 * none of the source's private data (uploaded documents/knowledge sources, call
 * history, analytics, creator contact link, monetization link, or voice-clone
 * consent artifact) — those are excluded by construction (Req 15.5). The draft
 * must proceed through the normal publish flow.
 */
export interface RemixedDraft {
  ownerId: string;
  status: "draft";
  agentType: AgentType;
  personalityTone: string;
  previewPrompts: string[];
  /** Reference to the agent this draft was remixed from (Req 15.6). */
  remixSourceAgentId: string;
}

/**
 * A remix request: the `source` agent, the `remixingUserId` who will own the
 * new draft (and whose id is used for the owner authorization check), and an
 * optional Private_Link `token` + `privateLinks` store to authorize remixing a
 * private source (Req 15.9).
 */
export interface RemixRequest {
  source: RemixSourceAgent;
  remixingUserId: string;
  token?: string | null;
  privateLinks?: readonly PrivateLinkRecord[];
}

/** Reason a remix was blocked (Req 15.8, 15.9). */
export type RemixDenialCode = "remix_disabled" | "access_denied";

/**
 * The outcome of {@link remixAgent}. On success it carries the produced
 * `draft`, the source agent's identifier, and the source's NEW remix count
 * after the increment (the caller patches `campusAgents.remixCount` to this
 * value). On failure no draft is produced and the source's remix count is left
 * unchanged (the failure carries no new count).
 */
export type RemixResult =
  | {
      success: true;
      draft: RemixedDraft;
      sourceAgentId: string;
      sourceRemixCount: number;
    }
  | { success: false; denial: RemixDenialCode };

/** True iff the source agent has remixing enabled (Req 15.8). A missing flag is disabled. */
export function isRemixEnabled(
  source: Pick<RemixSourceAgent, "remixEnabled">
): boolean {
  return source.remixEnabled === true;
}

/**
 * True iff the requester is authorized to remix `source` (Req 15.9): a public
 * source is always remixable; a private source is remixable only by its owner
 * or by a caller presenting a valid, non-revoked Private_Link token for it.
 * Note this is the remix authorization rule and — unlike the profile/call-link
 * gate — does NOT require the source to be in the `published` state. Pure.
 */
export function isRemixAuthorized(request: RemixRequest): boolean {
  const { source } = request;
  if (source.visibility === "public") {
    return true;
  }
  if (isOwner(source, request.remixingUserId)) {
    return true;
  }
  return hasValidPrivateLinkToken(
    request.privateLinks ?? [],
    source.agentId,
    request.token
  );
}

/**
 * The source agent's remix count after a successful remix — the current count
 * (0 when absent) incremented by exactly 1 (Req 15.7). Pure.
 */
export function nextRemixCount(
  source: Pick<RemixSourceAgent, "remixCount">
): number {
  return (source.remixCount ?? 0) + 1;
}

/**
 * The remix transform (Req 15.5–15.9). A remix succeeds if and only if the
 * source has remixing enabled (Req 15.8) AND the requester is authorized for it
 * (Req 15.9); enablement is checked first, matching the Social_Service order.
 *
 * On success it produces a new {@link RemixedDraft} that:
 *   (a) copies ONLY the configurable fields — agent type, personality/tone, and
 *       a fresh copy of the preview prompts (Req 15.5);
 *   (b) contains NONE of the source's private data — uploaded
 *       documents/knowledge sources, call history, analytics, creator contact
 *       link, monetization link, or voice-clone consent artifact — by
 *       construction, since only the configurable fields are ever read
 *       (Req 15.5);
 *   (c) is owned by the remixing Student_Creator and starts in the `draft`
 *       Publish_State;
 *   (d) records the source agent id as its `remixSourceAgentId` (Req 15.6);
 * and reports the source's incremented remix count (Req 15.7).
 *
 * On failure no draft is produced (Req 15.8, 15.9) and, because nothing is
 * mutated, the source's remix count is left unchanged. Pure and non-mutating.
 */
export function remixAgent(request: RemixRequest): RemixResult {
  const { source } = request;

  // Enablement first (Req 15.8), then authorization (Req 15.9).
  if (!isRemixEnabled(source)) {
    return { success: false, denial: "remix_disabled" };
  }
  if (!isRemixAuthorized(request)) {
    return { success: false, denial: "access_denied" };
  }

  const draft: RemixedDraft = {
    ownerId: request.remixingUserId,
    status: "draft",
    agentType: source.agentType,
    personalityTone: source.personalityTone,
    previewPrompts: [...source.previewPrompts],
    remixSourceAgentId: source.agentId,
  };

  return {
    success: true,
    draft,
    sourceAgentId: source.agentId,
    sourceRemixCount: nextRemixCount(source),
  };
}
