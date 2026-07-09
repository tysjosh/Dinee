/**
 * Feature: dinee-campus (Task 8.1)
 *
 * Pure, property-testable core for the Campus access gate, public-profile
 * projection, and circulation effects. These functions carry NO Convex `ctx`
 * and perform no I/O, so they can be exercised directly by unit and property
 * tests and imported by the Convex services that wrap them (`getPublicProfile`
 * / `resolveCallLink` in `convex/campus/agents.ts` + `convex/campus/share.ts`,
 * and the Safety_Service / Privacy_Controls circulation mutations).
 *
 * Covered behaviors:
 *   - 6.6 / 6.10 / 6.11 / 7.7 / 7.8 / 7.9 / 10.8 / 11.6: the profile and
 *     call-link access gate — content is served only for a `published` agent
 *     that is either public, owned by the requester (when private), or accessed
 *     with a valid, non-revoked Private_Link token for that private agent. Every
 *     other case withholds all content and returns `access_denied`,
 *     `unavailable`, or `invalid` with NO agent fields disclosed.
 *   - 6.1 / 6.4: the public-profile projection — name, visual identity, creator
 *     display name, campus tag, agent type, a description bounded to ≤280 chars,
 *     and between 1 and 5 preview prompts (`clamp(N, 1, 5)`).
 *   - 6.5: remix-control presence tracks the agent's remix flag.
 *   - 11.3 / 11.4 / 11.6 / 12.2 / 12.3: circulation effects — blocking,
 *     removing from listing, and deleting take an agent out of circulation
 *     (excluded from discovery listings, Call_Link unavailable, and — after a
 *     delete — no longer retrievable).
 */

// ---------------------------------------------------------------------------
// Domain types (declared locally so this module stays dependency-free)
// ---------------------------------------------------------------------------

/** The seven Agent_Types (Req 2.3), matching `campusAgents.agentType`. */
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

/**
 * The Publish_State lifecycle of a Campus_Agent, matching `campusAgents.status`.
 * A Campus_Agent is discoverable and callable ONLY while in the `published`
 * state (Req 4.2, 7.9).
 */
export type PublishState =
  | "draft"
  | "publish_pending_link"
  | "published"
  | "link_failed"
  | "removed"
  | "blocked"
  | "deleted";

// ---------------------------------------------------------------------------
// Access gate (Req 6.6, 6.10, 6.11, 7.7, 7.8, 7.9, 10.8, 11.6)
// ---------------------------------------------------------------------------

/**
 * A Private_Link token record, mirroring a `campusPrivateLinks` row (the store
 * resolved via `campusPrivateLinks.by_token`). A token grants access only while
 * its `status` is `active` and it belongs to the requested agent (Req 6.10,
 * 6.11, 6.12).
 */
export interface PrivateLinkRecord {
  token: string;
  agentId: string;
  status: "active" | "revoked";
}

/**
 * The minimal agent fields the access gate needs to make a decision. Kept
 * intentionally small (and structurally satisfied by a full `campusAgents` row)
 * so the gate never depends on — nor discloses — profile content.
 */
export interface AgentAccessView {
  agentId: string;
  ownerId: string;
  status: PublishState;
  visibility: Visibility;
}

/**
 * A profile/call-link access request. `agent` is the resolved agent, or
 * `null`/`undefined` when the requested slug/token matches no agent (Req 7.8).
 * `requesterId` is the authenticated user's id when present; `token` is the
 * Private_Link token the Caller presented (if any); `privateLinks` is the token
 * store to resolve `token` against.
 */
export interface AccessRequest {
  agent: AgentAccessView | null | undefined;
  requesterId?: string | null;
  token?: string | null;
  privateLinks?: readonly PrivateLinkRecord[];
}

/**
 * The denial code returned when access is withheld, with NO agent fields
 * disclosed (Req 6.6, 6.7, 7.7, 7.8, 7.9, 10.8, 11.6):
 *   - `access_denied`: a private, published agent requested by a non-owner
 *     without a valid Private_Link token, or a missing/unknown/revoked token
 *     (Req 6.6, 6.11).
 *   - `unavailable`: the agent exists but is not in the `published` state
 *     (`draft`, `publish_pending_link`, `link_failed`, `removed`, `blocked`, or
 *     `deleted`) (Req 6.7, 7.7, 7.9, 10.8, 11.6, 12.3).
 *   - `invalid`: the slug/token matches no agent (Req 7.8).
 */
export type AccessDenialCode = "access_denied" | "unavailable" | "invalid";

/** The outcome of the access gate: a grant, or a withholding denial. */
export type AccessDecision =
  | { granted: true }
  | { granted: false; denial: AccessDenialCode };

/**
 * True iff `requesterId` identifies the owner of `agent`. An absent requester
 * (anonymous Caller) is never the owner. Pure.
 */
export function isOwner(
  agent: Pick<AgentAccessView, "ownerId">,
  requesterId: string | null | undefined
): boolean {
  return (
    typeof requesterId === "string" &&
    requesterId.length > 0 &&
    requesterId === agent.ownerId
  );
}

/**
 * True iff `token` resolves — via the Private_Link token store — to a valid,
 * non-revoked token that belongs to `agentId` (Req 6.10, 6.11). A missing or
 * empty token, an unknown token, a `revoked` token, or a token belonging to a
 * different agent all yield `false`. Pure and non-mutating.
 */
export function hasValidPrivateLinkToken(
  privateLinks: readonly PrivateLinkRecord[],
  agentId: string,
  token: string | null | undefined
): boolean {
  if (typeof token !== "string" || token.length === 0) {
    return false;
  }
  return privateLinks.some(
    (link) =>
      link.token === token &&
      link.agentId === agentId &&
      link.status === "active"
  );
}

/**
 * The access gate for both the Agent_Profile_Page and the Call_Link
 * (Req 6.6, 6.10, 6.11, 7.7, 7.8, 7.9, 10.8, 11.6). Access is granted only when
 * the target agent exists AND is in the `published` Publish_State AND either
 * (a) its visibility is public, or (b) it is private and the requester is the
 * owner, or (c) it is private and the requester presents a valid, non-revoked
 * Private_Link token for that agent. In every other case the gate withholds all
 * content and returns the appropriate denial:
 *
 *   - no agent at all                         → `invalid`
 *   - agent not in the `published` state      → `unavailable`
 *   - published private agent, unauthorized   → `access_denied`
 *
 * The evaluation order (existence → published → public → owner → token) ensures
 * a non-published agent never reveals whether it is private, and a
 * missing/unknown/revoked token yields the same `access_denied` as a non-owner
 * request with no token (Req 6.11). Pure and non-mutating.
 */
export function evaluateAccess(request: AccessRequest): AccessDecision {
  const { agent } = request;

  // Slug/token matches no agent (Req 7.8).
  if (!agent) {
    return { granted: false, denial: "invalid" };
  }

  // Only the `published` state is discoverable and callable; every other state
  // (draft, publish_pending_link, link_failed, removed, blocked, deleted) is
  // withheld as unavailable (Req 6.7, 7.7, 7.9, 10.8, 11.6, 12.3).
  if (agent.status !== "published") {
    return { granted: false, denial: "unavailable" };
  }

  // Published + public → served (Req 6.1).
  if (agent.visibility === "public") {
    return { granted: true };
  }

  // Published + private → owner is always granted (Req 6.6, 6.10).
  if (isOwner(agent, request.requesterId)) {
    return { granted: true };
  }

  // Published + private → a valid, non-revoked Private_Link token grants
  // access (Req 6.10).
  if (
    hasValidPrivateLinkToken(
      request.privateLinks ?? [],
      agent.agentId,
      request.token
    )
  ) {
    return { granted: true };
  }

  // Private, published agent requested by a non-owner without a valid token, or
  // with a missing/unknown/revoked token (Req 6.6, 6.11).
  return { granted: false, denial: "access_denied" };
}

// ---------------------------------------------------------------------------
// Public-profile projection (Req 6.1, 6.4, 6.5)
// ---------------------------------------------------------------------------

/** Maximum length, in characters, of the projected short description (Req 6.1). */
export const DESCRIPTION_MAX = 280;

/** The minimum number of preview prompts a profile presents (Req 6.4). */
export const PREVIEW_PROMPTS_MIN = 1;

/** The maximum number of preview prompts a profile presents (Req 6.4). */
export const PREVIEW_PROMPTS_MAX = 5;

/**
 * Clamps `n` into the inclusive range [`min`, `max`]. Pure; assumes
 * `min <= max`.
 */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * The agent fields consumed by the public-profile projection. Structurally
 * satisfied by a full `campusAgents` row, so a stored agent can be passed
 * directly.
 */
export interface AgentProfileInput {
  agentId: string;
  name: string;
  creatorDisplayName: string;
  campusTag?: string;
  agentType: AgentType;
  description: string;
  previewPrompts: readonly string[];
  remixEnabled?: boolean;
}

/**
 * The visual identity a profile renders for a Campus_Agent (Req 6.1). Derived
 * deterministically so no separate avatar asset is required: `initial` seeds a
 * monogram avatar and `colorSeed` seeds a stable color/theme.
 */
export interface VisualIdentity {
  initial: string;
  colorSeed: string;
}

/**
 * The public projection of a Campus_Agent's profile (Req 6.1, 6.4, 6.5).
 * Contains exactly the publicly displayable fields; the access gate is
 * responsible for deciding whether this projection may be produced at all.
 */
export interface PublicProfileProjection {
  name: string;
  visualIdentity: VisualIdentity;
  creatorDisplayName: string;
  campusTag: string;
  agentType: AgentType;
  description: string;
  previewPrompts: string[];
  hasRemixControl: boolean;
}

/**
 * Derives the deterministic visual identity for an agent (Req 6.1): the first
 * non-whitespace character of the name (uppercased) as a monogram, and the
 * stable `agentId` as the color seed. Pure and non-mutating.
 */
export function deriveVisualIdentity(
  agent: Pick<AgentProfileInput, "agentId" | "name">
): VisualIdentity {
  const trimmed = agent.name.trim();
  const initial = trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "";
  return { initial, colorSeed: agent.agentId };
}

/**
 * True iff the Agent_Profile_Page presents a remix control — that is, iff the
 * agent has the remix option enabled (Req 6.5). A missing flag is treated as
 * disabled. Pure.
 */
export function hasRemixControl(
  agent: Pick<AgentProfileInput, "remixEnabled">
): boolean {
  return agent.remixEnabled === true;
}

/**
 * Projects the public-facing profile for a Campus_Agent (Req 6.1, 6.4, 6.5).
 * The projection is complete (name, visual identity, creator display name,
 * campus tag, agent type, description, preview prompts, remix-control presence)
 * and bounded: the description is truncated to at most {@link DESCRIPTION_MAX}
 * characters, and the number of preview prompts presented equals
 * `clamp(N, 1, 5)` of the agent's prompts. Pure and non-mutating.
 *
 * Note: this function performs NO access checks — callers MUST first pass the
 * agent through {@link evaluateAccess} (or use {@link getAccessibleProfile}).
 */
export function projectPublicProfile(
  agent: AgentProfileInput
): PublicProfileProjection {
  const displayedCount = clamp(
    agent.previewPrompts.length,
    PREVIEW_PROMPTS_MIN,
    PREVIEW_PROMPTS_MAX
  );
  return {
    name: agent.name,
    visualIdentity: deriveVisualIdentity(agent),
    creatorDisplayName: agent.creatorDisplayName,
    campusTag: agent.campusTag ?? "",
    agentType: agent.agentType,
    description: agent.description.slice(0, DESCRIPTION_MAX),
    previewPrompts: agent.previewPrompts.slice(0, displayedCount),
    hasRemixControl: hasRemixControl(agent),
  };
}

// ---------------------------------------------------------------------------
// Combined access + projection convenience
// ---------------------------------------------------------------------------

/**
 * A `campusAgents` row as far as the access gate and projection are concerned —
 * the union of {@link AgentAccessView} and {@link AgentProfileInput}. Modeled so
 * a single stored record satisfies both the gate and the projection.
 */
export interface CampusAgentRecord extends AgentAccessView, AgentProfileInput {}

/**
 * The result of gating and (on grant) projecting a profile request. On a
 * denial NO profile content is included, upholding the "withhold all content"
 * guarantee (Req 6.6, 6.7).
 */
export type ProfileAccessResult =
  | { granted: true; profile: PublicProfileProjection }
  | { granted: false; denial: AccessDenialCode };

/**
 * Applies the access gate and, only when access is granted, returns the public
 * profile projection (Req 6.1, 6.4, 6.5, 6.6, 6.10, 6.11, 7.7–7.9, 10.8, 11.6).
 * This is the single entry point the Convex `getPublicProfile`/`resolveCallLink`
 * services use so access and disclosure can never diverge. Pure and
 * non-mutating.
 */
export function getAccessibleProfile(request: {
  agent: CampusAgentRecord | null | undefined;
  requesterId?: string | null;
  token?: string | null;
  privateLinks?: readonly PrivateLinkRecord[];
}): ProfileAccessResult {
  const decision = evaluateAccess({
    agent: request.agent,
    requesterId: request.requesterId,
    token: request.token,
    privateLinks: request.privateLinks,
  });
  if (!decision.granted) {
    return decision;
  }
  // `granted` implies `agent` is non-null (the gate returns `invalid`
  // otherwise), so the non-null assertion is sound.
  return { granted: true, profile: projectPublicProfile(request.agent!) };
}

// ---------------------------------------------------------------------------
// Circulation effects (Req 11.3, 11.4, 11.6, 12.2, 12.3)
// ---------------------------------------------------------------------------

/** The minimal circulation view of an agent: its state and visibility. */
export interface AgentCirculationView {
  status: PublishState;
  visibility: Visibility;
}

/**
 * Blocks an agent (Safety_Service operator action, Req 11.3): returns a copy
 * with `status: "blocked"`. Pure and non-mutating; the input is not modified.
 */
export function applyBlock<T extends { status: PublishState }>(agent: T): T {
  return { ...agent, status: "blocked" };
}

/**
 * Removes an agent from public listing (Safety_Service operator action,
 * Req 11.4): returns a copy with `status: "removed"`. Pure and non-mutating.
 */
export function applyRemoveFromListing<T extends { status: PublishState }>(
  agent: T
): T {
  return { ...agent, status: "removed" };
}

/**
 * Deletes an agent (Privacy_Controls delete, Req 12.2, 12.3): returns a copy
 * with `status: "deleted"`. Pure and non-mutating.
 */
export function applyDelete<T extends { status: PublishState }>(agent: T): T {
  return { ...agent, status: "deleted" };
}

/**
 * True iff an agent belongs in discovery listings: it must be in the
 * `published` state AND have public visibility (Req 10.3, 10.5, 11.5). Any
 * blocked, removed, deleted, private, or otherwise non-published agent is
 * excluded. Pure.
 */
export function isDiscoverable(agent: AgentCirculationView): boolean {
  return agent.status === "published" && agent.visibility === "public";
}

/**
 * True iff an agent's Call_Link resolves to servable content — i.e., the agent
 * is in the `published` state (Req 7.7, 7.9, 11.6, 12.3). A blocked, removed,
 * deleted, draft, publish_pending_link, or link_failed agent returns an
 * unavailable Call_Link. Pure. (Visibility does not affect Call_Link
 * availability; a private published agent's link is served subject to the
 * access gate's token/owner check.)
 */
export function isCallLinkAvailable(
  agent: Pick<AgentCirculationView, "status">
): boolean {
  return agent.status === "published";
}

/**
 * True iff an agent is still retrievable — i.e., it has not been deleted
 * (Req 12.3). After a delete the agent is not retrievable at all. Pure.
 */
export function isRetrievable(
  agent: Pick<AgentCirculationView, "status">
): boolean {
  return agent.status !== "deleted";
}
