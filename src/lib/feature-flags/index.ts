/**
 * Feature Flags Module
 * 
 * Exports feature flag utilities for gradual migration.
 * Requirements: 28.5, 28.6
 */

export * from './types';
export * from './FeatureFlagService';
export * from './apiCompatibility';
export {
  FeatureFlagService,
  FEATURE_FLAG_DEFINITIONS,
  API_ENDPOINT_CONFIGS,
} from './FeatureFlagService';
export {
  API_VERSION_HEADER,
  DEPRECATION_HEADER,
  LEGACY_MODE_HEADER,
  getAPIVersionFromRequest,
  getContextFromRequest,
  checkEndpointAvailability,
  createCompatibleResponse,
  createUnavailableEndpointResponse,
  transformForLegacyMode,
  transformFromLegacyMode,
  withFeatureFlag,
  createFeatureFlagMiddleware,
} from './apiCompatibility';
