/**
 * Migration Types
 * 
 * Type definitions for backward compatibility migration utilities.
 * Requirements: 28.1, 28.2
 */

/**
 * Result of a migration operation
 */
export interface MigrationResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Result of creating a default platform
 */
export interface CreateDefaultPlatformResult extends MigrationResult {
  platformId?: string;
  isNew: boolean;
}

/**
 * Result of assigning restaurants to a platform
 */
export interface AssignRestaurantsToPlatformResult extends MigrationResult {
  assignedCount: number;
  skippedCount: number;
  failedCount: number;
  assignedRestaurantIds: string[];
  skippedRestaurantIds: string[];
  failedRestaurantIds: string[];
}

/**
 * Result of creating default branches for restaurants
 */
export interface CreateDefaultBranchesResult extends MigrationResult {
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  createdBranches: Array<{
    restaurantId: string;
    branchId: string;
  }>;
  skippedRestaurantIds: string[];
  failedRestaurantIds: string[];
}

/**
 * Result of a full migration run
 */
export interface FullMigrationResult extends MigrationResult {
  platformResult: CreateDefaultPlatformResult;
  restaurantAssignmentResult: AssignRestaurantsToPlatformResult;
  branchCreationResult: CreateDefaultBranchesResult;
  totalRestaurantsProcessed: number;
  totalBranchesCreated: number;
}

/**
 * Migration status for tracking progress
 */
export interface MigrationStatus {
  status: 'not_started' | 'in_progress' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: FullMigrationResult;
}

/**
 * Default platform configuration
 */
export interface DefaultPlatformConfig {
  name: string;
  settings: {
    defaultLanguage: 'english' | 'nigerian_english' | 'pidgin' | 'spanish' | 'french';
    enabledPaymentMethods: ('paystack' | 'flutterwave' | 'cod')[];
    whatsappEnabled: boolean;
    smsEnabled: boolean;
  };
}

/**
 * Default branch configuration
 */
export interface DefaultBranchConfig {
  nameTemplate: string; // e.g., "{restaurantName} - Main Branch"
  defaultAddress: string;
  defaultPhoneNumber: string;
  defaultOperatingHours: {
    monday?: { open: string; close: string };
    tuesday?: { open: string; close: string };
    wednesday?: { open: string; close: string };
    thursday?: { open: string; close: string };
    friday?: { open: string; close: string };
    saturday?: { open: string; close: string };
    sunday?: { open: string; close: string };
  };
  isActive: boolean;
}

/**
 * Restaurant data for migration
 */
export interface RestaurantForMigration {
  restaurantId: string;
  name: string;
  platformId?: string;
  branchCount?: number;
}

/**
 * Branch data for migration
 */
export interface BranchForMigration {
  branchId: string;
  restaurantId: string;
  name: string;
  isActive: boolean;
}

/**
 * Result of migrating menu items to include branchId
 * Requirements: 28.3, 28.4
 */
export interface MigrateMenuItemsResult extends MigrationResult {
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  migratedItemIds: string[];
  skippedItemIds: string[];
  failedItemIds: string[];
}

/**
 * Result of migrating calls to include branchId
 * Requirements: 28.3, 28.4
 */
export interface MigrateCallsResult extends MigrationResult {
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  migratedCallIds: string[];
  skippedCallIds: string[];
  failedCallIds: string[];
}

/**
 * Result of migrating orders to include branchId
 * Requirements: 28.3, 28.4
 */
export interface MigrateOrdersResult extends MigrationResult {
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  migratedOrderIds: string[];
  skippedOrderIds: string[];
  failedOrderIds: string[];
}

/**
 * Result of a full data migration run
 * Requirements: 28.3, 28.4
 */
export interface FullDataMigrationResult extends MigrationResult {
  menuItemsResult: MigrateMenuItemsResult;
  callsResult: MigrateCallsResult;
  ordersResult: MigrateOrdersResult;
  totalItemsMigrated: number;
  totalCallsMigrated: number;
  totalOrdersMigrated: number;
  durationMs: number;
}

/**
 * Data migration status for tracking progress
 * Requirements: 28.3, 28.4
 */
export interface DataMigrationStatus {
  menuItemsWithBranch: number;
  menuItemsWithoutBranch: number;
  callsWithBranch: number;
  callsWithoutBranch: number;
  ordersWithBranch: number;
  ordersWithoutBranch: number;
  needsMigration: boolean;
  migrationComplete: boolean;
}

/**
 * ============================================================================
 * ROLLBACK TYPES
 * Requirements: 28.7
 * ============================================================================
 */

/**
 * Migration snapshot type
 */
export type MigrationSnapshotType = 'structure' | 'data' | 'complete';

/**
 * Migration snapshot status
 */
export type MigrationSnapshotStatus = 'active' | 'rolled_back' | 'expired';

/**
 * Restaurant snapshot for rollback
 */
export interface RestaurantSnapshot {
  restaurantId: string;
  originalPlatformId?: string;
  originalBranchCount?: number;
}

/**
 * Migration snapshot for rollback capability
 * Requirements: 28.7
 */
export interface MigrationSnapshot {
  snapshotId: string;
  migrationType: MigrationSnapshotType;
  restaurantSnapshots: RestaurantSnapshot[];
  createdBranchIds: string[];
  migratedMenuItemIds: string[];
  migratedCallIds: string[];
  migratedOrderIds: string[];
  status: MigrationSnapshotStatus;
  createdAt: number;
  expiresAt: number;
  rolledBackAt?: number;
  rolledBackBy?: string;
}

/**
 * Result of creating a migration snapshot
 */
export interface CreateSnapshotResult extends MigrationResult {
  snapshotId?: string;
  expiresAt?: number;
}

/**
 * Result of a rollback operation
 */
export interface RollbackResult extends MigrationResult {
  snapshotId: string;
  restaurantsReverted: number;
  branchesDeleted: number;
  menuItemsReverted: number;
  callsReverted: number;
  ordersReverted: number;
  durationMs: number;
}

/**
 * Rollback eligibility check result
 */
export interface RollbackEligibility {
  eligible: boolean;
  reason?: string;
  snapshot?: MigrationSnapshot;
  daysRemaining?: number;
}

/**
 * ============================================================================
 * NOTIFICATION TYPES
 * Requirements: 28.8
 * ============================================================================
 */

/**
 * Notification scope
 */
export type NotificationScope = 'global' | 'platform' | 'restaurant' | 'branch';

/**
 * Notification type
 */
export type NotificationType = 'new_feature' | 'migration' | 'deprecation' | 'update';

/**
 * Notification priority
 */
export type NotificationPriority = 'low' | 'medium' | 'high';

/**
 * Feature notification for user announcements
 * Requirements: 28.8
 */
export interface FeatureNotification {
  notificationId: string;
  scope: NotificationScope;
  scopeId?: string;
  title: string;
  message: string;
  featureName: string;
  type: NotificationType;
  priority: NotificationPriority;
  dismissible: boolean;
  actionUrl?: string;
  actionLabel?: string;
  isActive: boolean;
  startsAt: number;
  expiresAt?: number;
  createdAt: number;
}

/**
 * Result of creating a notification
 */
export interface CreateNotificationResult extends MigrationResult {
  notificationId?: string;
}

/**
 * User notification dismissal
 */
export interface NotificationDismissal {
  notificationId: string;
  userId: string;
  dismissedAt: number;
}

/**
 * Active notifications for a user
 */
export interface UserNotifications {
  notifications: FeatureNotification[];
  dismissedIds: string[];
}
