/**
 * Feature: dinee-campus (Task 38.1)
 *
 * Pure, property-testable core for the Creator_Page projection and its
 * visibility gate. These functions carry NO Convex `ctx` and perform no I/O, so
 * they can be exercised directly by unit and property tests and imported by the
 * Convex service that wraps them (the `/campus/u/[handle]` Creator_Page query,
 * which supplies the resolved creator record and the creator's agent set).
 *
 * Covered behaviors:
 *   - 15.15: when the Creator_Page setting is public, list exactly that
 *     Student_Creator's public, published Campus_Agents — each entry carrying
 *     the agent's display name, the creator display name, and the Campus_Tag —
 *     excluding every private agent and every agent in the removed, blocked,
 *     deleted (and any other non-published) Publish_State.
 *   - 15.16: the caller-supplied visibility setting (`public` | `hidden`) is
 *     applied as given; an absent setting is treated as `hidden`.
 *   - 15.17: a hidden Creator_Page requested by anyone other than the owning
 *     Student_Creator withholds all content and returns `unavailable`.
 *   - 15.18: a public Creator_Page whose creator has no qualifying agent yields
 *     an empty-state (a granted result carrying an empty agent list).
 *
 * The listable-agent invariant reuses {@link isDiscoverable} from the access
 * module so the Creator_Page and the discovery/profile access gate can never
 * diverge on what "published + public" means.
 */

import { isDiscoverable, type AgentCirculationView } from "./access";

// ---------------------------------------------------------------------------
// Visibility setting (Req 15.16, 15.17)
// ---------------------------------------------------------------------------

/** The Creator_Page visibility setting, matching `users.creatorPageVisibility`. */
export type CreatorPageVisibility = "public" | "hidden";

/**
 * Normalizes a (possibly absent) Creator_Page visibility setting to a concrete
 * value: an absent/`null`/`undefined` setting is treated as `hidden`
 * (Req 15.16, 15.17). Pure.
 */
export function resolveCreatorPageVisibility(
  setting: CreatorPageVisibility | null | undefined
): CreatorPageVisibility {
  return setting === "public" ? "public" : "hidden";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The minimal view of a Campus_Agent the Creator_Page needs to apply the
 * listable invariant and build an entry. Structurally satisfied by a full
 * `campusAgents` row, so a stored record can be passed directly. Extends
 * {@link AgentCirculationView} (`status` + `visibility`) so {@link isDiscoverable}
 * can be reused verbatim.
 */
export interface CreatorPageAgentView extends AgentCirculationView {
  agentId: string;
  /** The owning Student_Creator's id; used to scope the list to one creator. */
  ownerId: string;
  /** The Campus_Agent's display name presented in the entry (Req 15.15). */
  name: string;
  /** The Campus_Tag attached at publish; absent renders as an empty tag. */
  campusTag?: string;
}

/** The owning Student_Creator whose Creator_Page is being requested. */
export interface CreatorPageOwner {
  /** Stable id of the owning Student_Creator. */
  creatorId: string;
  /** The creator display name carried by every listed entry (Req 15.15). */
  displayName: string;
  /** The Creator_Page visibility setting; absent is treated as hidden (Req 15.16). */
  visibility?: CreatorPageVisibility | null;
}

/**
 * A single Creator_Page listing entry (Req 15.15). Carries the agent's display
 * name, the creator display name, and the Campus_Tag.
 */
export interface CreatorPageEntry {
  agentId: string;
  /** The Campus_Agent's own display name (Req 15.15). */
  agentName: string;
  /** The owning creator's display name (Req 15.15). */
  creatorDisplayName: string;
  /** The Campus_Tag, or an empty string when the agent carries none. */
  campusTag: string;
}

/**
 * A Creator_Page request: the resolved owning creator (with visibility
 * setting), the creator's candidate agents, and the (optional) authenticated
 * requester id.
 */
export interface CreatorPageRequest {
  creator: CreatorPageOwner;
  agents: readonly CreatorPageAgentView[];
  requesterId?: string | null;
}

/**
 * The outcome of the Creator_Page gate + projection:
 *   - `visible: false` with reason `unavailable` when the page is hidden and
 *     the requester is not the owning creator (Req 15.17).
 *   - `visible: true` with the projected `agents` list (possibly empty — the
 *     empty-state of Req 15.18) and the `isEmpty` flag otherwise.
 */
export type CreatorPageResult =
  | { visible: false; reason: "unavailable" }
  | {
      visible: true;
      creatorDisplayName: string;
      agents: CreatorPageEntry[];
      /** True iff no qualifying agent exists — the empty-state (Req 15.18). */
      isEmpty: boolean;
    };

// ---------------------------------------------------------------------------
// Ownership + listable invariant
// ---------------------------------------------------------------------------

/**
 * True iff `requesterId` identifies the owning creator of the Creator_Page. An
 * absent/empty requester (anonymous Caller) is never the owner. Pure.
 */
export function isCreatorPageOwner(
  creator: Pick<CreatorPageOwner, "creatorId">,
  requesterId: string | null | undefined
): boolean {
  return (
    typeof requesterId === "string" &&
    requesterId.length > 0 &&
    requesterId === creator.creatorId
  );
}

/**
 * True iff `agent` belongs on the creator's public list: it must be owned by
 * `creatorId` AND satisfy the published-and-public invariant (Req 15.15).
 * Reuses {@link isDiscoverable} so every private, removed, blocked, deleted,
 * draft, publish_pending_link, or link_failed agent is excluded. Pure.
 */
export function isCreatorPageListable(
  agent: CreatorPageAgentView,
  creatorId: string
): boolean {
  return agent.ownerId === creatorId && isDiscoverable(agent);
}

// ---------------------------------------------------------------------------
// Projection (Req 15.15, 15.18)
// ---------------------------------------------------------------------------

/**
 * Builds one Creator_Page listing entry for `agent`, carrying the agent's
 * display name, the creator display name, and the Campus_Tag (an absent tag
 * renders as an empty string). Pure and non-mutating.
 */
export function projectCreatorPageEntry(
  agent: CreatorPageAgentView,
  creatorDisplayName: string
): CreatorPageEntry {
  return {
    agentId: agent.agentId,
    agentName: agent.name,
    creatorDisplayName,
    campusTag: agent.campusTag ?? "",
  };
}

/**
 * Applies the Creator_Page visibility gate and, when the page is served,
 * projects the creator's public, published agents (Req 15.15, 15.16, 15.17,
 * 15.18).
 *
 * Decision order:
 *   1. Resolve the visibility setting (absent → hidden) (Req 15.16).
 *   2. If hidden AND the requester is not the owning creator, withhold all
 *      content and return `unavailable` (Req 15.17). (The owning creator may
 *      always view their own page, even while hidden.)
 *   3. Otherwise, list exactly the creator's public, published agents — each
 *      entry carrying the agent display name, creator display name, and
 *      Campus_Tag (Req 15.15) — with `isEmpty` flagging the empty-state when no
 *      qualifying agent exists (Req 15.18).
 *
 * Pure and non-mutating (a new array is returned).
 */
export function projectCreatorPage(
  request: CreatorPageRequest
): CreatorPageResult {
  const { creator, agents, requesterId } = request;
  const visibility = resolveCreatorPageVisibility(creator.visibility);

  if (visibility === "hidden" && !isCreatorPageOwner(creator, requesterId)) {
    return { visible: false, reason: "unavailable" };
  }

  const entries = agents
    .filter((agent) => isCreatorPageListable(agent, creator.creatorId))
    .map((agent) => projectCreatorPageEntry(agent, creator.displayName));

  return {
    visible: true,
    creatorDisplayName: creator.displayName,
    agents: entries,
    isEmpty: entries.length === 0,
  };
}
