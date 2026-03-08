/**
 * Phone Number Provisioning — Core Mutations
 *
 * Convex mutations for the phone number lifecycle: initiate provisioning,
 * assign numbers to branches, release numbers, request replacements, and
 * update health status.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 4.1, 4.2, 4.4, 4.7,
 *               9.6, 11.6, 13.1, 13.2, 13.3, 13.4
 */

import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import {
  healthStatusValidator,
  numberStatusValidator,
  numberCapabilityValidator,
  QUARANTINE_PERIOD_MS,
  MAX_PROVISION_ATTEMPTS,
} from "../shared/phoneProvisioningTypes";
import {
  generateRequestId,
  getProviderOrder,
} from "./providerRouting";

// ─── Simple structured logger for Convex server-side audit trail ────────────
// (src/lib/logger.ts is a Next.js module; we replicate the pattern here for
// the Convex runtime which runs in a different environment.)

function createLogger(module: string) {
  const emit = (
    level: "info" | "warn" | "error",
    message: string,
    ctx?: Record<string, unknown>
  ) => {
    const entry = { level, module, message, timestamp: new Date().toISOString(), ...ctx };
    if (level === "error") {
      console.error(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  };
  return {
    info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
    warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
    error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
  };
}

const logger = createLogger("phoneProvisioning/mutations");


// ─── Helper: check dedicated_numbers_enabled feature flag ───────────────────

async function isDedicatedNumbersEnabled(
  ctx: { db: { query: (table: string) => any } }
): Promise<boolean> {
  const flags = await ctx.db.query("featureFlags").collect();
  const flag = flags.find(
    (f: any) => f.name === "dedicated_numbers_enabled" && f.scope === "global"
  );
  return flag?.enabled === true;
}

// ─── 1. initiateProvisioning ────────────────────────────────────────────────
// Public mutation — called from the frontend onboarding flow.
// Req 3.1, 3.2, 9.6, 11.6

export const initiateProvisioning = mutation({
  args: {
    branchId: v.string(),
    region: v.string(),
    countryCode: v.string(),
  },
  handler: async (ctx, args) => {
    const { branchId, region, countryCode } = args;

    // Req 11.6 — feature flag gate
    const enabled = await isDedicatedNumbersEnabled(ctx);
    if (!enabled) {
      logger.warn("initiateProvisioning rejected: feature flag disabled", {
        action: "initiate_provisioning",
        branchId,
        region,
      });
      return {
        success: false,
        reason: "dedicated_numbers_disabled",
        message: "Dedicated number provisioning is not enabled",
      };
    }

    // Req 9.6 — skip if branch already has an assigned number
    const existingNumber = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_assigned_to", (q: any) =>
        q.eq("assignedToType", "branch").eq("assignedToId", branchId)
      )
      .first();

    if (existingNumber && existingNumber.status === "assigned") {
      logger.info("initiateProvisioning skipped: branch already has number", {
        action: "initiate_provisioning",
        branchId,
        numberId: existingNumber.numberId,
        phoneNumber: existingNumber.phoneNumber,
        provider: existingNumber.provider,
        region: existingNumber.region,
      });
      return {
        success: true,
        reason: "already_assigned",
        phoneNumberId: existingNumber.numberId,
        phoneNumber: existingNumber.phoneNumber,
      };
    }

    // Req 3.2 — check pool for available number in the requested region
    // Select oldest available number (by createdAt) for even rotation (Req 5.5)
    const poolNumbers = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_status", (q: any) => q.eq("status", "available"))
      .collect();

    const regionPool = poolNumbers
      .filter((n: any) => n.region === region)
      .sort((a: any, b: any) => a.createdAt - b.createdAt);

    if (regionPool.length > 0) {
      // Assign from pool — call internal assignNumberToBranch logic inline
      const poolNumber = regionPool[0];

      const now = Date.now();
      await ctx.db.patch(poolNumber._id, {
        status: "assigned" as const,
        assignedToType: "branch" as const,
        assignedToId: branchId,
        assignedAt: now,
        healthStatus: "healthy" as const,
      });

      // Update branch record's phoneNumber field (Req 3.4)
      const branch = await ctx.db
        .query("branches")
        .withIndex("by_branch_id", (q: any) => q.eq("branchId", branchId))
        .first();

      if (branch) {
        await ctx.db.patch(branch._id, { phoneNumber: poolNumber.phoneNumber });
      }

      logger.info("Number assigned from pool", {
        action: "assign",
        numberId: poolNumber.numberId,
        phoneNumber: poolNumber.phoneNumber,
        provider: poolNumber.provider,
        region: poolNumber.region,
        branchId,
        restaurantId: branch?.restaurantId,
      });

      return {
        success: true,
        reason: "assigned_from_pool",
        phoneNumberId: poolNumber.numberId,
        phoneNumber: poolNumber.phoneNumber,
      };
    }

    // No pool number available — create a provisioning request for on-demand purchase
    const requestId = generateRequestId();
    const providerOrder = getProviderOrder(region as any);
    const primaryProvider = providerOrder[0];
    const now = Date.now();

    await ctx.db.insert("provisioningRequests", {
      requestId,
      branchId,
      targetType: "branch",
      provider: primaryProvider,
      status: "pending",
      region,
      countryCode,
      attemptCount: 0,
      maxAttempts: MAX_PROVISION_ATTEMPTS,
      createdAt: now,
      updatedAt: now,
    });

    logger.info("Provisioning request created", {
      action: "initiate_provisioning",
      requestId,
      branchId,
      region,
      countryCode,
      provider: primaryProvider,
    });

    return {
      success: true,
      reason: "provisioning_requested",
      requestId,
    };
  },
});


// ─── 2. assignNumberToBranch ────────────────────────────────────────────────
// Internal mutation — called from actions (e.g. executeProvisioning).
// Req 3.3, 3.4, 3.5, 3.7, 4.7, 13.2, 13.3

export const assignNumberToBranch = internalMutation({
  args: {
    phoneNumberId: v.string(),
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    const { phoneNumberId, branchId } = args;

    // Look up the phone number record
    const phoneNumber = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_number_id", (q: any) => q.eq("numberId", phoneNumberId))
      .first();

    if (!phoneNumber) {
      throw new Error(`Phone number not found: ${phoneNumberId}`);
    }

    // Req 3.7, 4.7 — only "available" numbers can be assigned
    if (phoneNumber.status !== "available") {
      logger.warn("Assignment rejected: number not available", {
        action: "assign",
        numberId: phoneNumberId,
        phoneNumber: phoneNumber.phoneNumber,
        currentStatus: phoneNumber.status,
        branchId,
      });
      throw new Error(
        `Cannot assign number ${phoneNumberId}: status is "${phoneNumber.status}", expected "available"`
      );
    }

    const now = Date.now();

    // Req 3.3, 3.5 — update phone number record
    await ctx.db.patch(phoneNumber._id, {
      status: "assigned" as const,
      assignedToType: "branch" as const,
      assignedToId: branchId,
      assignedAt: now,
      healthStatus: "healthy" as const,
    });

    // Req 3.4 — update branch record's phoneNumber field
    const branch = await ctx.db
      .query("branches")
      .withIndex("by_branch_id", (q: any) => q.eq("branchId", branchId))
      .first();

    if (branch) {
      await ctx.db.patch(branch._id, { phoneNumber: phoneNumber.phoneNumber });
    }

    // Req 13.2, 13.3 — audit log
    logger.info("Number assigned to branch", {
      action: "assign",
      numberId: phoneNumberId,
      phoneNumber: phoneNumber.phoneNumber,
      provider: phoneNumber.provider,
      region: phoneNumber.region,
      branchId,
      restaurantId: branch?.restaurantId,
    });

    return {
      success: true,
      numberId: phoneNumberId,
      phoneNumber: phoneNumber.phoneNumber,
    };
  },
});

// ─── 3. releaseNumber ───────────────────────────────────────────────────────
// Public mutation — called from frontend and other mutations.
// Req 4.1, 4.2, 4.4, 13.1, 13.4

export const releaseNumber = mutation({
  args: {
    phoneNumberId: v.string(),
  },
  handler: async (ctx, args) => {
    const { phoneNumberId } = args;

    const phoneNumber = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_number_id", (q: any) => q.eq("numberId", phoneNumberId))
      .first();

    if (!phoneNumber) {
      throw new Error(`Phone number not found: ${phoneNumberId}`);
    }

    // Only assigned numbers can be released
    if (phoneNumber.status !== "assigned") {
      logger.warn("Release rejected: number not assigned", {
        action: "release",
        numberId: phoneNumberId,
        phoneNumber: phoneNumber.phoneNumber,
        currentStatus: phoneNumber.status,
      });
      throw new Error(
        `Cannot release number ${phoneNumberId}: status is "${phoneNumber.status}", expected "assigned"`
      );
    }

    const now = Date.now();

    // Capture previous assignment for audit trail (Req 13.4)
    const previousAssignment = {
      assignedToType: phoneNumber.assignedToType,
      assignedToId: phoneNumber.assignedToId,
      assignedAt: phoneNumber.assignedAt,
    };

    // Req 4.1 — transition to "releasing", clear assignment fields, set releasedAt
    await ctx.db.patch(phoneNumber._id, {
      status: "releasing" as const,
      assignedToType: undefined,
      assignedToId: undefined,
      assignedAt: undefined,
      releasedAt: now,
    });

    logger.info("Number entering releasing state", {
      action: "release",
      numberId: phoneNumberId,
      phoneNumber: phoneNumber.phoneNumber,
      provider: phoneNumber.provider,
      region: phoneNumber.region,
      previousAssignedToType: previousAssignment.assignedToType,
      previousAssignedToId: previousAssignment.assignedToId,
    });

    // Req 4.4 — transition to "quarantined" with quarantineExpiresAt
    await ctx.db.patch(phoneNumber._id, {
      status: "quarantined" as const,
      quarantineExpiresAt: now + QUARANTINE_PERIOD_MS,
    });

    logger.info("Number quarantined", {
      action: "quarantine",
      numberId: phoneNumberId,
      phoneNumber: phoneNumber.phoneNumber,
      provider: phoneNumber.provider,
      region: phoneNumber.region,
      quarantineExpiresAt: now + QUARANTINE_PERIOD_MS,
    });

    return {
      success: true,
      numberId: phoneNumberId,
      status: "quarantined",
      quarantineExpiresAt: now + QUARANTINE_PERIOD_MS,
    };
  },
});

// ─── 4. requestReplacement ──────────────────────────────────────────────────
// Public mutation — called from frontend dashboard.
// Releases current number and initiates new provisioning.

export const requestReplacement = mutation({
  args: {
    branchId: v.string(),
  },
  handler: async (ctx, args) => {
    const { branchId } = args;

    // Find the branch's currently assigned number
    const currentNumber = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_assigned_to", (q: any) =>
        q.eq("assignedToType", "branch").eq("assignedToId", branchId)
      )
      .first();

    if (!currentNumber || currentNumber.status !== "assigned") {
      logger.warn("Replacement requested but no assigned number found", {
        action: "request_replacement",
        branchId,
      });
      return {
        success: false,
        reason: "no_assigned_number",
        message: "Branch does not have an assigned phone number to replace",
      };
    }

    // ── Release the current number ──
    const now = Date.now();
    const previousAssignment = {
      assignedToType: currentNumber.assignedToType,
      assignedToId: currentNumber.assignedToId,
    };

    // Transition: assigned → releasing → quarantined
    await ctx.db.patch(currentNumber._id, {
      status: "releasing" as const,
      assignedToType: undefined,
      assignedToId: undefined,
      assignedAt: undefined,
      releasedAt: now,
    });

    await ctx.db.patch(currentNumber._id, {
      status: "quarantined" as const,
      quarantineExpiresAt: now + QUARANTINE_PERIOD_MS,
    });

    logger.info("Number released for replacement", {
      action: "release",
      numberId: currentNumber.numberId,
      phoneNumber: currentNumber.phoneNumber,
      provider: currentNumber.provider,
      region: currentNumber.region,
      previousAssignedToType: previousAssignment.assignedToType,
      previousAssignedToId: previousAssignment.assignedToId,
      branchId,
    });

    // ── Initiate new provisioning ──
    const enabled = await isDedicatedNumbersEnabled(ctx);
    if (!enabled) {
      return {
        success: false,
        reason: "dedicated_numbers_disabled",
        message: "Dedicated number provisioning is not enabled. Old number released.",
        releasedNumberId: currentNumber.numberId,
      };
    }

    // Check pool for available number in the same region
    const poolNumbers = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_status", (q: any) => q.eq("status", "available"))
      .collect();

    const regionPool = poolNumbers
      .filter((n: any) => n.region === currentNumber.region)
      .sort((a: any, b: any) => a.createdAt - b.createdAt);

    if (regionPool.length > 0) {
      const poolNumber = regionPool[0];
      await ctx.db.patch(poolNumber._id, {
        status: "assigned" as const,
        assignedToType: "branch" as const,
        assignedToId: branchId,
        assignedAt: now,
        healthStatus: "healthy" as const,
      });

      const branch = await ctx.db
        .query("branches")
        .withIndex("by_branch_id", (q: any) => q.eq("branchId", branchId))
        .first();

      if (branch) {
        await ctx.db.patch(branch._id, { phoneNumber: poolNumber.phoneNumber });
      }

      logger.info("Replacement number assigned from pool", {
        action: "assign",
        numberId: poolNumber.numberId,
        phoneNumber: poolNumber.phoneNumber,
        provider: poolNumber.provider,
        region: poolNumber.region,
        branchId,
        restaurantId: branch?.restaurantId,
        replacedNumberId: currentNumber.numberId,
      });

      return {
        success: true,
        reason: "replacement_assigned_from_pool",
        releasedNumberId: currentNumber.numberId,
        newPhoneNumberId: poolNumber.numberId,
        newPhoneNumber: poolNumber.phoneNumber,
      };
    }

    // No pool number — create provisioning request
    const requestId = generateRequestId();
    const providerOrder = getProviderOrder(currentNumber.region as any);
    const primaryProvider = providerOrder[0];

    await ctx.db.insert("provisioningRequests", {
      requestId,
      branchId,
      targetType: "branch",
      provider: primaryProvider,
      status: "pending",
      region: currentNumber.region,
      countryCode: currentNumber.countryCode,
      attemptCount: 0,
      maxAttempts: MAX_PROVISION_ATTEMPTS,
      createdAt: now,
      updatedAt: now,
    });

    logger.info("Replacement provisioning request created", {
      action: "initiate_provisioning",
      requestId,
      branchId,
      region: currentNumber.region,
      countryCode: currentNumber.countryCode,
      provider: primaryProvider,
      replacedNumberId: currentNumber.numberId,
    });

    return {
      success: true,
      reason: "replacement_provisioning_requested",
      releasedNumberId: currentNumber.numberId,
      requestId,
    };
  },
});

// ─── 5. updateHealthStatus ──────────────────────────────────────────────────
// Internal mutation — called from scheduled health check functions.
// Req 7.3, 7.4, 7.5, 7.6

export const updateHealthStatus = internalMutation({
  args: {
    phoneNumberId: v.string(),
    healthStatus: healthStatusValidator,
  },
  handler: async (ctx, args) => {
    const { phoneNumberId, healthStatus } = args;

    const phoneNumber = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_number_id", (q: any) => q.eq("numberId", phoneNumberId))
      .first();

    if (!phoneNumber) {
      throw new Error(`Phone number not found: ${phoneNumberId}`);
    }

    const now = Date.now();
    const previousHealthStatus = phoneNumber.healthStatus;

    // Req 7.6 — always update lastHealthCheckAt regardless of result
    await ctx.db.patch(phoneNumber._id, {
      healthStatus,
      lastHealthCheckAt: now,
    });

    logger.info("Health status updated", {
      action: "health_check",
      numberId: phoneNumberId,
      phoneNumber: phoneNumber.phoneNumber,
      provider: phoneNumber.provider,
      region: phoneNumber.region,
      previousHealthStatus,
      newHealthStatus: healthStatus,
    });

    return {
      success: true,
      numberId: phoneNumberId,
      previousHealthStatus,
      healthStatus,
    };
  },
});

// ─── 6. Helper internal mutations for executeProvisioning action ────────────
// These are called from the actions module via ctx.runMutation.

/** Update provisioning request status and attempt count */
export const updateProvisioningRequestStatus = internalMutation({
  args: {
    requestId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    attemptCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("provisioningRequests")
      .withIndex("by_request_id", (q: any) => q.eq("requestId", args.requestId))
      .first();

    if (!request) {
      throw new Error(`Provisioning request not found: ${args.requestId}`);
    }

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.attemptCount !== undefined) {
      patch.attemptCount = args.attemptCount;
    }

    await ctx.db.patch(request._id, patch);
  },
});

/** Update provisioning request with error info */
export const updateProvisioningRequestError = internalMutation({
  args: {
    requestId: v.string(),
    provider: v.string(),
    lastError: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("provisioningRequests")
      .withIndex("by_request_id", (q: any) => q.eq("requestId", args.requestId))
      .first();

    if (!request) {
      throw new Error(`Provisioning request not found: ${args.requestId}`);
    }

    await ctx.db.patch(request._id, {
      provider: args.provider,
      lastError: args.lastError,
      updatedAt: Date.now(),
    });
  },
});

/** Mark provisioning request as failed */
export const failProvisioningRequest = internalMutation({
  args: {
    requestId: v.string(),
    lastError: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("provisioningRequests")
      .withIndex("by_request_id", (q: any) => q.eq("requestId", args.requestId))
      .first();

    if (!request) {
      throw new Error(`Provisioning request not found: ${args.requestId}`);
    }

    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: "failed" as const,
      lastError: args.lastError,
      updatedAt: now,
      completedAt: now,
    });

    logger.info("Provisioning request marked as failed", {
      action: "execute_provisioning",
      requestId: args.requestId,
      lastError: args.lastError,
    });
  },
});

/** Mark provisioning request as completed */
export const completeProvisioningRequest = internalMutation({
  args: {
    requestId: v.string(),
    phoneNumberId: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("provisioningRequests")
      .withIndex("by_request_id", (q: any) => q.eq("requestId", args.requestId))
      .first();

    if (!request) {
      throw new Error(`Provisioning request not found: ${args.requestId}`);
    }

    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: "completed" as const,
      phoneNumberId: args.phoneNumberId,
      updatedAt: now,
      completedAt: now,
    });

    logger.info("Provisioning request completed", {
      action: "execute_provisioning",
      requestId: args.requestId,
      phoneNumberId: args.phoneNumberId,
    });
  },
});

/** Insert a new phone number record */
export const insertPhoneNumber = internalMutation({
  args: {
    numberId: v.string(),
    phoneNumber: v.string(),
    provider: v.string(),
    status: numberStatusValidator,
    capabilities: v.array(numberCapabilityValidator),
    region: v.string(),
    countryCode: v.string(),
    createdAt: v.number(),
    providerNumberSid: v.string(),
    monthlyCost: v.number(),
    currency: v.string(),
    healthStatus: healthStatusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("phoneNumbers", {
      numberId: args.numberId,
      phoneNumber: args.phoneNumber,
      provider: args.provider,
      status: args.status,
      capabilities: args.capabilities,
      region: args.region,
      countryCode: args.countryCode,
      createdAt: args.createdAt,
      providerNumberSid: args.providerNumberSid,
      monthlyCost: args.monthlyCost,
      currency: args.currency,
      healthStatus: args.healthStatus,
    });
  },
});

/** Transition a quarantined number to "available" (retain in pool) */
export const retainQuarantinedNumber = internalMutation({
  args: {
    phoneNumberId: v.string(),
  },
  handler: async (ctx, args) => {
    const phoneNumber = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_number_id", (q: any) => q.eq("numberId", args.phoneNumberId))
      .first();

    if (!phoneNumber) {
      throw new Error(`Phone number not found: ${args.phoneNumberId}`);
    }

    await ctx.db.patch(phoneNumber._id, {
      status: "available" as const,
      quarantineExpiresAt: undefined,
      releasedAt: undefined,
    });

    logger.info("Quarantined number retained in pool as available", {
      action: "quarantine_expiry",
      numberId: args.phoneNumberId,
      phoneNumber: phoneNumber.phoneNumber,
      provider: phoneNumber.provider,
      region: phoneNumber.region,
      reason: "pool_below_minimum",
    });
  },
});

/** Mark a quarantined number as "released" after provider release */
export const markNumberReleased = internalMutation({
  args: {
    phoneNumberId: v.string(),
  },
  handler: async (ctx, args) => {
    const phoneNumber = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_number_id", (q: any) => q.eq("numberId", args.phoneNumberId))
      .first();

    if (!phoneNumber) {
      throw new Error(`Phone number not found: ${args.phoneNumberId}`);
    }

    await ctx.db.patch(phoneNumber._id, {
      status: "released" as const,
      quarantineExpiresAt: undefined,
    });

    logger.info("Number released back to provider", {
      action: "release_at_provider",
      numberId: args.phoneNumberId,
      phoneNumber: phoneNumber.phoneNumber,
      provider: phoneNumber.provider,
      region: phoneNumber.region,
      reason: "quarantine_expired",
    });
  },
});

