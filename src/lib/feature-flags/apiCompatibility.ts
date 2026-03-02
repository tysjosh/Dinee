/**
 * API Compatibility Utilities
 * 
 * Provides utilities for maintaining backward compatible API endpoints
 * during the gradual migration to multi-tenant architecture.
 * 
 * Requirements: 28.5, 28.6
 * - 28.5: System shall support gradual migration with feature flags
 * - 28.6: System shall maintain backward compatible API endpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  FeatureFlagName,
  FeatureFlagValue,
  FeatureFlagContext,
  APICompatibilityMode,
} from './types';
import { FeatureFlagService, API_ENDPOINT_CONFIGS } from './FeatureFlagService';

/**
 * API version header name
 */
export const API_VERSION_HEADER = 'X-API-Version';

/**
 * Deprecation warning header name
 */
export const DEPRECATION_HEADER = 'X-Deprecation-Warning';

/**
 * Legacy mode header name
 */
export const LEGACY_MODE_HEADER = 'X-Legacy-Mode';

/**
 * Extract API version from request
 */
export function getAPIVersionFromRequest(request: NextRequest): APICompatibilityMode {
  const versionHeader = request.headers.get(API_VERSION_HEADER);
  
  if (versionHeader === 'v2' || versionHeader === '2') {
    return 'v2';
  }
  
  if (versionHeader === 'legacy' || versionHeader === 'v1' || versionHeader === '1') {
    return 'legacy';
  }
  
  return 'auto';
}

/**
 * Extract feature flag context from request
 */
export function getContextFromRequest(request: NextRequest): FeatureFlagContext {
  const platformId = request.headers.get('X-Platform-ID') || undefined;
  const restaurantId = request.headers.get('X-Restaurant-ID') || undefined;
  const branchId = request.headers.get('X-Branch-ID') || undefined;
  
  return {
    platformId,
    restaurantId,
    branchId,
  };
}

/**
 * Check if an endpoint is available based on feature flags and API version
 */
export function checkEndpointAvailability(
  path: string,
  request: NextRequest,
  overrides: FeatureFlagValue[] = []
): {
  available: boolean;
  mode: APICompatibilityMode;
  deprecationWarning?: string;
} {
  const requestedMode = getAPIVersionFromRequest(request);
  const context = getContextFromRequest(request);
  
  // Determine effective mode
  const effectiveMode = requestedMode === 'auto'
    ? FeatureFlagService.getAPICompatibilityMode(context, overrides)
    : requestedMode;
  
  // Check if endpoint is available
  const available = FeatureFlagService.isEndpointAvailable(
    path,
    effectiveMode,
    context,
    overrides
  );
  
  // Check for deprecation warning
  const config = API_ENDPOINT_CONFIGS.find((c) => {
    if (c.path.endsWith('/*')) {
      const basePath = c.path.slice(0, -2);
      return path.startsWith(basePath);
    }
    const pattern = c.path.replace(/:\w+/g, '[^/]+');
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(path);
  });
  
  return {
    available,
    mode: effectiveMode,
    deprecationWarning: config?.deprecationNotice,
  };
}

/**
 * Create a response with appropriate headers for API compatibility
 */
export function createCompatibleResponse<T>(
  data: T,
  mode: APICompatibilityMode,
  deprecationWarning?: string,
  status: number = 200
): NextResponse {
  const response = NextResponse.json(data, { status });
  
  // Add API version header
  response.headers.set(API_VERSION_HEADER, mode === 'legacy' ? 'v1' : 'v2');
  
  // Add legacy mode indicator
  if (mode === 'legacy') {
    response.headers.set(LEGACY_MODE_HEADER, 'true');
  }
  
  // Add deprecation warning if applicable
  if (deprecationWarning) {
    response.headers.set(DEPRECATION_HEADER, deprecationWarning);
  }
  
  return response;
}

/**
 * Create an error response for unavailable endpoints
 */
export function createUnavailableEndpointResponse(
  path: string,
  mode: APICompatibilityMode,
  featureFlag?: FeatureFlagName
): NextResponse {
  const message = featureFlag
    ? `This endpoint requires the '${featureFlag}' feature to be enabled`
    : mode === 'legacy'
      ? 'This endpoint is not available in legacy API mode'
      : 'This endpoint is not available';
  
  return NextResponse.json(
    {
      error: 'Not Found',
      message,
      code: 'ENDPOINT_UNAVAILABLE',
    },
    { status: 404 }
  );
}

/**
 * Transform response data for legacy API compatibility
 * 
 * This function transforms v2 response data to legacy format
 * when operating in legacy mode.
 */
export function transformForLegacyMode<T extends Record<string, unknown>>(
  data: T,
  entityType: 'restaurant' | 'order' | 'call' | 'menu_item'
): T {
  // Create a copy to avoid mutating the original
  const transformed = { ...data };
  
  switch (entityType) {
    case 'restaurant':
      // Remove multi-tenant fields in legacy mode
      delete transformed.platformId;
      delete transformed.branchCount;
      break;
      
    case 'order':
      // Remove new fields in legacy mode
      delete transformed.branchId;
      delete transformed.paymentMethod;
      delete transformed.paymentStatus;
      delete transformed.paymentReference;
      delete transformed.paymentTimestamp;
      delete transformed.deliveryStatus;
      delete transformed.riderId;
      delete transformed.riderName;
      delete transformed.dispatchedAt;
      delete transformed.deliveredAt;
      delete transformed.deliveryFailureReason;
      delete transformed.whatsappOptIn;
      delete transformed.whatsappMessageIds;
      delete transformed.routingDecision;
      break;
      
    case 'call':
      // Remove new fields in legacy mode
      delete transformed.branchId;
      delete transformed.callEndTime;
      delete transformed.duration;
      delete transformed.asrConfidence;
      delete transformed.languageDetected;
      delete transformed.fallbackTriggered;
      break;
      
    case 'menu_item':
      // Remove new fields in legacy mode
      delete transformed.branchId;
      delete transformed.priceNumeric;
      delete transformed.category;
      delete transformed.modifiers;
      delete transformed.isAvailable;
      break;
  }
  
  return transformed;
}

/**
 * Transform request data from legacy format to v2 format
 * 
 * This function transforms legacy request data to v2 format
 * when operating in legacy mode.
 */
export function transformFromLegacyMode<T extends Record<string, unknown>>(
  data: T,
  entityType: 'restaurant' | 'order' | 'call' | 'menu_item',
  context: FeatureFlagContext
): T {
  // Create a copy to avoid mutating the original
  const transformed = { ...data } as Record<string, unknown>;
  
  switch (entityType) {
    case 'restaurant':
      // Add default platformId if not present
      if (!transformed.platformId && context.platformId) {
        transformed.platformId = context.platformId;
      }
      break;
      
    case 'order':
      // Add branchId from context if not present
      if (!transformed.branchId && context.branchId) {
        transformed.branchId = context.branchId;
      }
      break;
      
    case 'call':
      // Add branchId from context if not present
      if (!transformed.branchId && context.branchId) {
        transformed.branchId = context.branchId;
      }
      break;
      
    case 'menu_item':
      // Add branchId from context if not present
      if (!transformed.branchId && context.branchId) {
        transformed.branchId = context.branchId;
      }
      break;
  }
  
  return transformed as T;
}

/**
 * Middleware helper for feature flag checking
 * 
 * Use this in API routes to check feature flags before processing requests.
 */
export async function withFeatureFlag(
  request: NextRequest,
  flagName: FeatureFlagName,
  overrides: FeatureFlagValue[],
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const context = getContextFromRequest(request);
  const result = FeatureFlagService.isEnabled(flagName, context, overrides);
  
  if (!result.enabled) {
    return NextResponse.json(
      {
        error: 'Feature Not Available',
        message: `The '${flagName}' feature is not enabled for this context`,
        code: 'FEATURE_DISABLED',
      },
      { status: 403 }
    );
  }
  
  return handler();
}

/**
 * Create a feature flag middleware for Next.js API routes
 */
export function createFeatureFlagMiddleware(
  requiredFlags: FeatureFlagName[],
  getOverrides: () => Promise<FeatureFlagValue[]>
) {
  return async function middleware(
    request: NextRequest,
    handler: () => Promise<NextResponse>
  ): Promise<NextResponse> {
    const context = getContextFromRequest(request);
    const overrides = await getOverrides();
    
    // Check all required flags
    for (const flagName of requiredFlags) {
      const result = FeatureFlagService.isEnabled(flagName, context, overrides);
      
      if (!result.enabled) {
        return NextResponse.json(
          {
            error: 'Feature Not Available',
            message: `The '${flagName}' feature is not enabled`,
            code: 'FEATURE_DISABLED',
          },
          { status: 403 }
        );
      }
    }
    
    return handler();
  };
}
