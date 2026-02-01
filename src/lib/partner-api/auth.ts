/**
 * Partner API Authentication Module
 * 
 * Implements OAuth 2.0 authentication and API key validation for partner applications.
 * Supports client_credentials grant type for server-to-server authentication.
 * 
 * @module partner-api/auth
 * @requirements 21.2 - OAuth 2.0 authentication for partner applications
 * @requirements 21.3 - API key management for partners
 */

import crypto from 'crypto';
import type {
  ApiKey,
  ApiKeyValidationResult,
  ApiKeyScope,
  OAuthClient,
  OAuthAccessToken,
  OAuthTokenRequest,
  ApiRequestContext,
} from './types';

// ============================================================================
// Constants
// ============================================================================

/** Default rate limit: 1000 requests per minute */
export const DEFAULT_RATE_LIMIT = 1000;

/** Access token expiration: 1 hour */
export const ACCESS_TOKEN_EXPIRY_SECONDS = 3600;

/** Refresh token expiration: 30 days */
export const REFRESH_TOKEN_EXPIRY_SECONDS = 30 * 24 * 3600;

/** API key prefix for live keys */
export const API_KEY_PREFIX_LIVE = 'pk_live_';

/** API key prefix for test keys */
export const API_KEY_PREFIX_TEST = 'pk_test_';

// ============================================================================
// API Key Generation and Validation
// ============================================================================

/**
 * Generate a new API key
 * 
 * @param isTestMode - Whether to generate a test key
 * @returns Object containing the plain key and its hash
 */
export function generateApiKey(isTestMode: boolean = false): {
  key: string;
  keyHash: string;
  keyPrefix: string;
} {
  const prefix = isTestMode ? API_KEY_PREFIX_TEST : API_KEY_PREFIX_LIVE;
  const randomPart = crypto.randomBytes(32).toString('base64url');
  const key = `${prefix}${randomPart}`;
  const keyHash = hashApiKey(key);
  const keyPrefix = `${prefix}${randomPart.substring(0, 8)}...`;
  
  return { key, keyHash, keyPrefix };
}

/**
 * Hash an API key for secure storage
 * 
 * @param key - The plain API key
 * @returns The hashed key
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Validate an API key against stored keys
 * 
 * @param key - The API key to validate
 * @param storedKeys - Array of stored API key records
 * @param clientIp - Client IP address for whitelist checking
 * @returns Validation result
 */
export function validateApiKey(
  key: string,
  storedKeys: ApiKey[],
  clientIp?: string
): ApiKeyValidationResult {
  if (!key) {
    return {
      valid: false,
      error: 'API key is required',
      errorCode: 'invalid_key',
    };
  }

  const keyHash = hashApiKey(key);
  const apiKey = storedKeys.find(k => k.keyHash === keyHash);

  if (!apiKey) {
    return {
      valid: false,
      error: 'Invalid API key',
      errorCode: 'invalid_key',
    };
  }

  // Check if key is revoked
  if (apiKey.status === 'revoked') {
    return {
      valid: false,
      error: 'API key has been revoked',
      errorCode: 'revoked',
    };
  }

  // Check if key is expired
  if (apiKey.expiresAt && apiKey.expiresAt < Date.now()) {
    return {
      valid: false,
      error: 'API key has expired',
      errorCode: 'expired',
    };
  }

  // Check IP whitelist if configured
  if (apiKey.ipWhitelist && apiKey.ipWhitelist.length > 0 && clientIp) {
    if (!apiKey.ipWhitelist.includes(clientIp)) {
      return {
        valid: false,
        error: 'IP address not allowed',
        errorCode: 'ip_blocked',
      };
    }
  }

  return {
    valid: true,
    apiKey,
  };
}

/**
 * Check if an API key has a specific scope
 * 
 * @param apiKey - The API key record
 * @param requiredScope - The scope to check
 * @returns Whether the key has the scope
 */
export function hasScope(apiKey: ApiKey, requiredScope: ApiKeyScope): boolean {
  return apiKey.scopes.includes(requiredScope);
}

/**
 * Check if an API key has all required scopes
 * 
 * @param apiKey - The API key record
 * @param requiredScopes - Array of required scopes
 * @returns Whether the key has all scopes
 */
export function hasAllScopes(apiKey: ApiKey, requiredScopes: ApiKeyScope[]): boolean {
  return requiredScopes.every(scope => apiKey.scopes.includes(scope));
}

/**
 * Check if an API key has any of the required scopes
 * 
 * @param apiKey - The API key record
 * @param requiredScopes - Array of required scopes
 * @returns Whether the key has any of the scopes
 */
export function hasAnyScope(apiKey: ApiKey, requiredScopes: ApiKeyScope[]): boolean {
  return requiredScopes.some(scope => apiKey.scopes.includes(scope));
}

// ============================================================================
// OAuth 2.0 Implementation
// ============================================================================

/**
 * Generate OAuth 2.0 client credentials
 * 
 * @returns Object containing client ID and secret
 */
export function generateOAuthClientCredentials(): {
  clientId: string;
  clientSecret: string;
  clientSecretHash: string;
} {
  const clientId = `client_${crypto.randomBytes(16).toString('hex')}`;
  const clientSecret = crypto.randomBytes(32).toString('base64url');
  const clientSecretHash = crypto.createHash('sha256').update(clientSecret).digest('hex');
  
  return { clientId, clientSecret, clientSecretHash };
}

/**
 * Generate an OAuth 2.0 access token
 * 
 * @param client - The OAuth client
 * @param scopes - Granted scopes
 * @returns Access token response
 */
export function generateAccessToken(
  client: OAuthClient,
  scopes: ApiKeyScope[]
): OAuthAccessToken {
  const accessToken = `at_${crypto.randomBytes(32).toString('base64url')}`;
  const refreshToken = `rt_${crypto.randomBytes(32).toString('base64url')}`;
  
  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
    refreshToken,
    scope: scopes.join(' '),
  };
}

/**
 * Validate OAuth 2.0 client credentials
 * 
 * @param clientId - The client ID
 * @param clientSecret - The client secret
 * @param storedClients - Array of stored OAuth clients
 * @returns The validated client or null
 */
export function validateOAuthClient(
  clientId: string,
  clientSecret: string,
  storedClients: OAuthClient[]
): OAuthClient | null {
  const client = storedClients.find(c => c.clientId === clientId);
  
  if (!client || !client.isActive) {
    return null;
  }
  
  const secretHash = crypto.createHash('sha256').update(clientSecret).digest('hex');
  
  if (client.clientSecretHash !== secretHash) {
    return null;
  }
  
  return client;
}

/**
 * Process OAuth 2.0 token request
 * 
 * @param request - The token request
 * @param storedClients - Array of stored OAuth clients
 * @returns Access token or error
 */
export function processTokenRequest(
  request: OAuthTokenRequest,
  storedClients: OAuthClient[]
): { success: true; token: OAuthAccessToken } | { success: false; error: string } {
  // Validate client credentials
  const client = validateOAuthClient(request.clientId, request.clientSecret, storedClients);
  
  if (!client) {
    return { success: false, error: 'Invalid client credentials' };
  }
  
  // Check grant type is allowed
  if (!client.grantTypes.includes(request.grantType)) {
    return { success: false, error: 'Grant type not allowed for this client' };
  }
  
  // Process based on grant type
  switch (request.grantType) {
    case 'client_credentials': {
      // Parse requested scopes
      const requestedScopes = request.scope 
        ? request.scope.split(' ') as ApiKeyScope[]
        : client.scopes;
      
      // Validate scopes are allowed
      const validScopes = requestedScopes.filter(scope => 
        client.scopes.includes(scope)
      );
      
      if (validScopes.length === 0) {
        return { success: false, error: 'No valid scopes requested' };
      }
      
      const token = generateAccessToken(client, validScopes);
      return { success: true, token };
    }
    
    case 'refresh_token': {
      // In a full implementation, we would validate the refresh token
      // and issue a new access token
      if (!request.refreshToken) {
        return { success: false, error: 'Refresh token is required' };
      }
      
      // For now, issue a new token with the same scopes
      const token = generateAccessToken(client, client.scopes);
      return { success: true, token };
    }
    
    default:
      return { success: false, error: 'Unsupported grant type' };
  }
}

// ============================================================================
// Request Context
// ============================================================================

/**
 * Create an API request context from a validated API key
 * 
 * @param apiKey - The validated API key
 * @param ipAddress - Client IP address
 * @returns API request context
 */
export function createRequestContext(
  apiKey: ApiKey,
  ipAddress: string
): ApiRequestContext {
  return {
    apiKey,
    partnerId: apiKey.partnerId,
    timestamp: Date.now(),
    requestId: `req_${crypto.randomBytes(16).toString('hex')}`,
    ipAddress,
  };
}

/**
 * Extract API key from request headers
 * 
 * Supports both:
 * - Authorization: Bearer <token>
 * - X-API-Key: <key>
 * 
 * @param headers - Request headers
 * @returns The extracted API key or null
 */
export function extractApiKeyFromHeaders(headers: Headers): string | null {
  // Check Authorization header first
  const authHeader = headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check X-API-Key header
  const apiKeyHeader = headers.get('x-api-key');
  if (apiKeyHeader) {
    return apiKeyHeader;
  }
  
  return null;
}

/**
 * Extract client IP from request headers
 * 
 * @param headers - Request headers
 * @returns The client IP address
 */
export function extractClientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}

// ============================================================================
// Webhook Signature
// ============================================================================

/**
 * Generate a webhook signature for a payload
 * 
 * @param payload - The webhook payload
 * @param secret - The webhook secret
 * @param timestamp - The timestamp
 * @returns The signature
 */
export function generateWebhookSignature(
  payload: string,
  secret: string,
  timestamp: number
): string {
  const signedPayload = `${timestamp}.${payload}`;
  return crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
}

/**
 * Verify a webhook signature
 * 
 * @param payload - The webhook payload
 * @param signature - The signature to verify
 * @param secret - The webhook secret
 * @param timestamp - The timestamp
 * @param toleranceSeconds - Tolerance for timestamp validation (default 5 minutes)
 * @returns Whether the signature is valid
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  timestamp: number,
  toleranceSeconds: number = 300
): boolean {
  // Check timestamp is within tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }
  
  const expectedSignature = generateWebhookSignature(payload, secret, timestamp);
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}
