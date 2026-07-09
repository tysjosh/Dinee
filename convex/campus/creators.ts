/**
 * Feature: dinee-campus (Task 40.1)
 *
 * Creator_Page service — the thin Convex query layer that backs the public
 * Creator_Page route `/campus/u/[handle]`. It wraps the pure, I/O-free
 * projection + visibility-gate core (`convex/campus/logic/creatorPage.ts`,
 * task 38) with `users` / `campusAgents` reads so the surface and the property
 * tests share one definition of what a Creator_Page lists.
 *
 * Exposes a single public query (Callers view a Creator_Page without
 * authentication; the owning creator is identified when signed in):
 *   - `getCreatorPage`: resolves a Student_Creator by their `users.campusHandle`,
 *     reads that creator's Campus_Agents, and applies the Creator_Page gate:
 *       • public → list exactly the creator's public, published agents, each
 *         entry carrying the creator display name and Campus_Tag, with an
 *         empty-state when none qualify (Req 15.15, 15.16, 15.18);
 *       • hidden → withhold all content and return `unavailable` to anyone other
 *         than the owning creator (Req 15.17), while the owning creator may
 *         still view their own hidden page.
 *
 * Every listing / exclusion / empty-state / gate decision lives in the pure
 * core: this layer only resolves the creator, reads rows, adapts them to the
 * core's view types, and returns the projected result. Excluded (private /
 * removed / blocked / deleted / draft / pending / link_failed) agents never
 * reach the listing because the core reuses the same `isDiscoverable`
 * invariant as the discovery and profile access gates (Req 15.15).
 */

import { query } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

import {
  projectCreatorPage,
  type CreatorPageAgentView,
  type CreatorPageOwner,
  type CreatorPageResult,
} from "./logic/creatorPage";

/**
 * Adapts a stored `campusAgents` row to the minimal {@link CreatorPageAgentView}
 * the pure projection core consumes. The core re-applies the published + public
 * invariant, so passing every one of the creator's rows is safe.
 */
function toCreatorPageView(row: Doc<"campusAgents">): CreatorPageAgentView {
  return {
    agentId: row.agentId,
    ownerId: row.ownerId,
    name: row.name,
    campusTag: row.campusTag,
    status: row.status,
    visibility: row.visibility,
  };
}

/**
 * Returns the public Creator_Page for the Student_Creator addressed by
 * `handle`. The result is the discriminated {@link CreatorPageResult} from the
 * pure core: `{ visible: false, reason: "unavailable" }` when the page is
 * hidden to the requester (Req 15.17), or `{ visible: true, ... }` carrying the
 * creator display name and the projected (possibly empty) agent list
 * (Req 15.15, 15.18).
 *
 * An unknown handle is treated as a hidden page with no owner: it returns
 * `unavailable`, disclosing nothing about whether the handle exists (Req
 * 15.17).
 */
export const getCreatorPage = query({
  args: {
    handle: v.string(),
  },
  handler: async (ctx, args): Promise<CreatorPageResult> => {
    const requesterId = await getAuthUserId(ctx);
    const requester = requesterId ? (requesterId as unknown as string) : null;

    // Resolve the creator by handle (Req 15.15).
    const creatorDoc = await ctx.db
      .query("users")
      .withIndex("by_campus_handle", (q) => q.eq("campusHandle", args.handle))
      .first();

    // Unknown handle → withhold everything and return `unavailable`, exactly as
    // a hidden page would, so the existence of the handle is not disclosed
    // (Req 15.17). Model it as a hidden page with no matching owner.
    if (!creatorDoc) {
      return projectCreatorPage({
        creator: {
          creatorId: "",
          displayName: "",
          visibility: "hidden",
        },
        agents: [],
        requesterId: requester,
      });
    }

    const creatorId = creatorDoc._id as unknown as string;

    const creator: CreatorPageOwner = {
      creatorId,
      displayName: creatorDoc.campusDisplayName ?? creatorDoc.name ?? "",
      visibility: creatorDoc.creatorPageVisibility ?? null,
    };

    // Read the creator's agents; the pure core filters to public + published.
    const rows = await ctx.db
      .query("campusAgents")
      .withIndex("by_owner", (q) => q.eq("ownerId", creatorId))
      .collect();

    const agents = rows.map(toCreatorPageView);

    return projectCreatorPage({ creator, agents, requesterId: requester });
  },
});
