/**
 * Feature Flag Service
 * 
 * Provides feature flag management for gradual migration of multi-tenant features.
 * Requirements: 28.5, 28.6
 * 
 * Key features:
 * - Feature flag definitions for all multi-tenant features
 * - Hierarchical flag resolution (global → platform → restaurant → branch)
 * - Support for per-restaurant/per-platform feature flags
 * - Backward compatible API endpoint handling
 */

import {
  FeatureFlagName,
  FeatureFlagDefinition,
  FeatureFlagValue,
  FeatureFlagContext,
  FeatureFlagCheckResult,
  FeatureFlagBatchResult,
  FeatureFlagScope,
  APICompatibilityMode,
  APIEndpointConfig,
  MigrationPhase,
  MigrationFeatureStatus,
} from './types';

/**
 * Feature flag definitions
 * 
 * These define all available feature flags with their default values,
 * scopes, and dependencies.
 */
export const FEATURE_FLAG_DEFINITIONS: Record<FeatureFlagName, FeatureFlagDefinition> = {
  // Multi-tenancy features
  multi_tenant_enabled: {
    name: 'multi_tenant_enabled',
    description: 'Enable multi-tenant architecture with platform/restaurant/branch hierarchy',
    defaultValue: false,
    scope: 'global',
  },
  branch_support_enabled: {
    name: 'branch_support_enabled',
    description: 'Enable branch (multiple locations) support for restaurants',
    defaultValue: false,
    scope: 'restaurant',
    dependencies: ['multi_tenant_enabled'],
  },
  platform_dashboard_enabled: {
    name: 'platform_dashboard_enabled',
    description: 'Enable platform-level dashboard with aggregated metrics',
    defaultValue: false,
    scope: 'platform',
    dependencies: ['multi_tenant_enabled'],
  },

  // Payment features
  paystack_enabled: {
    name: 'paystack_enabled',
    description: 'Enable Paystack payment integration',
    defaultValue: false,
    scope: 'restaurant',
  },
  flutterwave_enabled: {
    name: 'flutterwave_enabled',
    description: 'Enable Flutterwave payment integration',
    defaultValue: false,
    scope: 'restaurant',
  },
  cod_enabled: {
    name: 'cod_enabled',
    description: 'Enable Cash-on-Delivery payment option',
    defaultValue: false,
    scope: 'restaurant',
  },

  // Messaging features
  whatsapp_enabled: {
    name: 'whatsapp_enabled',
    description: 'Enable WhatsApp Business API integration',
    defaultValue: false,
    scope: 'platform',
  },
  sms_enabled: {
    name: 'sms_enabled',
    description: 'Enable SMS messaging as fallback',
    defaultValue: false,
    scope: 'platform',
  },
  whatsapp_order_confirmation: {
    name: 'whatsapp_order_confirmation',
    description: 'Send order confirmations via WhatsApp',
    defaultValue: false,
    scope: 'restaurant',
    dependencies: ['whatsapp_enabled'],
  },
  whatsapp_status_updates: {
    name: 'whatsapp_status_updates',
    description: 'Send order status updates via WhatsApp',
    defaultValue: false,
    scope: 'restaurant',
    dependencies: ['whatsapp_enabled'],
  },

  // Voice features
  nigerian_english_enabled: {
    name: 'nigerian_english_enabled',
    description: 'Enable Nigerian English voice recognition',
    defaultValue: false,
    scope: 'restaurant',
  },
  pidgin_enabled: {
    name: 'pidgin_enabled',
    description: 'Enable Nigerian Pidgin voice recognition',
    defaultValue: false,
    scope: 'restaurant',
  },
  voice_fallback_enabled: {
    name: 'voice_fallback_enabled',
    description: 'Enable fallback to WhatsApp/SMS when voice recognition confidence is low',
    defaultValue: false,
    scope: 'restaurant',
  },

  // Delivery features
  delivery_tracking_enabled: {
    name: 'delivery_tracking_enabled',
    description: 'Enable delivery status tracking',
    defaultValue: false,
    scope: 'restaurant',
  },
  rider_api_enabled: {
    name: 'rider_api_enabled',
    description: 'Enable rider API for delivery status updates',
    defaultValue: false,
    scope: 'restaurant',
    dependencies: ['delivery_tracking_enabled'],
  },

  // Analytics features
  funnel_analytics_enabled: {
    name: 'funnel_analytics_enabled',
    description: 'Enable order funnel analytics',
    defaultValue: false,
    scope: 'platform',
  },
  agent_performance_dashboard: {
    name: 'agent_performance_dashboard',
    description: 'Enable AI agent performance dashboard',
    defaultValue: false,
    scope: 'restaurant',
  },

  // Advanced features
  upsell_prompts_enabled: {
    name: 'upsell_prompts_enabled',
    description: 'Enable upsell/cross-sell prompt library',
    defaultValue: false,
    scope: 'restaurant',
  },
  fraud_detection_enabled: {
    name: 'fraud_detection_enabled',
    description: 'Enable fraud and abuse detection',
    defaultValue: false,
    scope: 'platform',
  },
  multi_location_routing_enabled: {
    name: 'multi_location_routing_enabled',
    description: 'Enable automatic order routing to nearest branch',
    defaultValue: false,
    scope: 'restaurant',
    dependencies: ['branch_support_enabled'],
  },

  // Partner API features
  partner_api_enabled: {
    name: 'partner_api_enabled',
    description: 'Enable Partner REST API',
    defaultValue: false,
    scope: 'platform',
  },
  webhook_delivery_enabled: {
    name: 'webhook_delivery_enabled',
    description: 'Enable webhook delivery for partner integrations',
    defaultValue: false,
    scope: 'platform',
    dependencies: ['partner_api_enabled'],
  },

  // Billing features
  self_serve_billing_enabled: {
    name: 'self_serve_billing_enabled',
    description: 'Enable self-serve onboarding and billing',
    defaultValue: false,
    scope: 'platform',
  },

  // Migration features
  legacy_api_mode: {
    name: 'legacy_api_mode',
    description: 'Enable legacy API compatibility mode for existing integrations',
    defaultValue: true,
    scope: 'global',
    internal: true,
  },
  migration_complete: {
    name: 'migration_complete',
    description: 'Indicates migration to multi-tenant architecture is complete',
    defaultValue: false,
    scope: 'global',
    internal: true,
  },
};

/**
 * API endpoint configurations for backward compatibility
 */
export const API_ENDPOINT_CONFIGS: APIEndpointConfig[] = [
  // Restaurant endpoints
  {
    path: '/api/restaurants',
    supportsLegacy: true,
    supportsV2: true,
    featureFlag: 'multi_tenant_enabled',
  },
  {
    path: '/api/restaurants/:id',
    supportsLegacy: true,
    supportsV2: true,
    featureFlag: 'multi_tenant_enabled',
  },
  // Order endpoints
  {
    path: '/api/orders',
    supportsLegacy: true,
    supportsV2: true,
  },
  {
    path: '/api/orders/:id',
    supportsLegacy: true,
    supportsV2: true,
  },
  // Call endpoints
  {
    path: '/api/calls',
    supportsLegacy: true,
    supportsV2: true,
  },
  // Menu endpoints
  {
    path: '/api/menu',
    supportsLegacy: true,
    supportsV2: true,
    featureFlag: 'branch_support_enabled',
  },
  // Branch endpoints (v2 only)
  {
    path: '/api/branches',
    supportsLegacy: false,
    supportsV2: true,
    featureFlag: 'branch_support_enabled',
  },
  // Platform endpoints (v2 only)
  {
    path: '/api/platforms',
    supportsLegacy: false,
    supportsV2: true,
    featureFlag: 'platform_dashboard_enabled',
  },
  // Payment endpoints
  {
    path: '/api/webhooks/paystack',
    supportsLegacy: false,
    supportsV2: true,
    featureFlag: 'paystack_enabled',
  },
  {
    path: '/api/webhooks/flutterwave',
    supportsLegacy: false,
    supportsV2: true,
    featureFlag: 'flutterwave_enabled',
  },
  // Rider API endpoints
  {
    path: '/api/rider/status',
    supportsLegacy: false,
    supportsV2: true,
    featureFlag: 'rider_api_enabled',
  },
  // Partner API endpoints
  {
    path: '/api/partner/*',
    supportsLegacy: false,
    supportsV2: true,
    featureFlag: 'partner_api_enabled',
  },
];

/**
 * Feature Flag Service
 * 
 * This service provides methods for checking and managing feature flags.
 * The actual database operations are performed by Convex mutations.
 */
export class FeatureFlagService {
  private flagOverrides: Map<string, FeatureFlagValue> = new Map();

  /**
   * Get the definition for a feature flag
   */
  static getDefinition(name: FeatureFlagName): FeatureFlagDefinition {
    return FEATURE_FLAG_DEFINITIONS[name];
  }

  /**
   * Get all feature flag definitions
   */
  static getAllDefinitions(): FeatureFlagDefinition[] {
    return Object.values(FEATURE_FLAG_DEFINITIONS);
  }

  /**
   * Get feature flags by scope
   */
  static getDefinitionsByScope(scope: FeatureFlagScope): FeatureFlagDefinition[] {
    return Object.values(FEATURE_FLAG_DEFINITIONS).filter(
      (def) => def.scope === scope
    );
  }

  /**
   * Get the default value for a feature flag
   */
  static getDefaultValue(name: FeatureFlagName): boolean {
    const definition = FEATURE_FLAG_DEFINITIONS[name];
    return definition?.defaultValue ?? false;
  }

  /**
   * Check if a feature flag is enabled
   * 
   * Resolution order (most specific wins):
   * 1. Branch-level override
   * 2. Restaurant-level override
   * 3. Platform-level override
   * 4. Global override
   * 5. Default value
   * 
   * @param name - The feature flag name
   * @param context - The context for flag resolution
   * @param overrides - Optional array of flag overrides from database
   */
  static isEnabled(
    name: FeatureFlagName,
    context: FeatureFlagContext = {},
    overrides: FeatureFlagValue[] = []
  ): FeatureFlagCheckResult {
    const definition = FEATURE_FLAG_DEFINITIONS[name];
    
    if (!definition) {
      return {
        enabled: false,
        source: 'default',
        flagName: name,
      };
    }

    // Check dependencies first
    if (definition.dependencies) {
      for (const dep of definition.dependencies) {
        const depResult = this.isEnabled(dep, context, overrides);
        if (!depResult.enabled) {
          return {
            enabled: false,
            source: 'default',
            flagName: name,
          };
        }
      }
    }

    // Check for branch-level override
    if (context.branchId) {
      const branchOverride = overrides.find(
        (o) => o.name === name && o.scope === 'branch' && o.scopeId === context.branchId
      );
      if (branchOverride) {
        return {
          enabled: branchOverride.enabled,
          source: 'branch',
          flagName: name,
        };
      }
    }

    // Check for restaurant-level override
    if (context.restaurantId) {
      const restaurantOverride = overrides.find(
        (o) => o.name === name && o.scope === 'restaurant' && o.scopeId === context.restaurantId
      );
      if (restaurantOverride) {
        return {
          enabled: restaurantOverride.enabled,
          source: 'restaurant',
          flagName: name,
        };
      }
    }

    // Check for platform-level override
    if (context.platformId) {
      const platformOverride = overrides.find(
        (o) => o.name === name && o.scope === 'platform' && o.scopeId === context.platformId
      );
      if (platformOverride) {
        return {
          enabled: platformOverride.enabled,
          source: 'platform',
          flagName: name,
        };
      }
    }

    // Check for global override
    const globalOverride = overrides.find(
      (o) => o.name === name && o.scope === 'global'
    );
    if (globalOverride) {
      return {
        enabled: globalOverride.enabled,
        source: 'global',
        flagName: name,
      };
    }

    // Return default value
    return {
      enabled: definition.defaultValue,
      source: 'default',
      flagName: name,
    };
  }

  /**
   * Check multiple feature flags at once
   */
  static checkMultiple(
    names: FeatureFlagName[],
    context: FeatureFlagContext = {},
    overrides: FeatureFlagValue[] = []
  ): FeatureFlagBatchResult {
    const flags: Record<string, FeatureFlagCheckResult> = {};
    
    for (const name of names) {
      flags[name] = this.isEnabled(name, context, overrides);
    }

    return { flags: flags as Record<FeatureFlagName, FeatureFlagCheckResult> };
  }

  /**
   * Get the API compatibility mode based on feature flags
   */
  static getAPICompatibilityMode(
    context: FeatureFlagContext = {},
    overrides: FeatureFlagValue[] = []
  ): APICompatibilityMode {
    const legacyMode = this.isEnabled('legacy_api_mode', context, overrides);
    const migrationComplete = this.isEnabled('migration_complete', context, overrides);

    if (migrationComplete.enabled) {
      return 'v2';
    }

    if (legacyMode.enabled) {
      return 'legacy';
    }

    return 'auto';
  }

  /**
   * Check if an API endpoint is available based on feature flags
   */
  static isEndpointAvailable(
    path: string,
    mode: APICompatibilityMode,
    context: FeatureFlagContext = {},
    overrides: FeatureFlagValue[] = []
  ): boolean {
    // Find matching endpoint config
    const config = API_ENDPOINT_CONFIGS.find((c) => {
      // Handle wildcard paths
      if (c.path.endsWith('/*')) {
        const basePath = c.path.slice(0, -2);
        return path.startsWith(basePath);
      }
      // Handle parameterized paths
      const pattern = c.path.replace(/:\w+/g, '[^/]+');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(path);
    });

    if (!config) {
      // Unknown endpoint - allow by default
      return true;
    }

    // Check mode compatibility
    if (mode === 'legacy' && !config.supportsLegacy) {
      return false;
    }

    if (mode === 'v2' && !config.supportsV2) {
      return false;
    }

    // Check feature flag if specified
    if (config.featureFlag) {
      const flagResult = this.isEnabled(config.featureFlag, context, overrides);
      return flagResult.enabled;
    }

    return true;
  }

  /**
   * Get the current migration phase based on enabled features
   */
  static getMigrationPhase(
    context: FeatureFlagContext = {},
    overrides: FeatureFlagValue[] = []
  ): MigrationPhase {
    const migrationComplete = this.isEnabled('migration_complete', context, overrides);
    if (migrationComplete.enabled) {
      return 'complete';
    }

    // Check Phase 3 features (Localization)
    const phase3Features: FeatureFlagName[] = [
      'nigerian_english_enabled',
      'pidgin_enabled',
      'voice_fallback_enabled',
    ];
    const phase3Enabled = phase3Features.some(
      (f) => this.isEnabled(f, context, overrides).enabled
    );
    if (phase3Enabled) {
      return 'phase_3_localization';
    }

    // Check Phase 2 features (Payments & Messaging)
    const phase2Features: FeatureFlagName[] = [
      'paystack_enabled',
      'flutterwave_enabled',
      'cod_enabled',
      'whatsapp_enabled',
      'delivery_tracking_enabled',
    ];
    const phase2Enabled = phase2Features.some(
      (f) => this.isEnabled(f, context, overrides).enabled
    );
    if (phase2Enabled) {
      return 'phase_2_payments_messaging';
    }

    // Check Phase 1 features (Multi-tenancy)
    const phase1Features: FeatureFlagName[] = [
      'multi_tenant_enabled',
      'branch_support_enabled',
      'platform_dashboard_enabled',
    ];
    const phase1Enabled = phase1Features.some(
      (f) => this.isEnabled(f, context, overrides).enabled
    );
    if (phase1Enabled) {
      return 'phase_1_multi_tenancy';
    }

    return 'not_started';
  }

  /**
   * Get migration feature status
   */
  static getMigrationStatus(
    context: FeatureFlagContext = {},
    overrides: FeatureFlagValue[] = []
  ): MigrationFeatureStatus {
    const allFlags = Object.keys(FEATURE_FLAG_DEFINITIONS) as FeatureFlagName[];
    const enabledFeatures: FeatureFlagName[] = [];
    const pendingFeatures: FeatureFlagName[] = [];

    for (const flag of allFlags) {
      const definition = FEATURE_FLAG_DEFINITIONS[flag];
      // Skip internal flags
      if (definition.internal) continue;

      const result = this.isEnabled(flag, context, overrides);
      if (result.enabled) {
        enabledFeatures.push(flag);
      } else {
        pendingFeatures.push(flag);
      }
    }

    const totalFeatures = enabledFeatures.length + pendingFeatures.length;
    const completionPercentage = totalFeatures > 0
      ? Math.round((enabledFeatures.length / totalFeatures) * 100)
      : 0;

    return {
      phase: this.getMigrationPhase(context, overrides),
      enabledFeatures,
      pendingFeatures,
      completionPercentage,
    };
  }

  /**
   * Generate a unique flag ID
   */
  static generateFlagId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'FF';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Validate a feature flag update request
   */
  static validateUpdateRequest(
    name: FeatureFlagName,
    scope: FeatureFlagScope,
    scopeId?: string
  ): { valid: boolean; error?: string } {
    const definition = FEATURE_FLAG_DEFINITIONS[name];

    if (!definition) {
      return { valid: false, error: `Unknown feature flag: ${name}` };
    }

    // Check if scope is valid for this flag
    const scopeHierarchy: FeatureFlagScope[] = ['global', 'platform', 'restaurant', 'branch'];
    const definitionScopeIndex = scopeHierarchy.indexOf(definition.scope);
    const requestScopeIndex = scopeHierarchy.indexOf(scope);

    // Can only set at the defined scope or more specific
    if (requestScopeIndex < definitionScopeIndex) {
      return {
        valid: false,
        error: `Feature flag ${name} can only be set at ${definition.scope} level or more specific`,
      };
    }

    // Require scopeId for non-global scopes
    if (scope !== 'global' && !scopeId) {
      return {
        valid: false,
        error: `scopeId is required for ${scope} scope`,
      };
    }

    return { valid: true };
  }
}

export default FeatureFlagService;
