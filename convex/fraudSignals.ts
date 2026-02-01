import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Fraud Signals CRUD Operations
 * 
 * Manages fraud detection signals and phone number blocklist for the platform.
 * Tracks signals: repeated failed payments, high cancellation rate, unusual order patterns.
 * 
 * Validates: Requirements 25.1, 25.3
 * - 25.1: THE System SHALL track signals: repeated failed payments, high cancellation rate, unusual order patterns
 * - 25.3: THE System SHALL maintain a blocklist of phone numbers with confirmed fraud
 */

// Signal type definition for reuse
const signalTypeValidator = v.union(
  v.literal("repeated_failed_payments"),
  v.literal("high_cancellation_rate"),
  v.literal("unusual_order_pattern")
);

// Disposition type definition for reuse
const dispositionValidator = v.union(
  v.literal("cleared"),
  v.literal("blocked"),
  v.literal("monitoring")
);

/**
 * Record a fraud signal for a phone number
 * If a signal of the same type already exists for the phone number, increments the count
 * Otherwise, creates a new signal record
 * 
 * Validates: Requirement 25.1
 */
export const recordFraudSignal = mutation({
  args: {
    phoneNumber: v.string(),
    signalType: signalTypeValidator,
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if a signal of this type already exists for this phone number
    const existingSignals = await ctx.db
      .query("fraudSignals")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .collect();

    const existingSignal = existingSignals.find(
      (s) => s.signalType === args.signalType
    );

    if (existingSignal) {
      // Increment the signal count and update last occurrence
      await ctx.db.patch(existingSignal._id, {
        signalCount: existingSignal.signalCount + 1,
        lastOccurrence: now,
      });
      return existingSignal._id;
    } else {
      // Create a new signal record
      const id = await ctx.db.insert("fraudSignals", {
        phoneNumber: args.phoneNumber,
        signalType: args.signalType,
        signalCount: 1,
        lastOccurrence: now,
        isBlocked: false,
      });
      return id;
    }
  },
});

/**
 * Get all fraud signals for a phone number
 * Returns all signal types and their counts for the specified phone number
 */
export const getFraudSignals = query({
  args: {
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const signals = await ctx.db
      .query("fraudSignals")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .collect();

    return signals;
  },
});

/**
 * Get all blocked phone numbers
 * Returns all phone numbers that have been blocked due to confirmed fraud
 * 
 * Validates: Requirement 25.3
 */
export const getBlockedNumbers = query({
  args: {},
  handler: async (ctx) => {
    const blockedSignals = await ctx.db
      .query("fraudSignals")
      .withIndex("by_blocked", (q) => q.eq("isBlocked", true))
      .collect();

    // Get unique phone numbers from blocked signals
    const uniquePhoneNumbers = [...new Set(blockedSignals.map((s) => s.phoneNumber))];

    // Return detailed information for each blocked number
    const blockedNumbers = uniquePhoneNumbers.map((phoneNumber) => {
      const signals = blockedSignals.filter((s) => s.phoneNumber === phoneNumber);
      return {
        phoneNumber,
        signals: signals.map((s) => ({
          signalType: s.signalType,
          signalCount: s.signalCount,
          lastOccurrence: s.lastOccurrence,
          disposition: s.disposition,
          reviewedBy: s.reviewedBy,
          reviewedAt: s.reviewedAt,
        })),
        blockedAt: Math.max(...signals.map((s) => s.reviewedAt || s.lastOccurrence)),
      };
    });

    return blockedNumbers;
  },
});

/**
 * Block a phone number
 * Marks all signals for the phone number as blocked and records the reviewer
 * 
 * Validates: Requirement 25.3
 */
export const blockNumber = mutation({
  args: {
    phoneNumber: v.string(),
    reviewedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get all signals for this phone number
    const signals = await ctx.db
      .query("fraudSignals")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .collect();

    if (signals.length === 0) {
      // Create a new blocked signal if none exist
      const id = await ctx.db.insert("fraudSignals", {
        phoneNumber: args.phoneNumber,
        signalType: "unusual_order_pattern", // Default signal type for manual blocks
        signalCount: 0,
        lastOccurrence: now,
        isBlocked: true,
        reviewedBy: args.reviewedBy,
        reviewedAt: now,
        disposition: "blocked",
      });
      return { success: true, updatedCount: 1, ids: [id] };
    }

    // Update all signals for this phone number to blocked
    const updatedIds = [];
    for (const signal of signals) {
      await ctx.db.patch(signal._id, {
        isBlocked: true,
        reviewedBy: args.reviewedBy,
        reviewedAt: now,
        disposition: "blocked",
      });
      updatedIds.push(signal._id);
    }

    return { success: true, updatedCount: updatedIds.length, ids: updatedIds };
  },
});

/**
 * Unblock a phone number
 * Removes the blocked status from all signals for the phone number
 * 
 * Validates: Requirement 25.3
 */
export const unblockNumber = mutation({
  args: {
    phoneNumber: v.string(),
    reviewedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get all signals for this phone number
    const signals = await ctx.db
      .query("fraudSignals")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .collect();

    if (signals.length === 0) {
      return { success: false, message: "No signals found for this phone number" };
    }

    // Update all signals for this phone number to unblocked
    const updatedIds = [];
    for (const signal of signals) {
      await ctx.db.patch(signal._id, {
        isBlocked: false,
        reviewedBy: args.reviewedBy,
        reviewedAt: now,
        disposition: "cleared",
      });
      updatedIds.push(signal._id);
    }

    return { success: true, updatedCount: updatedIds.length, ids: updatedIds };
  },
});

/**
 * Update the disposition of a fraud signal
 * Allows manual review and disposition of flagged cases
 * 
 * Validates: Requirement 25.6
 */
export const updateDisposition = mutation({
  args: {
    phoneNumber: v.string(),
    signalType: signalTypeValidator,
    disposition: dispositionValidator,
    reviewedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Find the specific signal
    const signals = await ctx.db
      .query("fraudSignals")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .collect();

    const signal = signals.find((s) => s.signalType === args.signalType);

    if (!signal) {
      return { success: false, message: "Signal not found for this phone number and type" };
    }

    // Update the signal with the new disposition
    const isBlocked = args.disposition === "blocked";
    
    await ctx.db.patch(signal._id, {
      disposition: args.disposition,
      isBlocked,
      reviewedBy: args.reviewedBy,
      reviewedAt: now,
    });

    return { success: true, id: signal._id };
  },
});

/**
 * Check if a phone number is blocked
 * Used to determine if a call should be rejected or require human verification
 * 
 * Validates: Requirement 25.4
 */
export const isPhoneBlocked = query({
  args: {
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const signals = await ctx.db
      .query("fraudSignals")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .collect();

    const isBlocked = signals.some((s) => s.isBlocked);
    
    return {
      isBlocked,
      signals: signals.map((s) => ({
        signalType: s.signalType,
        signalCount: s.signalCount,
        lastOccurrence: s.lastOccurrence,
        disposition: s.disposition,
      })),
    };
  },
});

/**
 * Get all flagged phone numbers (signals above threshold but not yet reviewed)
 * Used for the fraud dashboard to display customers needing review
 * 
 * Validates: Requirement 25.5
 */
export const getFlaggedNumbers = query({
  args: {
    signalCountThreshold: v.optional(v.number()), // Default threshold is 3
  },
  handler: async (ctx, args) => {
    const threshold = args.signalCountThreshold ?? 3;

    // Get all signals
    const allSignals = await ctx.db
      .query("fraudSignals")
      .collect();

    // Filter signals that exceed threshold and haven't been reviewed
    const flaggedSignals = allSignals.filter(
      (s) => s.signalCount >= threshold && !s.disposition
    );

    // Group by phone number
    const phoneNumberMap = new Map<string, typeof flaggedSignals>();
    for (const signal of flaggedSignals) {
      const existing = phoneNumberMap.get(signal.phoneNumber) || [];
      existing.push(signal);
      phoneNumberMap.set(signal.phoneNumber, existing);
    }

    // Convert to array format
    const flaggedNumbers = Array.from(phoneNumberMap.entries()).map(
      ([phoneNumber, signals]) => ({
        phoneNumber,
        totalSignalCount: signals.reduce((sum, s) => sum + s.signalCount, 0),
        signals: signals.map((s) => ({
          signalType: s.signalType,
          signalCount: s.signalCount,
          lastOccurrence: s.lastOccurrence,
        })),
        lastOccurrence: Math.max(...signals.map((s) => s.lastOccurrence)),
      })
    );

    // Sort by total signal count descending
    flaggedNumbers.sort((a, b) => b.totalSignalCount - a.totalSignalCount);

    return flaggedNumbers;
  },
});

/**
 * Delete a fraud signal record
 * Used for administrative cleanup
 */
export const deleteFraudSignal = mutation({
  args: {
    phoneNumber: v.string(),
    signalType: signalTypeValidator,
  },
  handler: async (ctx, args) => {
    // Find the specific signal
    const signals = await ctx.db
      .query("fraudSignals")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .collect();

    const signal = signals.find((s) => s.signalType === args.signalType);

    if (!signal) {
      return { success: false, message: "Signal not found" };
    }

    await ctx.db.delete(signal._id);
    return { success: true, id: signal._id };
  },
});

/**
 * Get fraud signal statistics
 * Returns aggregate statistics for fraud monitoring
 */
export const getFraudStats = query({
  args: {},
  handler: async (ctx) => {
    const allSignals = await ctx.db
      .query("fraudSignals")
      .collect();

    // Count by signal type
    const bySignalType = {
      repeated_failed_payments: 0,
      high_cancellation_rate: 0,
      unusual_order_pattern: 0,
    };

    // Count by disposition
    const byDisposition = {
      cleared: 0,
      blocked: 0,
      monitoring: 0,
      pending_review: 0,
    };

    // Unique phone numbers
    const uniquePhones = new Set<string>();
    const blockedPhones = new Set<string>();

    for (const signal of allSignals) {
      uniquePhones.add(signal.phoneNumber);
      bySignalType[signal.signalType]++;
      
      if (signal.disposition) {
        byDisposition[signal.disposition]++;
      } else {
        byDisposition.pending_review++;
      }

      if (signal.isBlocked) {
        blockedPhones.add(signal.phoneNumber);
      }
    }

    return {
      totalSignals: allSignals.length,
      uniquePhoneNumbers: uniquePhones.size,
      blockedPhoneNumbers: blockedPhones.size,
      bySignalType,
      byDisposition,
    };
  },
});
