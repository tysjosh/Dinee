/**
 * Call Blocking Service Implementation
 * 
 * Provides call blocking functionality for the fraud detection system.
 * Determines whether incoming calls should be blocked, require verification,
 * or be allowed based on fraud signals and blocklist status.
 * 
 * @module fraud/CallBlockingService
 * @see Requirements: 25.4
 */

import type { FraudSignal, FraudSignalType } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Action to take for an incoming call
 */
export type CallBlockingAction = 'allow' | 'block' | 'require_verification';

/**
 * Result of checking if a call should be blocked
 */
export interface CallBlockingResult {
  /** The action to take for this call */
  action: CallBlockingAction;
  /** Whether the phone number is on the blocklist */
  isBlocked: boolean;
  /** Whether the phone number has active fraud signals */
  hasActiveSignals: boolean;
  /** Reason for the blocking decision */
  reason: string;
  /** Fraud signals associated with this phone number */
  signals: FraudSignalSummary[];
}

/**
 * Summary of a fraud signal for blocking decisions
 */
export interface FraudSignalSummary {
  signalType: FraudSignalType;
  signalCount: number;
  lastOccurrence: number;
  disposition?: string;
}

/**
 * Configuration for call blocking thresholds
 */
export interface CallBlockingConfig {
  /**
   * Minimum signal count to require verification (not blocked but flagged)
   * @default 2
   */
  verificationThreshold: number;
  
  /**
   * Time window in milliseconds for considering signals as "active"
   * Signals older than this are considered stale
   * @default 604800000 (7 days)
   */
  signalActiveWindowMs: number;
}

/**
 * Default configuration for call blocking
 */
export const DEFAULT_CALL_BLOCKING_CONFIG: CallBlockingConfig = {
  verificationThreshold: 2,
  signalActiveWindowMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// ============================================================================
// CallBlockingService Interface
// ============================================================================

/**
 * Interface for call blocking service
 * 
 * @see Requirements: 25.4
 */
export interface CallBlockingService {
  /**
   * Check if a call from a phone number should be blocked
   * 
   * @param phoneNumber - The phone number to check
   * @param signals - Fraud signals for the phone number
   * @returns Result indicating whether to block, require verification, or allow
   */
  shouldBlockCall(phoneNumber: string, signals: FraudSignal[]): CallBlockingResult;
  
  /**
   * Get the blocking action for a phone number
   * 
   * @param phoneNumber - The phone number to check
   * @param signals - Fraud signals for the phone number
   * @returns The action to take: 'allow', 'block', or 'require_verification'
   */
  getBlockingAction(phoneNumber: string, signals: FraudSignal[]): CallBlockingAction;
  
  /**
   * Update the blocking configuration
   * 
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<CallBlockingConfig>): void;
  
  /**
   * Get the current blocking configuration
   * 
   * @returns Current configuration
   */
  getConfig(): CallBlockingConfig;
}

// ============================================================================
// CallBlockingServiceImpl Class
// ============================================================================

/**
 * Implementation of the CallBlockingService interface
 * 
 * Determines call blocking decisions based on:
 * 1. Blocklist status - immediately block if phone is on blocklist
 * 2. Active fraud signals - require verification if signals exceed threshold
 * 3. Signal recency - only consider signals within the active window
 * 
 * @example
 * ```typescript
 * const service = new CallBlockingServiceImpl();
 * 
 * // Check if a call should be blocked
 * const result = service.shouldBlockCall('+2348012345678', signals);
 * 
 * switch (result.action) {
 *   case 'block':
 *     // Reject the call
 *     break;
 *   case 'require_verification':
 *     // Transfer to human agent for verification
 *     break;
 *   case 'allow':
 *     // Process the call normally
 *     break;
 * }
 * ```
 * 
 * @see Requirements: 25.4
 */
export class CallBlockingServiceImpl implements CallBlockingService {
  private config: CallBlockingConfig;

  /**
   * Create a new CallBlockingServiceImpl instance
   * 
   * @param config - Optional custom configuration
   */
  constructor(config?: Partial<CallBlockingConfig>) {
    this.config = {
      ...DEFAULT_CALL_BLOCKING_CONFIG,
      ...config,
    };
  }

  /**
   * Check if a call from a phone number should be blocked
   * 
   * Decision logic:
   * 1. If any signal has isBlocked=true → block
   * 2. If active signals exceed verification threshold → require_verification
   * 3. Otherwise → allow
   * 
   * @param phoneNumber - The phone number to check
   * @param signals - Fraud signals for the phone number
   * @returns Result with action, reason, and signal details
   * 
   * @see Requirements: 25.4
   */
  shouldBlockCall(phoneNumber: string, signals: FraudSignal[]): CallBlockingResult {
    const now = Date.now();
    const activeWindowStart = now - this.config.signalActiveWindowMs;

    // Check if phone is on blocklist
    const isBlocked = signals.some(signal => signal.isBlocked);

    // Filter for active signals (within the time window)
    const activeSignals = signals.filter(
      signal => signal.lastOccurrence >= activeWindowStart
    );

    // Calculate total active signal count
    const totalActiveSignalCount = activeSignals.reduce(
      (sum, signal) => sum + signal.signalCount,
      0
    );

    // Build signal summaries
    const signalSummaries: FraudSignalSummary[] = signals.map(signal => ({
      signalType: signal.signalType,
      signalCount: signal.signalCount,
      lastOccurrence: signal.lastOccurrence,
      disposition: signal.disposition,
    }));

    // Determine action based on blocking rules
    let action: CallBlockingAction;
    let reason: string;

    if (isBlocked) {
      // Rule 1: Blocklisted numbers are immediately blocked
      action = 'block';
      reason = `Phone number ${phoneNumber} is on the blocklist due to confirmed fraud`;
    } else if (totalActiveSignalCount >= this.config.verificationThreshold) {
      // Rule 2: Numbers with active signals require verification
      action = 'require_verification';
      reason = `Phone number ${phoneNumber} has ${totalActiveSignalCount} active fraud signal(s) within the last ${this.formatDuration(this.config.signalActiveWindowMs)}`;
    } else if (activeSignals.length > 0) {
      // Rule 3: Numbers with some signals but below threshold - allow with monitoring
      action = 'allow';
      reason = `Phone number ${phoneNumber} has ${totalActiveSignalCount} active fraud signal(s), below verification threshold of ${this.config.verificationThreshold}`;
    } else {
      // Rule 4: Clean numbers are allowed
      action = 'allow';
      reason = `Phone number ${phoneNumber} has no active fraud signals`;
    }

    return {
      action,
      isBlocked,
      hasActiveSignals: activeSignals.length > 0,
      reason,
      signals: signalSummaries,
    };
  }

  /**
   * Get the blocking action for a phone number
   * 
   * Convenience method that returns just the action without full details.
   * 
   * @param phoneNumber - The phone number to check
   * @param signals - Fraud signals for the phone number
   * @returns The action to take
   * 
   * @see Requirements: 25.4
   */
  getBlockingAction(phoneNumber: string, signals: FraudSignal[]): CallBlockingAction {
    return this.shouldBlockCall(phoneNumber, signals).action;
  }

  /**
   * Update the blocking configuration
   * 
   * @param config - Partial configuration to update
   */
  updateConfig(config: Partial<CallBlockingConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Get the current blocking configuration
   * 
   * @returns Current configuration
   */
  getConfig(): CallBlockingConfig {
    return { ...this.config };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Format duration in milliseconds to human-readable string
   * 
   * @param ms - Duration in milliseconds
   * @returns Human-readable duration string
   */
  private formatDuration(ms: number): string {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

    if (days > 0 && hours > 0) {
      return `${days} day${days > 1 ? 's' : ''} ${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      const minutes = Math.floor(ms / (60 * 1000));
      return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new CallBlockingService instance
 * 
 * @param config - Optional custom configuration
 * @returns A new CallBlockingServiceImpl instance
 * 
 * @example
 * ```typescript
 * // With default configuration
 * const service = createCallBlockingService();
 * 
 * // With custom configuration
 * const service = createCallBlockingService({
 *   verificationThreshold: 3,
 *   signalActiveWindowMs: 14 * 24 * 60 * 60 * 1000, // 14 days
 * });
 * ```
 */
export function createCallBlockingService(
  config?: Partial<CallBlockingConfig>
): CallBlockingServiceImpl {
  return new CallBlockingServiceImpl(config);
}

// ============================================================================
// Default Export
// ============================================================================

export default CallBlockingServiceImpl;
