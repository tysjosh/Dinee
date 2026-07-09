/**
 * Feature: dinee-campus (Task 22.1) — Safety_Service.
 *
 * The thin Convex layer that wraps the pure Campus safety logic
 * (`convex/campus/logic/validation.ts`, `screening.ts`, `consent.ts`) with the
 * database reads/writes and authorization the requirements demand. The pure
 * decision logic lives in those modules and is exercised directly by the
 * property tests; this file only orchestrates I/O.
 *
 * Covered behaviors:
 *   - 11.1 / 11.2: `submitReport` — validate (agentId present + reason 1..1000)
 *     via {@link validateReport}; record accepted reports with the agent id,
 *     reason, and a timestamp, or reject identifying the invalid field(s).
 *   - 11.3: `blockAgent` — operator action moving an agent to `blocked`.
 *   - 11.4 / 11.5 / 11.6: `removeFromListing` — operator action moving an agent
 *     to `removed`, which the Discovery_Service and Share_Service already treat
 *     as excluded / unavailable.
 *   - 11.7 / 11.8 / 11.9: `screenContent` — screen content against the
 *     profanity / harassment / sexual-content policies within a ≤5s budget and
 *     decide fail-closed via {@link decideScreening}; a timeout or dependency
 *     error yields flagged + withheld + `screening_unavailable`.
 *   - 11.10: `recordSelfHarmEscalation` — record that the configured self-harm
 *     escalation behavior was triggered, with a timestamp.
 *   - 11.11: `recordVoiceCloneConsent` — record a Voice_Clone_Consent verified
 *     through a recorded phrase or account ownership.
 */

import { v } from "convex/values";
import { action, mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import {
  requirePlatformAdminOrInternal,
  requireUserOrInternal,
  isPlatformAdmin,
} from "../shared/ownership";
import { assertInternalCaller } from "../shared/internalAuth";
import { validateReport } from "./logic/validation";
import {
  decideScreening,
  SCREENING_POLICIES,
  type ScreeningDecision,
  type ScreeningPolicy,
} from "./logic/screening";
import { isValidConsentMethod } from "./logic/consent";

// ---------------------------------------------------------------------------
// 11.1 / 11.2 — Report submission
// ---------------------------------------------------------------------------

/**
 * Submit an abuse/safety report for a Campus_Agent (Req 11.1, 11.2).
 *
 * The report is validated with the shared {@link validateReport} rule: it is
 * accepted if and only if it carries a reported agent identifier and a reason
 * of 1..1000 characters. An accepted report is recorded with the agent id, the
 * reason, and a creation timestamp, in the `open` state. A rejected report
 * returns the specific invalid field(s) so the caller can surface which field
 * is wrong. Callers may be anonymous, so no authentication is required.
 */
export const submitReport = mutation({
  args: {
    agentId: v.string(),
    reason: v.string(),
    callId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invalidFields = validateReport({
      agentId: args.agentId,
      reason: args.reason,
    });
    if (invalidFields.length > 0) {
      return { ok: false as const, invalidFields };
    }

    const reportId = `RPT_${crypto.randomUUID()}`;
    const createdAt = Date.now();
    await ctx.db.insert("campusReports", {
      reportId,
      agentId: args.agentId,
      reason: args.reason,
      callId: args.callId,
      createdAt,
      status: "open",
    });

    return { ok: true as const, reportId, createdAt };
  },
});

// ---------------------------------------------------------------------------
// 11.3 / 11.4–11.6 — Operator moderation actions
// ---------------------------------------------------------------------------

/**
 * Resolve a Campus_Agent by its public `agentId`, throwing when it does not
 * exist so operator actions fail loudly on a bad id.
 */
async function getAgentByAgentId(ctx: MutationCtx, agentId: string) {
  const agent = await ctx.db
    .query("campusAgents")
    .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
    .first();
  if (!agent) {
    throw new Error(`Campus_Agent not found: ${agentId}`);
  }
  return agent;
}

/**
 * Block a Campus_Agent (Req 11.3). Operator action: allowed for a platform
 * admin session or a trusted internal caller. Moves the agent to the `blocked`
 * Publish_State, which excludes it from discovery and makes its Call_Link
 * unavailable.
 */
export const blockAgent = mutation({
  args: {
    agentId: v.string(),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdminOrInternal(ctx, args.internalSecret);
    const agent = await getAgentByAgentId(ctx, args.agentId);
    await ctx.db.patch(agent._id, {
      status: "blocked",
      updatedAt: Date.now(),
    });
    return { ok: true as const, agentId: args.agentId, status: "blocked" as const };
  },
});

/**
 * Remove a Campus_Agent from public listing (Req 11.4). Operator action:
 * allowed for a platform admin session or a trusted internal caller. Moves the
 * agent to the `removed` Publish_State; the Discovery_Service already excludes
 * `removed` agents from every listing (Req 11.5) and the Share_Service returns
 * an unavailable response for its Call_Link (Req 11.6).
 */
export const removeFromListing = mutation({
  args: {
    agentId: v.string(),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdminOrInternal(ctx, args.internalSecret);
    const agent = await getAgentByAgentId(ctx, args.agentId);
    await ctx.db.patch(agent._id, {
      status: "removed",
      updatedAt: Date.now(),
    });
    return { ok: true as const, agentId: args.agentId, status: "removed" as const };
  },
});

// ---------------------------------------------------------------------------
// 11.7 / 11.8 / 11.9 — Content screening (fail-closed, ≤5s)
// ---------------------------------------------------------------------------

/** The ≤5s screening budget mandated by Req 11.7. */
const SCREENING_TIMEOUT_MS = 5000;

/**
 * Lightweight in-process content classifier used until an external screening
 * dependency is wired in. It reports which of the {@link SCREENING_POLICIES}
 * the content violates using conservative keyword matching. It is intentionally
 * simple and deterministic; the fail-closed decision that consumes its result
 * lives in {@link decideScreening}.
 */
const POLICY_TERMS: Record<ScreeningPolicy, readonly string[]> = {
  profanity: ["fuck", "shit", "bitch", "asshole", "bastard"],
  harassment: ["kill you", "kill yourself", "i hate you", "worthless", "loser"],
  sexual: ["sex", "porn", "nude", "nudes", "explicit"],
};

function classifyContent(content: string): ScreeningPolicy[] {
  const haystack = content.toLowerCase();
  const violated: ScreeningPolicy[] = [];
  for (const policy of SCREENING_POLICIES) {
    if (POLICY_TERMS[policy].some((term) => haystack.includes(term))) {
      violated.push(policy);
    }
  }
  return violated;
}

/**
 * Runs the screening classification against a ≤5s budget (Req 11.7). Resolves
 * with the violated policies when the classification completes in time, or
 * rejects when the budget is exceeded so the caller can fail closed (Req 11.9).
 */
function screenWithTimeout(content: string): Promise<readonly ScreeningPolicy[]> {
  const classification = Promise.resolve().then(() => classifyContent(content));
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () => reject(new Error("screening_timeout")),
      SCREENING_TIMEOUT_MS
    );
  });
  return Promise.race([classification, timeout]);
}

/**
 * Screen a piece of Knowledge_Source content or caller voice message against
 * the profanity, harassment, and sexual-content policies (Req 11.7) and return
 * the fail-closed moderation decision (Req 11.8, 11.9).
 *
 * The screening classification runs against a ≤5s budget; whatever the outcome,
 * {@link decideScreening} produces the decision:
 *   - clean, completed screen ⇒ `approved`, not flagged, not withheld;
 *   - completed screen with a violation ⇒ `flagged` + withheld, carrying the
 *     violated policies (Req 11.8);
 *   - timeout or dependency error ⇒ `flagged` + withheld with the
 *     `screening_unavailable` error indication (Req 11.9).
 *
 * This is an action (not a mutation) so the screening dependency may perform
 * I/O. It returns the decision; the storage layer applies the resulting
 * `moderationStatus` to the persisted content.
 */
export const screenContent = action({
  args: {
    content: v.string(),
    // Optional correlation only; the decision itself is stateless.
    sourceId: v.optional(v.string()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<ScreeningDecision> => {
    // Defense-in-depth: screening is a server/runtime path. Enforce the shared
    // internal secret when configured (a no-op in local dev).
    assertInternalCaller(args.internalSecret);

    try {
      const violatedPolicies = await screenWithTimeout(args.content);
      return decideScreening({ available: true, violatedPolicies });
    } catch {
      // Timeout or dependency failure: fail closed (Req 11.9).
      return decideScreening({ available: false });
    }
  },
});

// ---------------------------------------------------------------------------
// 11.10 — Self-harm escalation recording
// ---------------------------------------------------------------------------

/**
 * Record that the configured self-harm escalation behavior was triggered for a
 * voice conversation, with a timestamp (Req 11.10). Invoked by the voice
 * runtime, so it accepts a trusted internal caller (or a platform admin
 * session). The escalation behavior itself is triggered by the runtime; this
 * mutation persists the audit record that it fired.
 */
export const recordSelfHarmEscalation = mutation({
  args: {
    agentId: v.string(),
    callId: v.optional(v.string()),
    behavior: v.optional(v.string()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdminOrInternal(ctx, args.internalSecret);

    const escalationId = `ESC_${crypto.randomUUID()}`;
    const triggeredAt = Date.now();
    await ctx.db.insert("campusSafetyEscalations", {
      escalationId,
      agentId: args.agentId,
      callId: args.callId,
      kind: "self_harm",
      behavior: args.behavior ?? "default",
      triggeredAt,
    });

    return { ok: true as const, escalationId, triggeredAt };
  },
});

// ---------------------------------------------------------------------------
// 11.11 — Voice_Clone_Consent recording
// ---------------------------------------------------------------------------

/**
 * Record a Voice_Clone_Consent for a Campus_Agent, verified through a recorded
 * phrase or account ownership (Req 11.11). Allowed for the owning
 * Student_Creator (session), a platform admin, or a trusted internal caller.
 * The recorded consent is what the publish gate (`evaluateConsentGate`,
 * Req 11.12) resolves against before allowing a real-person agent to publish.
 */
export const recordVoiceCloneConsent = mutation({
  args: {
    agentId: v.string(),
    method: v.union(
      v.literal("recorded_phrase"),
      v.literal("account_ownership")
    ),
    verified: v.optional(v.boolean()),
    storageId: v.optional(v.string()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Guard against an invalid method reaching the store (Req 11.11). The arg
    // validator already constrains this; this is defense-in-depth.
    if (!isValidConsentMethod(args.method)) {
      throw new Error(`Invalid Voice_Clone_Consent method: ${args.method}`);
    }

    const user = await requireUserOrInternal(ctx, args.internalSecret);
    const agent = await getAgentByAgentId(ctx, args.agentId);

    // A session (non-internal) caller must own the agent (or be an admin).
    if (user && !isPlatformAdmin(user) && user._id !== agent.ownerId) {
      throw new Error("Forbidden: you do not own this Campus_Agent");
    }

    const consentId = `VCC_${crypto.randomUUID()}`;
    await ctx.db.insert("campusVoiceCloneConsents", {
      consentId,
      agentId: args.agentId,
      ownerId: agent.ownerId,
      method: args.method,
      verified: args.verified ?? true,
      storageId: args.storageId,
      createdAt: Date.now(),
    });

    return { ok: true as const, consentId };
  },
});
