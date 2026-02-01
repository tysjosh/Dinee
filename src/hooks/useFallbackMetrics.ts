/**
 * useFallbackMetrics Hook
 * 
 * Custom hook for computing fallback metrics from calls data.
 * Provides fallback rate, success/failure breakdown, and branch-level metrics.
 * 
 * @module hooks/useFallbackMetrics
 * @requirements 18.5 - Log fallback events with original confidence score and selected fallback channel
 * @requirements 18.6 - Display fallback rate metrics in branch dashboard
 */

import { useMemo } from 'react';
import type { FallbackMetricsData, BranchFallbackData } from '@/components/dashboard/FallbackMetrics';

// ============================================================================
// Types
// ============================================================================

/**
 * Call data structure for metrics calculation
 */
export interface CallDataForMetrics {
  /** Call ID */
  callId: string;
  /** Restaurant ID */
  restaurantId?: string;
  /** Branch ID */
  branchId?: string;
  /** Call start time */
  callStartTime?: number;
  /** ASR confidence score */
  asrConfidence?: number;
  /** Whether fallback was triggered */
  fallbackTriggered?: boolean;
  /** Call status */
  status?: 'active' | 'completed';
}

/**
 * Fallback event data for metrics calculation
 */
export interface FallbackEventForMetrics {
  /** Event ID */
  eventId: string;
  /** Call ID */
  callId: string;
  /** Branch ID */
  branchId?: string;
  /** Restaurant ID */
  restaurantId?: string;
  /** Original confidence score */
  originalConfidence: number;
  /** Selected channel */
  selectedChannel: 'whatsapp' | 'sms';
  /** Whether fallback was successful */
  success: boolean;
  /** Timestamp */
  timestamp: number;
}

/**
 * Branch data for metrics calculation
 */
export interface BranchDataForMetrics {
  /** Branch ID */
  branchId: string;
  /** Branch name */
  name: string;
}

/**
 * Time period filter
 */
export interface MetricsTimeFilter {
  /** Start timestamp */
  startTime: number;
  /** End timestamp */
  endTime: number;
}

/**
 * Hook options
 */
export interface UseFallbackMetricsOptions {
  /** Calls data */
  calls: CallDataForMetrics[];
  /** Fallback events data */
  fallbackEvents?: FallbackEventForMetrics[];
  /** Branch data for names */
  branches?: BranchDataForMetrics[];
  /** Current period filter */
  currentPeriod?: MetricsTimeFilter;
  /** Previous period filter for comparison */
  previousPeriod?: MetricsTimeFilter;
  /** Branch ID filter */
  branchId?: string;
  /** Restaurant ID filter */
  restaurantId?: string;
}

/**
 * Hook return type
 */
export interface UseFallbackMetricsReturn {
  /** Overall metrics */
  metrics: FallbackMetricsData;
  /** Branch-level metrics */
  branchMetrics: BranchFallbackData[];
  /** Whether data is loading */
  isLoading: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get default time periods (last 7 days and previous 7 days)
 */
function getDefaultTimePeriods(): {
  current: MetricsTimeFilter;
  previous: MetricsTimeFilter;
} {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  return {
    current: {
      startTime: now - sevenDaysMs,
      endTime: now,
    },
    previous: {
      startTime: now - 2 * sevenDaysMs,
      endTime: now - sevenDaysMs,
    },
  };
}

/**
 * Filter calls by time period
 */
function filterCallsByPeriod(
  calls: CallDataForMetrics[],
  period: MetricsTimeFilter
): CallDataForMetrics[] {
  return calls.filter((call) => {
    const callTime = call.callStartTime || 0;
    return callTime >= period.startTime && callTime <= period.endTime;
  });
}

/**
 * Filter fallback events by time period
 */
function filterEventsByPeriod(
  events: FallbackEventForMetrics[],
  period: MetricsTimeFilter
): FallbackEventForMetrics[] {
  return events.filter((event) => {
    return event.timestamp >= period.startTime && event.timestamp <= period.endTime;
  });
}

/**
 * Calculate metrics from calls and events
 */
function calculateMetrics(
  calls: CallDataForMetrics[],
  events: FallbackEventForMetrics[]
): FallbackMetricsData {
  const totalCalls = calls.length;
  
  // Count fallbacks from calls data (fallbackTriggered field)
  const callsWithFallback = calls.filter((c) => c.fallbackTriggered === true);
  
  // If we have events, use them for more detailed metrics
  // Otherwise, derive from calls data
  const totalFallbacks = events.length > 0 ? events.length : callsWithFallback.length;
  const successfulFallbacks = events.length > 0
    ? events.filter((e) => e.success).length
    : callsWithFallback.length; // Assume success if no event data
  const failedFallbacks = totalFallbacks - successfulFallbacks;

  // Calculate fallback rate
  const fallbackRate = totalCalls > 0 ? totalFallbacks / totalCalls : 0;

  // Channel breakdown from events
  const whatsappEvents = events.filter((e) => e.selectedChannel === 'whatsapp');
  const smsEvents = events.filter((e) => e.selectedChannel === 'sms');

  const byChannel = {
    whatsapp: {
      count: whatsappEvents.length,
      successRate: whatsappEvents.length > 0
        ? whatsappEvents.filter((e) => e.success).length / whatsappEvents.length
        : 0,
    },
    sms: {
      count: smsEvents.length,
      successRate: smsEvents.length > 0
        ? smsEvents.filter((e) => e.success).length / smsEvents.length
        : 0,
    },
  };

  // Average trigger confidence
  let averageTriggerConfidence = 0;
  if (events.length > 0) {
    averageTriggerConfidence = events.reduce((sum, e) => sum + e.originalConfidence, 0) / events.length;
  } else if (callsWithFallback.length > 0) {
    const confidences = callsWithFallback
      .map((c) => c.asrConfidence)
      .filter((c): c is number => c !== undefined);
    if (confidences.length > 0) {
      averageTriggerConfidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
    }
  }

  return {
    totalCalls,
    totalFallbacks,
    successfulFallbacks,
    failedFallbacks,
    fallbackRate,
    byChannel,
    averageTriggerConfidence,
  };
}

/**
 * Calculate metrics for a specific branch
 */
function calculateBranchMetrics(
  branchId: string,
  branchName: string,
  calls: CallDataForMetrics[],
  events: FallbackEventForMetrics[]
): BranchFallbackData {
  const branchCalls = calls.filter((c) => c.branchId === branchId);
  const branchEvents = events.filter((e) => e.branchId === branchId);

  return {
    branchId,
    branchName,
    metrics: calculateMetrics(branchCalls, branchEvents),
  };
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * useFallbackMetrics Hook
 * 
 * Computes fallback metrics from calls and fallback events data.
 * 
 * @param options - Hook options including calls, events, and filters
 * @returns Computed metrics and branch-level breakdown
 * 
 * @requirements 18.5 - Log fallback events with original confidence score and selected fallback channel
 * @requirements 18.6 - Display fallback rate metrics in branch dashboard
 * 
 * @example
 * ```tsx
 * const { metrics, branchMetrics } = useFallbackMetrics({
 *   calls: callsData,
 *   fallbackEvents: eventsData,
 *   branches: branchesData,
 * });
 * 
 * return <FallbackMetrics metrics={metrics} branchMetrics={branchMetrics} />;
 * ```
 */
export function useFallbackMetrics(options: UseFallbackMetricsOptions): UseFallbackMetricsReturn {
  const {
    calls,
    fallbackEvents = [],
    branches = [],
    currentPeriod,
    previousPeriod,
    branchId,
    restaurantId,
  } = options;

  // Get default time periods if not provided
  const defaultPeriods = useMemo(() => getDefaultTimePeriods(), []);
  const activePeriod = currentPeriod || defaultPeriods.current;
  const comparePeriod = previousPeriod || defaultPeriods.previous;

  // Filter data by restaurant/branch if specified
  const filteredCalls = useMemo(() => {
    let result = calls;
    if (restaurantId) {
      result = result.filter((c) => c.restaurantId === restaurantId);
    }
    if (branchId) {
      result = result.filter((c) => c.branchId === branchId);
    }
    return result;
  }, [calls, restaurantId, branchId]);

  const filteredEvents = useMemo(() => {
    let result = fallbackEvents;
    if (restaurantId) {
      result = result.filter((e) => e.restaurantId === restaurantId);
    }
    if (branchId) {
      result = result.filter((e) => e.branchId === branchId);
    }
    return result;
  }, [fallbackEvents, restaurantId, branchId]);

  // Calculate current period metrics
  const currentMetrics = useMemo(() => {
    const periodCalls = filterCallsByPeriod(filteredCalls, activePeriod);
    const periodEvents = filterEventsByPeriod(filteredEvents, activePeriod);
    return calculateMetrics(periodCalls, periodEvents);
  }, [filteredCalls, filteredEvents, activePeriod]);

  // Calculate previous period metrics for comparison
  const previousMetrics = useMemo(() => {
    const periodCalls = filterCallsByPeriod(filteredCalls, comparePeriod);
    const periodEvents = filterEventsByPeriod(filteredEvents, comparePeriod);
    return calculateMetrics(periodCalls, periodEvents);
  }, [filteredCalls, filteredEvents, comparePeriod]);

  // Combine metrics with previous period comparison
  const metrics: FallbackMetricsData = useMemo(() => ({
    ...currentMetrics,
    previousPeriod: {
      fallbackRate: previousMetrics.fallbackRate,
      totalFallbacks: previousMetrics.totalFallbacks,
    },
  }), [currentMetrics, previousMetrics]);

  // Calculate branch-level metrics
  const branchMetrics = useMemo(() => {
    // Get unique branch IDs from calls
    const branchIds = new Set<string>();
    filteredCalls.forEach((call) => {
      if (call.branchId) {
        branchIds.add(call.branchId);
      }
    });

    // Calculate metrics for each branch
    const periodCalls = filterCallsByPeriod(filteredCalls, activePeriod);
    const periodEvents = filterEventsByPeriod(filteredEvents, activePeriod);

    return Array.from(branchIds).map((id) => {
      const branch = branches.find((b) => b.branchId === id);
      const branchName = branch?.name || `Branch ${id.slice(0, 8)}`;
      return calculateBranchMetrics(id, branchName, periodCalls, periodEvents);
    });
  }, [filteredCalls, filteredEvents, branches, activePeriod]);

  return {
    metrics,
    branchMetrics,
    isLoading: false,
  };
}

export default useFallbackMetrics;
