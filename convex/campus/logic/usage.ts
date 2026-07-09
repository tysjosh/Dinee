/**
 * Feature: dinee-campus (Task 13.1)
 *
 * Pure, property-testable core for the Usage_Meter gating and near-limit
 * warning behavior (Requirements 4.5, 5.7, 13.1, 13.2, 13.3, 13.6, 13.7).
 * These functions carry NO Convex `ctx` and perform no I/O, so they can be
 * exercised directly by unit and property tests and imported by the Convex
 * `usage.ts` service that wraps them with subscription reads + persistence.
 *
 * Covered behaviors:
 *   - 13.1: free-tier Usage_Limit of 30 call minutes / calendar month, 1
 *     Campus_Agent, and 5 document uploads; each document up to the free-tier
 *     per-document limit of 10 MB.
 *   - 4.5: creating an agent is permitted iff the agent count is strictly below
 *     the tier limit; on limit reached the action is blocked with the
 *     applicable limit and an upgrade option.
 *   - 5.7: uploading a document is permitted iff the upload count is strictly
 *     below the tier limit; on limit reached the upload is blocked with the
 *     applicable limit and an upgrade option (prior content left unchanged by
 *     the caller).
 *   - 13.3: a reached free-tier limit yields an upgrade option to a paid tier.
 *   - 13.6/13.7: starting a call is permitted iff call-minutes usage is strictly
 *     below the tier limit; when exhausted the start is declined with a
 *     "temporarily unavailable" indication and the agent's configuration/data
 *     are left unchanged (the caller cannot upgrade, so no upgrade option).
 *   - Document uploads additionally require the size to pass the layered
 *     document-size limits (platform maximum 20 MB checked FIRST, then the
 *     per-tier per-document limit — free tier 10 MB), reusing the constants
 *     defined by the Knowledge_Store.
 *   - 13.2: the near-limit warning is presented iff usage is at or above 80% of
 *     the limit and strictly below the limit.
 */

import {
  type AccountTier,
  PLATFORM_MAX_DOCUMENT_BYTES,
  perTierDocumentLimitBytes,
} from "./knowledge";

// ---------------------------------------------------------------------------
// Limits (Req 13.1)
// ---------------------------------------------------------------------------

/** The metered usage dimensions of a Student_Creator account (Req 13.1). */
export type UsageDimension = "agents" | "documentUploads" | "callMinutes";

/** The per-calendar-month quota values applied to an account (Req 13.1). */
export interface TierLimits {
  /** Maximum number of Campus_Agents the account may own (Req 4.5). */
  agents: number;
  /** Maximum number of document uploads per calendar month (Req 5.7). */
  documentUploads: number;
  /** Maximum call minutes per calendar month (Req 13.6, 13.7). */
  callMinutes: number;
}

/**
 * The free-tier Usage_Limit: 1 Campus_Agent, 5 document uploads, and 30 call
 * minutes per calendar month (Req 13.1).
 */
export const FREE_TIER_LIMITS: Readonly<TierLimits> = {
  agents: 1,
  documentUploads: 5,
  callMinutes: 30,
};

/**
 * Resolves the per-calendar-month quota values for an account tier (Req 13.1).
 * The free tier carries the concrete free-tier limits; the paid tier's concrete
 * numbers are provisioned from the owner's subscription by the Convex wrapper,
 * so this pure default treats a paid account as unbounded (no free-tier cap).
 * An unknown tier defaults to the free-tier limits (the strictest, safe
 * default).
 */
export function resolveTierLimits(tier: AccountTier): TierLimits {
  if (tier === "paid") {
    return {
      agents: Number.POSITIVE_INFINITY,
      documentUploads: Number.POSITIVE_INFINITY,
      callMinutes: Number.POSITIVE_INFINITY,
    };
  }
  return { ...FREE_TIER_LIMITS };
}

// ---------------------------------------------------------------------------
// Usage gate (Req 4.5, 5.7, 13.3, 13.6, 13.7)
// ---------------------------------------------------------------------------

/**
 * The outcome of a usage gate that, when a limit is reached, offers an upgrade
 * to a paid creator tier (Req 4.5, 5.7, 13.3). Used for the create-agent and
 * document-upload gates, whose blocked outcome surfaces the applicable limit
 * and an upgrade option to the owning Student_Creator.
 */
export type UsageGateResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: "usage_limit";
      dimension: UsageDimension;
      /** The applicable Usage_Limit the account reached (Req 4.5, 5.7). */
      limit: number;
      /** Present an upgrade option to a paid creator tier (Req 13.3). */
      upgradeOption: true;
    };

/**
 * Decides whether an action metered against `dimension` is permitted given the
 * current `usage` and the applicable `limit` (Req 4.5, 5.7). Pure and
 * non-mutating: the action is permitted if and only if usage is STRICTLY below
 * the limit; when the limit is reached the action is blocked with the
 * applicable limit and an upgrade option (Req 13.3).
 */
export function evaluateUsageGate(
  dimension: UsageDimension,
  usage: number,
  limit: number
): UsageGateResult {
  if (usage < limit) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: "usage_limit",
    dimension,
    limit,
    upgradeOption: true,
  };
}

/**
 * Decides whether the account may create another Campus_Agent (Req 4.5).
 * Permitted iff the current agent count is strictly below the tier's agent
 * limit; otherwise blocked with the applicable limit and an upgrade option.
 */
export function canCreateAgent(
  agentCount: number,
  tier: AccountTier = "free"
): UsageGateResult {
  return evaluateUsageGate("agents", agentCount, resolveTierLimits(tier).agents);
}

// ---------------------------------------------------------------------------
// Document-upload gate: layered size limits + upload-count gate (Req 5.7, 13.1)
// ---------------------------------------------------------------------------

/** The specific reason a document upload was blocked (Req 5.7, 13.1). */
export type DocumentUploadRejectionReason =
  | "usage_limit"
  | "document_too_large_platform"
  | "document_too_large_tier";

/**
 * The outcome of the document-upload gate (Req 5.7, 13.1). The applicable
 * per-tier per-document size limit is exposed on every outcome so the client
 * can always surface the correct bound for display.
 */
export type DocumentUploadGateResult =
  | { allowed: true; perTierSizeLimitBytes: number }
  | {
      allowed: false;
      reason: "usage_limit";
      /** The applicable upload-count Usage_Limit (Req 5.7). */
      limit: number;
      upgradeOption: true;
      perTierSizeLimitBytes: number;
    }
  | {
      allowed: false;
      reason: "document_too_large_platform";
      /** The platform maximum document size (20 MB) that was exceeded. */
      limitBytes: number;
      perTierSizeLimitBytes: number;
    }
  | {
      allowed: false;
      reason: "document_too_large_tier";
      /** The per-tier per-document size limit that was exceeded. */
      limitBytes: number;
      /** Present an upgrade option to a paid creator tier (Req 13.3). */
      upgradeOption: true;
      perTierSizeLimitBytes: number;
    };

/**
 * Decides whether a document upload is permitted (Req 5.7, 13.1). Pure and
 * non-mutating. A document upload is permitted if and only if every applicable
 * bound holds:
 *   1. the document size is no greater than the platform maximum of 20 MB
 *      (checked FIRST, Req 5.6/13.1),
 *   2. the document size is no greater than the account's per-tier per-document
 *      limit (free tier: 10 MB, Req 13.1), and
 *   3. the upload count is strictly below the tier's upload limit (Req 5.7).
 *
 * The checks are evaluated in that layered order, so a document over the
 * platform maximum is always reported as `document_too_large_platform`
 * regardless of tier or remaining upload quota. The applicable per-tier size
 * limit is included on every result for client display.
 */
export function canUploadDocument(
  uploadCount: number,
  sizeBytes: number,
  tier: AccountTier = "free"
): DocumentUploadGateResult {
  const perTierSizeLimitBytes = perTierDocumentLimitBytes(tier);

  // Layer 1 (checked first): platform maximum document size (Req 5.6, 13.1).
  if (sizeBytes > PLATFORM_MAX_DOCUMENT_BYTES) {
    return {
      allowed: false,
      reason: "document_too_large_platform",
      limitBytes: PLATFORM_MAX_DOCUMENT_BYTES,
      perTierSizeLimitBytes,
    };
  }

  // Layer 2: per-tier per-document size limit (Req 13.1).
  if (sizeBytes > perTierSizeLimitBytes) {
    return {
      allowed: false,
      reason: "document_too_large_tier",
      limitBytes: perTierSizeLimitBytes,
      upgradeOption: true,
      perTierSizeLimitBytes,
    };
  }

  // Layer 3: upload-count Usage_Limit (Req 5.7).
  const uploadLimit = resolveTierLimits(tier).documentUploads;
  if (!(uploadCount < uploadLimit)) {
    return {
      allowed: false,
      reason: "usage_limit",
      limit: uploadLimit,
      upgradeOption: true,
      perTierSizeLimitBytes,
    };
  }

  return { allowed: true, perTierSizeLimitBytes };
}

// ---------------------------------------------------------------------------
// Call-start gate (Req 13.6, 13.7)
// ---------------------------------------------------------------------------

/**
 * The outcome of the call-start gate (Req 13.6, 13.7). When call minutes are
 * exhausted the start is declined with a "temporarily unavailable" indication
 * rather than an upgrade option, because the Caller (not the owning
 * Student_Creator) is the one starting the call and cannot upgrade the account.
 * Blocking a call start leaves the Campus_Agent's configuration and data
 * unchanged (guaranteed here by purity — this function mutates nothing).
 */
export type CallStartGateResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: "call_minutes_exhausted";
      /** The applicable call-minutes Usage_Limit that was reached (Req 13.7). */
      limit: number;
      /** The agent is temporarily unavailable (Req 13.7). */
      unavailable: true;
    };

/**
 * Decides whether a Caller may start a voice conversation with a Campus_Agent
 * (Req 13.6, 13.7). Permitted iff the owning account's call-minutes usage for
 * the calendar month is strictly below the tier's call-minutes limit; when the
 * limit is reached the start is declined with a "temporarily unavailable"
 * indication and no configuration/data are changed.
 */
export function canStartCall(
  callMinutesUsed: number,
  tier: AccountTier = "free"
): CallStartGateResult {
  const limit = resolveTierLimits(tier).callMinutes;
  if (callMinutesUsed < limit) {
    return { allowed: true };
  }
  return { allowed: false, reason: "call_minutes_exhausted", limit, unavailable: true };
}

// ---------------------------------------------------------------------------
// Near-limit warning (Req 13.2)
// ---------------------------------------------------------------------------

/** The fraction of a Usage_Limit at which the near-limit warning begins (Req 13.2). */
export const NEAR_LIMIT_WARNING_FRACTION = 0.8;

/**
 * Decides whether the "limit nearly reached" warning should be presented for a
 * single usage dimension (Req 13.2). Pure and non-mutating: the warning is
 * presented if and only if usage is at or above 80% of the limit AND strictly
 * below the limit. At or above the limit the warning is not presented (the gate
 * blocks the action instead); a non-finite limit (e.g. an unbounded paid tier)
 * never triggers the warning.
 */
export function isNearLimit(usage: number, limit: number): boolean {
  if (!Number.isFinite(limit)) {
    return false;
  }
  return usage >= NEAR_LIMIT_WARNING_FRACTION * limit && usage < limit;
}

/** A snapshot of an account's calendar-month usage across all dimensions. */
export interface UsageSnapshot {
  agents: number;
  documentUploads: number;
  callMinutes: number;
}

/**
 * Returns the set of usage dimensions whose usage is in the near-limit band
 * (≥ 80% of and below the limit) for the given tier (Req 13.2). Pure and
 * non-mutating. Useful for surfacing per-dimension "nearly reached" warnings.
 */
export function nearLimitDimensions(
  usage: UsageSnapshot,
  tier: AccountTier = "free"
): UsageDimension[] {
  const limits = resolveTierLimits(tier);
  const dimensions: UsageDimension[] = [];
  if (isNearLimit(usage.agents, limits.agents)) dimensions.push("agents");
  if (isNearLimit(usage.documentUploads, limits.documentUploads)) {
    dimensions.push("documentUploads");
  }
  if (isNearLimit(usage.callMinutes, limits.callMinutes)) dimensions.push("callMinutes");
  return dimensions;
}
