/**
 * Feature Flags Types
 * 
 * Type definitions for feature flag management during gradual migration.
 * Requirements: 28.5, 28.6
 * 
 * - 28.5: System shall support gradual migration with feature flags
 * - 28.6: System shall maintain backward compatible API endpoints
 */

/**
 * Feature flag names for multi-tenant features
 */
export type FeatureFlagName =
  // Multi-tenancy features
  | 'multi_tenant_enabled'
  | 'branch_support_enabled'
  | 'platform_dashboard_enabled'
  // Payment features
  | 'paystack_enabled'
  | 'flutterwave_enabled'
  | 'cod_enabled'
  // Messaging features
  | 'whatsapp_enabled'
  | 'sms_enabled'
  | 'whatsapp_order_confirmation'
  | 'whatsapp_status_updates'
  // Voice features
  | 'nigerian_english_enabled'
  | 'pidgin_enabled'
  | 'voice_fallback_enabled'
  // Delivery features
  | 'delivery_tracking_enabled'
  | 'rider_api_enabled'
  // Analytics features
  | 'funnel_analytics_enabled'
  | 'agent_performance_dashboard'
  // Advanced features
  | 'upsell_prompts_enabled'
  | 'fraud_detection_enabled'
  | 'multi_location_routing_enabled'
  // Partner API features
  | 'partner_api_enabled'
  | 'webhook_delivery_enabled'
  // Billing features
  | 'self_serve_billing_enabled'
  // Migration features
  | 'legacy_api_mode'
  | 'migration_complete';

/**
 * Scope at which a feature flag can be applied
 */
export type FeatureFlagScope = 'global' | 'platform' | 'restaurant' | 'branch';

/**
 * Feature flag definition
 */
export interface FeatureFlagDefinition {
  name: FeatureFlagName;
  description: string;
  defaultValue: boolean;
  scope: FeatureFlagScope;
  /** Features that must be enabled for this feature to work */
  dependencies?: FeatureFlagName[];
  /** If true, this flag is for internal use only and not shown in UI */
  internal?: boolean;
}

/**
 * Feature flag value stored in database
 */
export interface FeatureFlagValue {
  flagId: string;
  name: FeatureFlagName;
  enabled: boolean;
  scope: FeatureFlagScope;
  /** The ID of the entity this flag applies to (platformId, restaurantId, or branchId) */
  scopeId?: string;
  /** Override reason for audit purposes */
  reason?: string;
  /** Who set this override */
  setBy?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Feature flag check context
 */
export interface FeatureFlagContext {
  platformId?: string;
  restaurantId?: string;
  branchId?: string;
}

/**
 * Result of checking a feature flag
 */
export interface FeatureFlagCheckResult {
  enabled: boolean;
  source: 'default' | 'global' | 'platform' | 'restaurant' | 'branch';
  flagName: FeatureFlagName;
}

/**
 * Batch feature flag check result
 */
export interface FeatureFlagBatchResult {
  flags: Record<FeatureFlagName, FeatureFlagCheckResult>;
}

/**
 * Feature flag update request
 */
export interface FeatureFlagUpdateRequest {
  name: FeatureFlagName;
  enabled: boolean;
  scope: FeatureFlagScope;
  scopeId?: string;
  reason?: string;
  setBy?: string;
}

/**
 * API compatibility mode for backward compatible endpoints
 */
export type APICompatibilityMode = 'legacy' | 'v2' | 'auto';

/**
 * API endpoint configuration for backward compatibility
 */
export interface APIEndpointConfig {
  /** The endpoint path */
  path: string;
  /** Whether this endpoint supports legacy mode */
  supportsLegacy: boolean;
  /** Whether this endpoint supports v2 mode */
  supportsV2: boolean;
  /** Feature flag that controls this endpoint */
  featureFlag?: FeatureFlagName;
  /** Deprecation notice if applicable */
  deprecationNotice?: string;
}

/**
 * Migration phase for gradual rollout
 */
export type MigrationPhase = 
  | 'not_started'
  | 'phase_1_multi_tenancy'
  | 'phase_2_payments_messaging'
  | 'phase_3_localization'
  | 'complete';

/**
 * Migration status with feature flags
 */
export interface MigrationFeatureStatus {
  phase: MigrationPhase;
  enabledFeatures: FeatureFlagName[];
  pendingFeatures: FeatureFlagName[];
  completionPercentage: number;
}
