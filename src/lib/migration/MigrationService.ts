/**
 * Migration Service
 * 
 * Provides utilities for migrating existing data to the new multi-tenant structure.
 * Requirements: 28.1, 28.2
 * 
 * Key features:
 * - Creates a default platform if none exists
 * - Assigns existing restaurants without platformId to the default platform
 * - Creates a default branch for restaurants without branches
 * - All operations are idempotent (can be run multiple times safely)
 */

import {
  MigrationResult,
  CreateDefaultPlatformResult,
  AssignRestaurantsToPlatformResult,
  CreateDefaultBranchesResult,
  FullMigrationResult,
  DefaultPlatformConfig,
  DefaultBranchConfig,
  RestaurantForMigration,
  BranchForMigration,
} from './types';

/**
 * Default platform configuration
 */
export const DEFAULT_PLATFORM_CONFIG: DefaultPlatformConfig = {
  name: 'Default Platform',
  settings: {
    defaultLanguage: 'english',
    enabledPaymentMethods: ['paystack', 'flutterwave', 'cod'],
    whatsappEnabled: true,
    smsEnabled: true,
  },
};

/**
 * Default platform ID constant
 * Used to identify the default platform across the system
 */
export const DEFAULT_PLATFORM_ID = 'DEFAULT';

/**
 * Default branch configuration
 */
export const DEFAULT_BRANCH_CONFIG: DefaultBranchConfig = {
  nameTemplate: '{restaurantName} - Main Branch',
  defaultAddress: 'Address to be updated',
  defaultPhoneNumber: 'Phone to be updated',
  defaultOperatingHours: {
    monday: { open: '09:00', close: '21:00' },
    tuesday: { open: '09:00', close: '21:00' },
    wednesday: { open: '09:00', close: '21:00' },
    thursday: { open: '09:00', close: '21:00' },
    friday: { open: '09:00', close: '21:00' },
    saturday: { open: '09:00', close: '21:00' },
    sunday: undefined, // Closed on Sunday by default
  },
  isActive: true,
};

/**
 * Migration Service class
 * 
 * This class provides static utility methods for migration operations.
 * The actual database operations are performed by Convex mutations.
 * This service provides the business logic and configuration.
 */
export class MigrationService {
  /**
   * Get the default platform configuration
   */
  static getDefaultPlatformConfig(): DefaultPlatformConfig {
    return { ...DEFAULT_PLATFORM_CONFIG };
  }

  /**
   * Get the default branch configuration
   */
  static getDefaultBranchConfig(): DefaultBranchConfig {
    return { ...DEFAULT_BRANCH_CONFIG };
  }

  /**
   * Generate a default branch name for a restaurant
   * @param restaurantName - The name of the restaurant
   * @returns The generated branch name
   */
  static generateDefaultBranchName(restaurantName: string): string {
    return DEFAULT_BRANCH_CONFIG.nameTemplate.replace('{restaurantName}', restaurantName);
  }

  /**
   * Check if a restaurant needs platform assignment
   * @param restaurant - The restaurant to check
   * @returns true if the restaurant needs a platform assignment
   */
  static needsPlatformAssignment(restaurant: RestaurantForMigration): boolean {
    return !restaurant.platformId || restaurant.platformId.trim() === '';
  }

  /**
   * Check if a restaurant needs a default branch
   * @param restaurant - The restaurant to check
   * @param existingBranches - List of existing branches for the restaurant
   * @returns true if the restaurant needs a default branch
   */
  static needsDefaultBranch(
    restaurant: RestaurantForMigration,
    existingBranches: BranchForMigration[]
  ): boolean {
    // Restaurant needs a default branch if:
    // 1. branchCount is 0 or undefined
    // 2. No branches exist in the branches table for this restaurant
    const hasBranchCount = restaurant.branchCount && restaurant.branchCount > 0;
    const hasExistingBranches = existingBranches.length > 0;
    
    return !hasBranchCount && !hasExistingBranches;
  }

  /**
   * Filter restaurants that need platform assignment
   * @param restaurants - List of restaurants to filter
   * @returns Restaurants that need platform assignment
   */
  static filterRestaurantsNeedingPlatform(
    restaurants: RestaurantForMigration[]
  ): RestaurantForMigration[] {
    return restaurants.filter((r) => this.needsPlatformAssignment(r));
  }

  /**
   * Filter restaurants that need default branches
   * @param restaurants - List of restaurants to check
   * @param branchesByRestaurant - Map of restaurantId to branches
   * @returns Restaurants that need default branches
   */
  static filterRestaurantsNeedingBranches(
    restaurants: RestaurantForMigration[],
    branchesByRestaurant: Map<string, BranchForMigration[]>
  ): RestaurantForMigration[] {
    return restaurants.filter((r) => {
      const branches = branchesByRestaurant.get(r.restaurantId) || [];
      return this.needsDefaultBranch(r, branches);
    });
  }

  /**
   * Create a migration summary message
   * @param result - The full migration result
   * @returns A human-readable summary message
   */
  static createMigrationSummary(result: FullMigrationResult): string {
    const lines: string[] = [
      '=== Migration Summary ===',
      '',
      `Status: ${result.success ? 'SUCCESS' : 'FAILED'}`,
      '',
      '--- Platform ---',
      `Platform ID: ${result.platformResult.platformId || 'N/A'}`,
      `New Platform Created: ${result.platformResult.isNew ? 'Yes' : 'No (already existed)'}`,
      '',
      '--- Restaurant Assignment ---',
      `Assigned to Platform: ${result.restaurantAssignmentResult.assignedCount}`,
      `Already Had Platform: ${result.restaurantAssignmentResult.skippedCount}`,
      `Failed: ${result.restaurantAssignmentResult.failedCount}`,
      '',
      '--- Branch Creation ---',
      `Branches Created: ${result.branchCreationResult.createdCount}`,
      `Already Had Branches: ${result.branchCreationResult.skippedCount}`,
      `Failed: ${result.branchCreationResult.failedCount}`,
      '',
      '--- Totals ---',
      `Total Restaurants Processed: ${result.totalRestaurantsProcessed}`,
      `Total Branches Created: ${result.totalBranchesCreated}`,
    ];

    if (!result.success && result.message) {
      lines.push('', `Error: ${result.message}`);
    }

    return lines.join('\n');
  }

  /**
   * Validate migration prerequisites
   * @returns Validation result with any issues found
   */
  static validateMigrationPrerequisites(): MigrationResult {
    // This is a placeholder for any pre-migration validation
    // In a real scenario, this might check database connectivity,
    // schema compatibility, etc.
    return {
      success: true,
      message: 'Migration prerequisites validated successfully',
    };
  }

  /**
   * Create an empty migration result for initialization
   */
  static createEmptyMigrationResult(): FullMigrationResult {
    return {
      success: false,
      message: 'Migration not started',
      platformResult: {
        success: false,
        message: 'Not started',
        isNew: false,
      },
      restaurantAssignmentResult: {
        success: false,
        message: 'Not started',
        assignedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        assignedRestaurantIds: [],
        skippedRestaurantIds: [],
        failedRestaurantIds: [],
      },
      branchCreationResult: {
        success: false,
        message: 'Not started',
        createdCount: 0,
        skippedCount: 0,
        failedCount: 0,
        createdBranches: [],
        skippedRestaurantIds: [],
        failedRestaurantIds: [],
      },
      totalRestaurantsProcessed: 0,
      totalBranchesCreated: 0,
    };
  }

  /**
   * Create a data migration summary message
   * @param result - The data migration result
   * @returns A human-readable summary message
   */
  static createDataMigrationSummary(result: {
    success: boolean;
    message?: string;
    menuItemsResult?: { migratedCount: number; skippedCount: number; failedCount: number };
    callsResult?: { migratedCount: number; skippedCount: number; failedCount: number };
    ordersResult?: { migratedCount: number; skippedCount: number; failedCount: number };
    totalItemsMigrated?: number;
    totalCallsMigrated?: number;
    totalOrdersMigrated?: number;
    durationMs?: number;
  }): string {
    const lines: string[] = [
      '=== Data Migration Summary ===',
      '',
      `Status: ${result.success ? 'SUCCESS' : 'FAILED'}`,
      '',
      '--- Menu Items ---',
      `Migrated: ${result.menuItemsResult?.migratedCount ?? 0}`,
      `Skipped (already had branchId): ${result.menuItemsResult?.skippedCount ?? 0}`,
      `Failed: ${result.menuItemsResult?.failedCount ?? 0}`,
      '',
      '--- Calls ---',
      `Migrated: ${result.callsResult?.migratedCount ?? 0}`,
      `Skipped (already had branchId): ${result.callsResult?.skippedCount ?? 0}`,
      `Failed: ${result.callsResult?.failedCount ?? 0}`,
      '',
      '--- Orders ---',
      `Migrated: ${result.ordersResult?.migratedCount ?? 0}`,
      `Skipped (already had branchId): ${result.ordersResult?.skippedCount ?? 0}`,
      `Failed: ${result.ordersResult?.failedCount ?? 0}`,
      '',
      '--- Totals ---',
      `Total Menu Items Migrated: ${result.totalItemsMigrated ?? 0}`,
      `Total Calls Migrated: ${result.totalCallsMigrated ?? 0}`,
      `Total Orders Migrated: ${result.totalOrdersMigrated ?? 0}`,
    ];

    if (result.durationMs !== undefined) {
      lines.push(`Duration: ${result.durationMs}ms`);
    }

    if (!result.success && result.message) {
      lines.push('', `Error: ${result.message}`);
    }

    return lines.join('\n');
  }

  /**
   * Check if data needs migration based on status
   * @param status - The data migration status
   * @returns true if data migration is needed
   */
  static needsDataMigration(status: {
    menuItemsWithoutBranch: number;
    callsWithoutBranch: number;
    ordersWithoutBranch: number;
  }): boolean {
    return (
      status.menuItemsWithoutBranch > 0 ||
      status.callsWithoutBranch > 0 ||
      status.ordersWithoutBranch > 0
    );
  }
}

export default MigrationService;
