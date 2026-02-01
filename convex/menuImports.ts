/**
 * Menu Imports - Convex functions for tracking menu import operations
 * 
 * This module provides CRUD operations for menu imports, including:
 * - Creating new import records
 * - Updating import status
 * - Tracking failed rows for retry
 * - Querying import history
 * 
 * @see Requirements: 4.6, 4.8
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ============================================================================
// Types
// ============================================================================

const importSourceValidator = v.union(v.literal("csv"), v.literal("google_sheets"));

const importStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed")
);

const failedRowValidator = v.object({
  row: v.number(),
  error: v.string(),
  data: v.optional(v.string()),
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new menu import record
 */
export const createImport = mutation({
  args: {
    importId: v.string(),
    branchId: v.string(),
    restaurantId: v.string(),
    source: importSourceValidator,
    sourceUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    totalRows: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("menuImports", {
      importId: args.importId,
      branchId: args.branchId,
      restaurantId: args.restaurantId,
      source: args.source,
      sourceUrl: args.sourceUrl,
      fileName: args.fileName,
      status: "pending",
      totalRows: args.totalRows,
      successCount: 0,
      failedCount: 0,
      failedRows: [],
      retryCount: 0,
      createdAt: Date.now(),
    });

    return { id, importId: args.importId };
  },
});

/**
 * Update import status to processing
 */
export const startProcessing = mutation({
  args: {
    importId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("menuImports")
      .withIndex("by_import_id", (q) => q.eq("importId", args.importId))
      .first();

    if (!existing) {
      throw new Error(`Import not found: ${args.importId}`);
    }

    await ctx.db.patch(existing._id, {
      status: "processing",
    });

    return { success: true };
  },
});

/**
 * Complete an import with results
 */
export const completeImport = mutation({
  args: {
    importId: v.string(),
    successCount: v.number(),
    failedCount: v.number(),
    failedRows: v.array(failedRowValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("menuImports")
      .withIndex("by_import_id", (q) => q.eq("importId", args.importId))
      .first();

    if (!existing) {
      throw new Error(`Import not found: ${args.importId}`);
    }

    const status = args.failedCount > 0 ? "completed" : "completed";

    await ctx.db.patch(existing._id, {
      status,
      successCount: args.successCount,
      failedCount: args.failedCount,
      failedRows: args.failedRows,
      completedAt: Date.now(),
    });

    return { success: true, status };
  },
});

/**
 * Mark import as failed
 */
export const failImport = mutation({
  args: {
    importId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("menuImports")
      .withIndex("by_import_id", (q) => q.eq("importId", args.importId))
      .first();

    if (!existing) {
      throw new Error(`Import not found: ${args.importId}`);
    }

    await ctx.db.patch(existing._id, {
      status: "failed",
      failedRows: [
        ...existing.failedRows,
        { row: 0, error: args.error },
      ],
      completedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Record a retry attempt
 */
export const recordRetry = mutation({
  args: {
    importId: v.string(),
    successCount: v.number(),
    failedCount: v.number(),
    failedRows: v.array(failedRowValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("menuImports")
      .withIndex("by_import_id", (q) => q.eq("importId", args.importId))
      .first();

    if (!existing) {
      throw new Error(`Import not found: ${args.importId}`);
    }

    const newRetryCount = (existing.retryCount || 0) + 1;
    const newSuccessCount = existing.successCount + args.successCount;
    const status = args.failedCount === 0 ? "completed" : "completed";

    await ctx.db.patch(existing._id, {
      status,
      successCount: newSuccessCount,
      failedCount: args.failedCount,
      failedRows: args.failedRows,
      retryCount: newRetryCount,
      lastRetryAt: Date.now(),
    });

    return { 
      success: true, 
      retryCount: newRetryCount,
      totalSuccess: newSuccessCount,
    };
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * Get import by ID
 */
export const getImport = query({
  args: {
    importId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("menuImports")
      .withIndex("by_import_id", (q) => q.eq("importId", args.importId))
      .first();
  },
});

/**
 * Get imports for a branch
 */
export const getImportsByBranch = query({
  args: {
    branchId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;
    
    return await ctx.db
      .query("menuImports")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get imports for a restaurant
 */
export const getImportsByRestaurant = query({
  args: {
    restaurantId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;
    
    return await ctx.db
      .query("menuImports")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get pending imports (for processing queue)
 */
export const getPendingImports = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;
    
    return await ctx.db
      .query("menuImports")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(limit);
  },
});

/**
 * Get failed rows for an import (for retry)
 */
export const getFailedRows = query({
  args: {
    importId: v.string(),
  },
  handler: async (ctx, args) => {
    const importRecord = await ctx.db
      .query("menuImports")
      .withIndex("by_import_id", (q) => q.eq("importId", args.importId))
      .first();

    if (!importRecord) {
      return { found: false, failedRows: [] };
    }

    return {
      found: true,
      failedRows: importRecord.failedRows,
      retryCount: importRecord.retryCount || 0,
    };
  },
});

/**
 * Get import statistics for a restaurant
 */
export const getImportStats = query({
  args: {
    restaurantId: v.string(),
  },
  handler: async (ctx, args) => {
    const imports = await ctx.db
      .query("menuImports")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    const totalImports = imports.length;
    const completedImports = imports.filter(i => i.status === "completed").length;
    const failedImports = imports.filter(i => i.status === "failed").length;
    const totalItemsImported = imports.reduce((sum, i) => sum + i.successCount, 0);
    const totalItemsFailed = imports.reduce((sum, i) => sum + i.failedCount, 0);

    return {
      totalImports,
      completedImports,
      failedImports,
      totalItemsImported,
      totalItemsFailed,
      successRate: totalImports > 0 
        ? (completedImports / totalImports) * 100 
        : 0,
    };
  },
});
