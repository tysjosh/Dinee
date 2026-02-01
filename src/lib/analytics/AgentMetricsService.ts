/**
 * AgentMetricsService - Service for calculating AI agent performance metrics
 * 
 * This service provides methods to calculate and aggregate agent performance data
 * for the agent performance dashboard, including:
 * - Total calls handled per agent
 * - Average call duration
 * - Order conversion rate
 * - ASR accuracy metrics
 * - Fallback trigger rate
 * 
 * @module analytics/AgentMetricsService
 * @see Requirements: 23.1, 23.2, 23.3, 23.5, 23.6
 */

import { AnalyticsFilter, CallData, OrderData } from './AnalyticsService';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended call data with ASR and fallback information
 * 
 * @see Requirements: 23.5, 23.6
 */
export interface AgentCallData extends CallData {
  /** ASR confidence score (0-100) */
  asrConfidence?: number;
  /** Detected language during the call */
  languageDetected?: string;
  /** Whether fallback was triggered during the call */
  fallbackTriggered?: boolean;
  /** Agent ID that handled the call (typically restaurantId or branchId) */
  agentId?: string;
}

/**
 * Agent performance metrics
 * 
 * @see Requirements: 23.1, 23.2, 23.3, 23.5, 23.6
 */
export interface AgentMetrics {
  /** Unique identifier for the agent (restaurantId or branchId) */
  agentId: string;
  /** Display name for the agent */
  agentName: string;
  /** Total number of calls handled by this agent */
  totalCalls: number;
  /** Average call duration in seconds */
  averageCallDuration: number;
  /** Order conversion rate (orders / calls * 100) */
  conversionRate: number;
  /** Average ASR confidence score (0-100) */
  asrAccuracy: number;
  /** Fallback trigger rate (fallbacks / calls * 100) */
  fallbackRate: number;
}

/**
 * Agent metrics summary for dashboard display
 */
export interface AgentMetricsSummary {
  /** Total agents analyzed */
  totalAgents: number;
  /** Total calls across all agents */
  totalCalls: number;
  /** Average conversion rate across all agents */
  averageConversionRate: number;
  /** Average ASR accuracy across all agents */
  averageAsrAccuracy: number;
  /** Average fallback rate across all agents */
  averageFallbackRate: number;
  /** Individual agent metrics */
  agents: AgentMetrics[];
}

/**
 * Agent comparison data for cross-branch analysis
 * 
 * @see Requirements: 23.7
 */
export interface AgentComparison {
  /** Agent being compared */
  agent: AgentMetrics;
  /** Rank by conversion rate (1 = best) */
  conversionRank: number;
  /** Rank by ASR accuracy (1 = best) */
  asrAccuracyRank: number;
  /** Rank by fallback rate (1 = best, lowest rate) */
  fallbackRateRank: number;
  /** Overall performance score (weighted average of ranks) */
  overallScore: number;
}

/**
 * Agent name mapping for display purposes
 */
export interface AgentNameMap {
  [agentId: string]: string;
}

// ============================================================================
// AgentMetricsService Class
// ============================================================================

/**
 * AgentMetricsService - Calculates AI agent performance metrics
 * 
 * This service analyzes call data to provide insights into agent performance,
 * including call handling, conversion rates, ASR accuracy, and fallback rates.
 * 
 * @example
 * ```typescript
 * const service = new AgentMetricsService();
 * 
 * // Get metrics for all agents in a restaurant
 * const metrics = service.calculateAgentMetrics(calls, orders, {
 *   restaurantId: 'rest_123',
 *   startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
 *   endDate: Date.now(),
 * });
 * ```
 * 
 * @see Requirements: 23.1, 23.2, 23.3, 23.5, 23.6
 */
export class AgentMetricsService {
  /**
   * Calculate metrics for a single agent
   * 
   * @param agentId - The agent identifier
   * @param agentName - Display name for the agent
   * @param calls - Array of call data for this agent
   * @param orders - Array of order data for this agent
   * @returns AgentMetrics object
   * 
   * @see Requirements: 23.1, 23.2, 23.3, 23.5, 23.6
   */
  calculateSingleAgentMetrics(
    agentId: string,
    agentName: string,
    calls: AgentCallData[],
    orders: OrderData[]
  ): AgentMetrics {
    const totalCalls = calls.length;

    // Calculate average call duration
    // @see Requirements: 23.2
    const callsWithDuration = calls.filter(c => c.duration !== undefined && c.duration > 0);
    const averageCallDuration = callsWithDuration.length > 0
      ? callsWithDuration.reduce((sum, c) => sum + (c.duration || 0), 0) / callsWithDuration.length
      : 0;

    // Calculate conversion rate (orders / calls * 100)
    // @see Requirements: 23.3
    const callsWithOrders = calls.filter(c => c.orderId);
    const conversionRate = totalCalls > 0
      ? (callsWithOrders.length / totalCalls) * 100
      : 0;

    // Calculate ASR accuracy (average confidence score)
    // @see Requirements: 23.5
    const callsWithAsrConfidence = calls.filter(
      c => c.asrConfidence !== undefined && c.asrConfidence >= 0
    );
    const asrAccuracy = callsWithAsrConfidence.length > 0
      ? callsWithAsrConfidence.reduce((sum, c) => sum + (c.asrConfidence || 0), 0) / callsWithAsrConfidence.length
      : 0;

    // Calculate fallback rate (fallbacks / calls * 100)
    // @see Requirements: 23.6
    const callsWithFallback = calls.filter(c => c.fallbackTriggered === true);
    const fallbackRate = totalCalls > 0
      ? (callsWithFallback.length / totalCalls) * 100
      : 0;

    return {
      agentId,
      agentName,
      totalCalls,
      averageCallDuration: Math.round(averageCallDuration),
      conversionRate: Math.round(conversionRate * 100) / 100,
      asrAccuracy: Math.round(asrAccuracy * 100) / 100,
      fallbackRate: Math.round(fallbackRate * 100) / 100,
    };
  }

  /**
   * Calculate metrics for all agents based on calls and orders data
   * 
   * Groups calls by agent (branchId or restaurantId) and calculates metrics for each.
   * 
   * @param calls - Array of call data
   * @param orders - Array of order data
   * @param filter - Optional filter for tenant and date range
   * @param agentNames - Optional mapping of agentId to display names
   * @returns Array of AgentMetrics objects
   * 
   * @see Requirements: 23.1, 23.2, 23.3, 23.5, 23.6, 23.8
   */
  calculateAgentMetrics(
    calls: AgentCallData[],
    orders: OrderData[],
    filter?: AnalyticsFilter,
    agentNames?: AgentNameMap
  ): AgentMetrics[] {
    // Apply filters
    const filteredCalls = this.filterCalls(calls, filter);
    const filteredOrders = this.filterOrders(orders, filter);

    // Group calls by agent (prefer branchId, fall back to restaurantId)
    const callsByAgent = this.groupCallsByAgent(filteredCalls);
    
    // Build order lookup by callId for efficient matching
    const ordersByCallId = new Map<string, OrderData>();
    for (const order of filteredOrders) {
      if (order.callId) {
        ordersByCallId.set(order.callId, order);
      }
    }

    // Calculate metrics for each agent
    const agentMetrics: AgentMetrics[] = [];

    for (const [agentId, agentCalls] of callsByAgent.entries()) {
      // Get orders associated with this agent's calls
      const agentOrders = agentCalls
        .filter(c => c.orderId)
        .map(c => ordersByCallId.get(c.callId))
        .filter((o): o is OrderData => o !== undefined);

      // Get agent name from mapping or use agentId
      const agentName = agentNames?.[agentId] || `Agent ${agentId}`;

      const metrics = this.calculateSingleAgentMetrics(
        agentId,
        agentName,
        agentCalls,
        agentOrders
      );

      agentMetrics.push(metrics);
    }

    // Sort by total calls (descending) by default
    return agentMetrics.sort((a, b) => b.totalCalls - a.totalCalls);
  }

  /**
   * Get agent metrics summary with aggregated statistics
   * 
   * @param calls - Array of call data
   * @param orders - Array of order data
   * @param filter - Optional filter for tenant and date range
   * @param agentNames - Optional mapping of agentId to display names
   * @returns AgentMetricsSummary with individual and aggregated metrics
   */
  getAgentMetricsSummary(
    calls: AgentCallData[],
    orders: OrderData[],
    filter?: AnalyticsFilter,
    agentNames?: AgentNameMap
  ): AgentMetricsSummary {
    const agents = this.calculateAgentMetrics(calls, orders, filter, agentNames);

    const totalAgents = agents.length;
    const totalCalls = agents.reduce((sum, a) => sum + a.totalCalls, 0);

    // Calculate weighted averages based on call volume
    let weightedConversionSum = 0;
    let weightedAsrSum = 0;
    let weightedFallbackSum = 0;

    for (const agent of agents) {
      weightedConversionSum += agent.conversionRate * agent.totalCalls;
      weightedAsrSum += agent.asrAccuracy * agent.totalCalls;
      weightedFallbackSum += agent.fallbackRate * agent.totalCalls;
    }

    const averageConversionRate = totalCalls > 0
      ? Math.round((weightedConversionSum / totalCalls) * 100) / 100
      : 0;
    const averageAsrAccuracy = totalCalls > 0
      ? Math.round((weightedAsrSum / totalCalls) * 100) / 100
      : 0;
    const averageFallbackRate = totalCalls > 0
      ? Math.round((weightedFallbackSum / totalCalls) * 100) / 100
      : 0;

    return {
      totalAgents,
      totalCalls,
      averageConversionRate,
      averageAsrAccuracy,
      averageFallbackRate,
      agents,
    };
  }

  /**
   * Compare agent performance across branches
   * 
   * Ranks agents by various metrics and calculates an overall performance score.
   * 
   * @param calls - Array of call data
   * @param orders - Array of order data
   * @param filter - Optional filter for tenant and date range
   * @param agentNames - Optional mapping of agentId to display names
   * @returns Array of AgentComparison objects sorted by overall score
   * 
   * @see Requirements: 23.7
   */
  compareAgentPerformance(
    calls: AgentCallData[],
    orders: OrderData[],
    filter?: AnalyticsFilter,
    agentNames?: AgentNameMap
  ): AgentComparison[] {
    const agents = this.calculateAgentMetrics(calls, orders, filter, agentNames);

    if (agents.length === 0) {
      return [];
    }

    // Sort agents by each metric to determine ranks
    const byConversion = [...agents].sort((a, b) => b.conversionRate - a.conversionRate);
    const byAsrAccuracy = [...agents].sort((a, b) => b.asrAccuracy - a.asrAccuracy);
    const byFallbackRate = [...agents].sort((a, b) => a.fallbackRate - b.fallbackRate); // Lower is better

    // Create rank maps
    const conversionRanks = new Map<string, number>();
    const asrRanks = new Map<string, number>();
    const fallbackRanks = new Map<string, number>();

    byConversion.forEach((agent, index) => conversionRanks.set(agent.agentId, index + 1));
    byAsrAccuracy.forEach((agent, index) => asrRanks.set(agent.agentId, index + 1));
    byFallbackRate.forEach((agent, index) => fallbackRanks.set(agent.agentId, index + 1));

    // Calculate comparisons with overall score
    const comparisons: AgentComparison[] = agents.map(agent => {
      const conversionRank = conversionRanks.get(agent.agentId) || agents.length;
      const asrAccuracyRank = asrRanks.get(agent.agentId) || agents.length;
      const fallbackRateRank = fallbackRanks.get(agent.agentId) || agents.length;

      // Calculate overall score (lower is better)
      // Weighted: conversion (40%), ASR accuracy (35%), fallback rate (25%)
      const overallScore = 
        (conversionRank * 0.4) + 
        (asrAccuracyRank * 0.35) + 
        (fallbackRateRank * 0.25);

      return {
        agent,
        conversionRank,
        asrAccuracyRank,
        fallbackRateRank,
        overallScore: Math.round(overallScore * 100) / 100,
      };
    });

    // Sort by overall score (lower is better)
    return comparisons.sort((a, b) => a.overallScore - b.overallScore);
  }

  /**
   * Get metrics for a specific agent by ID
   * 
   * @param agentId - The agent identifier to get metrics for
   * @param calls - Array of call data
   * @param orders - Array of order data
   * @param filter - Optional filter for date range
   * @param agentName - Optional display name for the agent
   * @returns AgentMetrics for the specified agent, or null if not found
   */
  getAgentMetricsById(
    agentId: string,
    calls: AgentCallData[],
    orders: OrderData[],
    filter?: AnalyticsFilter,
    agentName?: string
  ): AgentMetrics | null {
    // Filter calls for this specific agent
    const agentCalls = calls.filter(c => 
      c.branchId === agentId || c.restaurantId === agentId
    );

    if (agentCalls.length === 0) {
      return null;
    }

    // Apply date filters
    const filteredCalls = this.filterCalls(agentCalls, filter);
    const filteredOrders = this.filterOrders(
      orders.filter(o => o.branchId === agentId || o.restaurantId === agentId),
      filter
    );

    return this.calculateSingleAgentMetrics(
      agentId,
      agentName || `Agent ${agentId}`,
      filteredCalls,
      filteredOrders
    );
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Group calls by agent (branchId or restaurantId)
   * 
   * @param calls - Array of call data
   * @returns Map of agentId to calls
   */
  private groupCallsByAgent(calls: AgentCallData[]): Map<string, AgentCallData[]> {
    const grouped = new Map<string, AgentCallData[]>();

    for (const call of calls) {
      // Prefer branchId, fall back to restaurantId
      const agentId = call.branchId || call.restaurantId;
      
      if (!agentId) {
        continue; // Skip calls without agent identification
      }

      const existing = grouped.get(agentId) || [];
      existing.push(call);
      grouped.set(agentId, existing);
    }

    return grouped;
  }

  /**
   * Filter calls based on tenant and date range
   * 
   * @param calls - Array of call data
   * @param filter - Optional filter
   * @returns Filtered calls
   */
  private filterCalls(calls: AgentCallData[], filter?: AnalyticsFilter): AgentCallData[] {
    if (!filter) return calls;

    return calls.filter(call => {
      // Tenant filtering
      if (filter.restaurantId && call.restaurantId !== filter.restaurantId) {
        return false;
      }
      if (filter.branchId && call.branchId !== filter.branchId) {
        return false;
      }

      // Date range filtering
      const callTime = call.callStartTime || 0;
      if (filter.startDate && callTime < filter.startDate) {
        return false;
      }
      if (filter.endDate && callTime > filter.endDate) {
        return false;
      }

      return true;
    });
  }

  /**
   * Filter orders based on tenant and date range
   * 
   * @param orders - Array of order data
   * @param filter - Optional filter
   * @returns Filtered orders
   */
  private filterOrders(orders: OrderData[], filter?: AnalyticsFilter): OrderData[] {
    if (!filter) return orders;

    return orders.filter(order => {
      // Tenant filtering
      if (filter.restaurantId && order.restaurantId !== filter.restaurantId) {
        return false;
      }
      if (filter.branchId && order.branchId !== filter.branchId) {
        return false;
      }

      // Date range filtering
      const orderTime = order.orderPlacementTime || 0;
      if (filter.startDate && orderTime < filter.startDate) {
        return false;
      }
      if (filter.endDate && orderTime > filter.endDate) {
        return false;
      }

      return true;
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new AgentMetricsService instance
 * 
 * @returns A new AgentMetricsService instance
 */
export function createAgentMetricsService(): AgentMetricsService {
  return new AgentMetricsService();
}

// ============================================================================
// Default Export
// ============================================================================

export default AgentMetricsService;
