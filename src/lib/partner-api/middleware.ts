/**
 * Partner API Middleware
 * 
 * Provides middleware functions for API authentication, rate limiting,
 * and request logging for the Partner API.
 * 
 * @module partner-api/middleware
 * @requirements 21.2 - OAuth 2.0 authentication
 * @requirements 21.3 - API key management
 * @requirements 21.8 - Rate limiting (1000 requests per minute)
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
import {
  extractApiKeyFromHeaders,
  extractClientIp,
  hashApiKey,
  createRequestContext,
} from './auth';
import {
  recordAndCheckRateLimit,
  getRateLimitHeaders,
  createRateLimitResponse,
} from './rate-limiter';
import type { ApiKey, ApiKeyScope, ApiRequestContext, ApiErrorResponse } from './types';
import { internalSecretArg } from '@/lib/internal-auth';
import crypto from 'crypto';

// Re-export authorizeResourceAccess so route handlers can import from middleware
// Tenant authorization is enforced per-route after key+scope validation
export { authorizeResourceAccess } from './authorization';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the API middleware
 */
export interface MiddlewareOptions {
  /** Required scopes for the endpoint */
  requiredScopes?: ApiKeyScope[];
  /** Whether to skip rate limiting */
  skipRateLimit?: boolean;
  /** Whether to skip logging */
  skipLogging?: boolean;
}

/**
 * Result of middleware validation
 */
export interface MiddlewareResult {
  /** Whether validation passed */
  success: boolean;
  /** API request context if successful */
  context?: ApiRequestContext;
  /** Error response if failed */
  errorResponse?: NextResponse<ApiErrorResponse>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the Convex client instance
 */
function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error('NEXT_PUBLIC_CONVEX_URL environment variable is not set');
    return null;
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * Create an error response
 */
function createErrorResponse(
  error: string,
  message: string,
  statusCode: number,
  code?: string
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    { error, message, code },
    { status: statusCode }
  );
}

/**
 * Convert database API key to internal format
 */
function convertDbApiKey(dbKey: {
  keyId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  partnerId: string;
  status: 'active' | 'revoked' | 'expired';
  scopes: string[];
  rateLimitOverride?: number;
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  ipWhitelist?: string[];
}): ApiKey {
  return {
    id: dbKey.keyId,
    keyHash: dbKey.keyHash,
    keyPrefix: dbKey.keyPrefix,
    name: dbKey.name,
    partnerId: dbKey.partnerId,
    status: dbKey.status,
    scopes: dbKey.scopes as ApiKeyScope[],
    rateLimitOverride: dbKey.rateLimitOverride,
    createdAt: dbKey.createdAt,
    lastUsedAt: dbKey.lastUsedAt,
    expiresAt: dbKey.expiresAt,
    ipWhitelist: dbKey.ipWhitelist,
  };
}

// ============================================================================
// Middleware Functions
// ============================================================================

/**
 * Validate API request authentication and rate limiting
 * 
 * @param request - The incoming request
 * @param options - Middleware options
 * @returns Middleware result with context or error response
 * 
 * @requirements 21.2 - OAuth 2.0 authentication
 * @requirements 21.3 - API key management
 * @requirements 21.8 - Rate limiting
 */
export async function validateApiRequest(
  request: NextRequest,
  options: MiddlewareOptions = {}
): Promise<MiddlewareResult> {
  const startTime = Date.now();
  const clientIp = extractClientIp(request.headers);
  
  // Extract API key from headers
  const apiKeyString = extractApiKeyFromHeaders(request.headers);
  
  if (!apiKeyString) {
    return {
      success: false,
      errorResponse: createErrorResponse(
        'Unauthorized',
        'API key is required. Provide it in the Authorization header (Bearer <key>) or X-API-Key header.',
        401,
        'missing_api_key'
      ),
    };
  }
  
  // Get Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    return {
      success: false,
      errorResponse: createErrorResponse(
        'Internal Server Error',
        'Server configuration error',
        500,
        'server_error'
      ),
    };
  }
  
  // Hash the API key and look it up
  const keyHash = hashApiKey(apiKeyString);
  
  let dbApiKey;
  try {
    dbApiKey = await convexClient.query(api.apiKeys.getApiKeyByHash, { keyHash, ...internalSecretArg() });
  } catch (error) {
    console.error('Error fetching API key:', error);
    return {
      success: false,
      errorResponse: createErrorResponse(
        'Internal Server Error',
        'Failed to validate API key',
        500,
        'validation_error'
      ),
    };
  }
  
  if (!dbApiKey) {
    return {
      success: false,
      errorResponse: createErrorResponse(
        'Unauthorized',
        'Invalid API key',
        401,
        'invalid_api_key'
      ),
    };
  }
  
  const apiKey = convertDbApiKey(dbApiKey);
  
  // Check if key is active
  if (apiKey.status === 'revoked') {
    return {
      success: false,
      errorResponse: createErrorResponse(
        'Unauthorized',
        'API key has been revoked',
        401,
        'revoked_api_key'
      ),
    };
  }
  
  if (apiKey.status === 'expired' || (apiKey.expiresAt && apiKey.expiresAt < Date.now())) {
    return {
      success: false,
      errorResponse: createErrorResponse(
        'Unauthorized',
        'API key has expired',
        401,
        'expired_api_key'
      ),
    };
  }
  
  // Check IP whitelist
  if (apiKey.ipWhitelist && apiKey.ipWhitelist.length > 0) {
    if (!apiKey.ipWhitelist.includes(clientIp)) {
      return {
        success: false,
        errorResponse: createErrorResponse(
          'Forbidden',
          'IP address not allowed',
          403,
          'ip_not_allowed'
        ),
      };
    }
  }
  
  // Check required scopes
  if (options.requiredScopes && options.requiredScopes.length > 0) {
    const hasRequiredScopes = options.requiredScopes.every(scope =>
      apiKey.scopes.includes(scope)
    );
    
    if (!hasRequiredScopes) {
      return {
        success: false,
        errorResponse: createErrorResponse(
          'Forbidden',
          `Missing required scopes: ${options.requiredScopes.join(', ')}`,
          403,
          'insufficient_scope'
        ),
      };
    }
  }
  
  // Check rate limit
  if (!options.skipRateLimit) {
    const rateLimitStatus = await recordAndCheckRateLimit(apiKey);
    
    if (rateLimitStatus.isLimited) {
      return {
        success: false,
        errorResponse: createRateLimitResponse(rateLimitStatus) as NextResponse<ApiErrorResponse>,
      };
    }
  }
  
  // Update last used timestamp (fire and forget)
  try {
    convexClient.mutation(api.apiKeys.updateApiKeyLastUsed, { keyId: apiKey.id, ...internalSecretArg() });
  } catch {
    // Ignore errors updating last used
  }
  
  // Create request context
  const context = createRequestContext(apiKey, clientIp);
  
  // Log API usage (fire and forget)
  if (!options.skipLogging) {
    const responseTime = Date.now() - startTime;
    try {
      convexClient.mutation(api.apiUsageLogs.createApiUsageLog, {
        logId: `log_${crypto.randomBytes(16).toString('hex')}`,
        partnerId: apiKey.partnerId,
        apiKeyId: apiKey.id,
        endpoint: request.nextUrl.pathname,
        method: request.method,
        statusCode: 200, // Will be updated by response
        responseTimeMs: responseTime,
        ipAddress: clientIp,
        userAgent: request.headers.get('user-agent') || undefined,
        requestId: context.requestId,
      });
    } catch {
      // Ignore logging errors
    }
  }
  
  return {
    success: true,
    context,
  };
}

/**
 * Create a wrapped API handler with authentication and rate limiting
 * 
 * @param handler - The API handler function
 * @param options - Middleware options
 * @returns Wrapped handler function
 */
export function withApiAuth<T>(
  handler: (request: NextRequest, context: ApiRequestContext) => Promise<NextResponse<T>>,
  options: MiddlewareOptions = {}
): (request: NextRequest) => Promise<NextResponse<T | ApiErrorResponse>> {
  return async (request: NextRequest) => {
    const result = await validateApiRequest(request, options);
    
    if (!result.success || !result.context) {
      return result.errorResponse as NextResponse<T | ApiErrorResponse>;
    }
    
    return handler(request, result.context);
  };
}

/**
 * Add rate limit headers to a response
 * 
 * @param response - The response to add headers to
 * @param apiKey - The API key for rate limit info
 * @returns Response with rate limit headers
 */
export async function addRateLimitHeaders<T>(
  response: NextResponse<T>,
  apiKey: ApiKey
): Promise<NextResponse<T>> {
  const rateLimitStatus = await recordAndCheckRateLimit(apiKey);
  const headers = getRateLimitHeaders(rateLimitStatus);
  
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  
  return response;
}
