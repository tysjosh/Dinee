import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * API Usage Logs CRUD Operations
 * 
 * This module provides functions for logging and querying API usage
 * for partner applications.
 * 
 * @requirements 21.7 - Partner dashboard displays API usage metrics
 */

// ============================================================================
// Queries
// ============================================================================

/**
 * Get API usage logs for a partner
 */
export const getApiUsageLogsByPartnerId = query({
  args: {
    partnerId: v.string(),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let logs = await ctx.db
      .query("apiUsageLogs")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .collect();
    
    // Filter by time range if specified
    if (args.startTime) {
      logs = logs.filter((l) => l.createdAt >= args.startTime!);
    }
    if (args.endTime) {
      logs = logs.filter((l) => l.createdAt <= args.endTime!);
    }
    
    // Sort by createdAt descending
    logs.sort((a, b) => b.createdAt - a.createdAt);
    
    // Apply limit if specified
    if (args.limit) {
      return logs.slice(0, args.limit);
    }
    
    return logs;
  },
});

/**
 * Get API usage logs for an API key
 */
export const getApiUsageLogsByApiKeyId = query({
  args: {
    apiKeyId: v.string(),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let logs = await ctx.db
      .query("apiUsageLogs")
      .withIndex("by_api_key_id", (q) => q.eq("apiKeyId", args.apiKeyId))
      .collect();
    
    // Filter by time range if specified
    if (args.startTime) {
      logs = logs.filter((l) => l.createdAt >= args.startTime!);
    }
    if (args.endTime) {
      logs = logs.filter((l) => l.createdAt <= args.endTime!);
    }
    
    // Sort by createdAt descending
    logs.sort((a, b) => b.createdAt - a.createdAt);
    
    // Apply limit if specified
    if (args.limit) {
      return logs.slice(0, args.limit);
    }
    
    return logs;
  },
});

/**
 * Get API usage statistics for a partner
 */
export const getApiUsageStats = query({
  args: {
    partnerId: v.string(),
    startTime: v.optional(v.number()),
    endTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let logs = await ctx.db
      .query("apiUsageLogs")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .collect();
    
    // Filter by time range if specified
    if (args.startTime) {
      logs = logs.filter((l) => l.createdAt >= args.startTime!);
    }
    if (args.endTime) {
      logs = logs.filter((l) => l.createdAt <= args.endTime!);
    }
    
    // Calculate statistics
    const totalRequests = logs.length;
    const successfulRequests = logs.filter((l) => l.statusCode >= 200 && l.statusCode < 300).length;
    const failedRequests = logs.filter((l) => l.statusCode >= 400).length;
    const rateLimitedRequests = logs.filter((l) => l.statusCode === 429).length;
    
    // Group by endpoint
    const requestsByEndpoint: Record<string, number> = {};
    for (const log of logs) {
      requestsByEndpoint[log.endpoint] = (requestsByEndpoint[log.endpoint] || 0) + 1;
    }
    
    // Calculate average response time
    const totalResponseTime = logs.reduce((sum, l) => sum + l.responseTimeMs, 0);
    const averageResponseTime = totalRequests > 0 ? totalResponseTime / totalRequests : 0;
    
    // Group by status code
    const requestsByStatusCode: Record<number, number> = {};
    for (const log of logs) {
      requestsByStatusCode[log.statusCode] = (requestsByStatusCode[log.statusCode] || 0) + 1;
    }
    
    // Group by method
    const requestsByMethod: Record<string, number> = {};
    for (const log of logs) {
      requestsByMethod[log.method] = (requestsByMethod[log.method] || 0) + 1;
    }
    
    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      rateLimitedRequests,
      requestsByEndpoint,
      requestsByStatusCode,
      requestsByMethod,
      averageResponseTime,
      successRate: totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0,
    };
  },
});

/**
 * Get recent API usage for a partner (for dashboard)
 */
export const getRecentApiUsage = query({
  args: {
    partnerId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("apiUsageLogs")
      .withIndex("by_partner_id", (q) => q.eq("partnerId", args.partnerId))
      .collect();
    
    // Sort by createdAt descending
    logs.sort((a, b) => b.createdAt - a.createdAt);
    
    // Apply limit (default 100)
    const limit = args.limit || 100;
    return logs.slice(0, limit);
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new API usage log entry
 */
export const createApiUsageLog = mutation({
  args: {
    logId: v.string(),
    partnerId: v.string(),
    apiKeyId: v.string(),
    endpoint: v.string(),
    method: v.string(),
    statusCode: v.number(),
    responseTimeMs: v.number(),
    ipAddress: v.string(),
    userAgent: v.optional(v.string()),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("apiUsageLogs", {
      logId: args.logId,
      partnerId: args.partnerId,
      apiKeyId: args.apiKeyId,
      endpoint: args.endpoint,
      method: args.method,
      statusCode: args.statusCode,
      responseTimeMs: args.responseTimeMs,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
      requestId: args.requestId,
      createdAt: Date.now(),
    });

    return id;
  },
});

/**
 * Delete old API usage logs (for cleanup)
 */
export const deleteOldApiUsageLogs = mutation({
  args: {
    olderThanDays: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoffTime = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;
    
    const logs = await ctx.db
      .query("apiUsageLogs")
      .withIndex("by_created_at")
      .collect();
    
    const oldLogs = logs.filter((l) => l.createdAt < cutoffTime);
    
    for (const log of oldLogs) {
      await ctx.db.delete(log._id);
    }
    
    return oldLogs.length;
  },
});
