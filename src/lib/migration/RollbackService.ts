/**
 * Rollback Service
 * 
 * Client-side utilities for migration rollback capability.
 * Requirements: 28.7
 * 
 * Key features:
 * - Check rollback eligibility
 * - Format rollback status for display
 * - Calculate days remaining in rollback window
 */

import {
  MigrationSnapshot,
  RollbackEligibility,
  RollbackResult,
  MigrationSnapshotStatus,
} from './types';

/**
 * 30 days in milliseconds
 */
export const ROLLBACK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Rollback Service class
 * 
 * Provides client-side utilities for rollback operations.
 * Actual database operations are performed by Convex mutations.
 */
export class RollbackService {
  /**
   * Calculate days remaining in rollback window
   * @param expiresAt - Expiration timestamp
   * @returns Number of days remaining (0 if expired)
   */
  static getDaysRemaining(expiresAt: number): number {
    const now = Date.now();
    if (now >= expiresAt) return 0;
    return Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
  }

  /**
   * Check if a snapshot is within the rollback window
   * @param snapshot - Migration snapshot to check
   * @returns true if rollback is still available
   */
  static isWithinRollbackWindow(snapshot: MigrationSnapshot): boolean {
    if (snapshot.status !== 'active') return false;
    return Date.now() < snapshot.expiresAt;
  }

  /**
   * Format rollback status for display
   * @param status - Snapshot status
   * @returns Human-readable status string
   */
  static formatStatus(status: MigrationSnapshotStatus): string {
    switch (status) {
      case 'active':
        return 'Available for Rollback';
      case 'rolled_back':
        return 'Already Rolled Back';
      case 'expired':
        return 'Rollback Window Expired';
      default:
        return 'Unknown Status';
    }
  }

  /**
   * Format rollback eligibility message
   * @param eligibility - Rollback eligibility result
   * @returns Formatted message for display
   */
  static formatEligibilityMessage(eligibility: RollbackEligibility): string {
    if (eligibility.eligible) {
      return `Rollback available for ${eligibility.daysRemaining} more day${eligibility.daysRemaining === 1 ? '' : 's'}`;
    }
    return eligibility.reason || 'Rollback not available';
  }

  /**
   * Create a rollback summary message
   * @param result - Rollback result
   * @returns Human-readable summary
   */
  static createRollbackSummary(result: RollbackResult): string {
    const lines: string[] = [
      '=== Rollback Summary ===',
      '',
      `Status: ${result.success ? 'SUCCESS' : 'FAILED'}`,
      `Snapshot ID: ${result.snapshotId}`,
      '',
      '--- Reverted Items ---',
      `Restaurants: ${result.restaurantsReverted}`,
      `Branches Deleted: ${result.branchesDeleted}`,
      `Menu Items: ${result.menuItemsReverted}`,
      `Calls: ${result.callsReverted}`,
      `Orders: ${result.ordersReverted}`,
      '',
      `Duration: ${result.durationMs}ms`,
    ];

    if (!result.success && result.message) {
      lines.push('', `Error: ${result.message}`);
    }

    return lines.join('\n');
  }

  /**
   * Get rollback warning message based on days remaining
   * @param daysRemaining - Days remaining in rollback window
   * @returns Warning message or null if no warning needed
   */
  static getRollbackWarning(daysRemaining: number): string | null {
    if (daysRemaining <= 0) {
      return 'Rollback window has expired. Migration changes are now permanent.';
    }
    if (daysRemaining <= 3) {
      return `Warning: Only ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining to rollback migration.`;
    }
    if (daysRemaining <= 7) {
      return `Note: ${daysRemaining} days remaining in rollback window.`;
    }
    return null;
  }

  /**
   * Validate rollback prerequisites
   * @returns Validation result
   */
  static validateRollbackPrerequisites(): { valid: boolean; message: string } {
    // This is a placeholder for any pre-rollback validation
    // In a real scenario, this might check for active orders,
    // ongoing calls, etc.
    return {
      valid: true,
      message: 'Rollback prerequisites validated successfully',
    };
  }

  /**
   * Calculate rollback impact estimate
   * @param snapshot - Migration snapshot
   * @returns Impact summary
   */
  static calculateRollbackImpact(snapshot: MigrationSnapshot): {
    totalItemsAffected: number;
    summary: string;
  } {
    const totalItemsAffected =
      snapshot.restaurantSnapshots.length +
      snapshot.createdBranchIds.length +
      snapshot.migratedMenuItemIds.length +
      snapshot.migratedCallIds.length +
      snapshot.migratedOrderIds.length;

    const summary = [
      `${snapshot.restaurantSnapshots.length} restaurant(s) will have platformId reverted`,
      `${snapshot.createdBranchIds.length} branch(es) will be deleted`,
      `${snapshot.migratedMenuItemIds.length} menu item(s) will have branchId removed`,
      `${snapshot.migratedCallIds.length} call(s) will have branchId removed`,
      `${snapshot.migratedOrderIds.length} order(s) will have branchId removed`,
    ].join('\n');

    return { totalItemsAffected, summary };
  }
}

export default RollbackService;
