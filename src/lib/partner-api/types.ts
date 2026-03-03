/**
 * Partner API Types and Interfaces
 * 
 * Defines types for the Partner API including authentication,
 * rate limiting, webhooks, and API responses.
 * 
 * @module partner-api/types
 * @requirements 21.1 - Expose REST API for partner integrations
 * @requirements 21.2 - OAuth 2.0 authentication
 * @requirements 21.3 - API key management
 * @requirements 21.5 - Webhook delivery for events
 * @requirements 21.8 - Rate limiting
 */

// ============================================================================
// Authentication Types
// ============================================================================

/**
 * API key status
 */
export type ApiKeyStatus = 'active' | 'revoked' | 'expired';

/**
 * OAuth 2.0 grant types supported
 */
export type OAuthGrantType = 'client_credentials' | 'authorization_code' | 'refresh_token';

/**
 * API key record
 * @requirements 21.3 - API key management
 */
export interface ApiKey {
  /** Unique key ID */
  id: string;
  /** Partner ID this key belongs to */
  partnerId: string;
  /** The actual API key (hashed in storage) */
  keyHash: string;
  /** Key prefix for identification (first 8 chars) */
  keyPrefix: string;
  /** Human-readable name for the key */
  name: string;
  /** Key status */
  status: ApiKeyStatus;
  /** Scopes/permissions granted to this key */
  scopes: string[];
  /** Rate limit override (requests per minute) */
  rateLimit?: number;
  /** Rate limit override used by middleware/rate-limiter */
  rateLimitOverride?: number;
  /** When the key was created */
  createdAt: number;
  /** When the key expires (optional) */
  expiresAt?: number;
  /** Last time the key was used */
  lastUsedAt?: number;
  /** IP whitelist (optional) */
  ipWhitelist?: string[];
}

/**
 * Partner application record (OAuth client)
 * @requirements 21.2 - OAuth 2.0 authentication
 */
export interface OAuthClient {
  /** Unique partner ID */
  id: string;
  /** Partner name */
  name: string;
  /** Partner description */
  description?: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret (hashed) */
  clientSecretHash: string;
  /** Allowed redirect URIs for OAuth */
  redirectUris: string[];
  /** Webhook URL for event delivery */
  webhookUrl?: string;
  /** Webhook secret for signature verification */
  webhookSecret?: string;
  /** Partner status */
  status: 'active' | 'suspended' | 'pending';
  /** Whether the partner is active */
  isActive?: boolean;
  /** Allowed grant types */
  grantTypes?: OAuthGrantType[];
  /** Scopes available to this client */
  scopes?: ApiKeyScope[];
  /** When the partner was created */
  createdAt: number;
  /** Contact email */
  contactEmail: string;
}

/** @deprecated Use OAuthClient instead */
export type PartnerApplication = OAuthClient;

/**
 * OAuth access token
 * Supports both storage shape (id, tokenHash, scopes[], expiresAt) and
 * response shape (accessToken, expiresIn, refreshToken, scope string)
 */
export interface OAuthAccessToken {
  /** Token ID (storage) */
  id?: string;
  /** Partner ID */
  partnerId?: string;
  /** API key ID (if key-based auth) */
  apiKeyId?: string;
  /** Token value (hashed in storage) */
  tokenHash?: string;
  /** Plain access token value (response) */
  accessToken?: string;
  /** Token type */
  tokenType: 'Bearer';
  /** Scopes granted (storage — array) */
  scopes?: string[];
  /** Scopes granted (response — space-delimited string) */
  scope?: string;
  /** When the token expires (storage — timestamp) */
  expiresAt?: number;
  /** Token lifetime in seconds (response) */
  expiresIn?: number;
  /** Refresh token (response) */
  refreshToken?: string;
  /** When the token was created */
  createdAt?: number;
}

/** @deprecated Use OAuthAccessToken instead */
export type AccessToken = OAuthAccessToken;

// ============================================================================
// Rate Limiting Types
// ============================================================================

/**
 * Rate limit configuration
 * @requirements 21.8 - Rate limiting: 1000 requests per minute
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Window size in seconds */
  windowSeconds: number;
  /** Whether to use sliding window (optional, for PartnerAPIService compat) */
  slidingWindow?: boolean;
}

/**
 * Rate limit status for a client
 * Field names match rate-limiter.ts internal usage
 */
export interface RateLimitStatus {
  /** Number of requests made in current window */
  currentCount: number;
  /** Maximum requests allowed per window */
  maxRequests: number;
  /** Seconds until the window resets */
  resetInSeconds: number;
  /** Whether the limit has been exceeded */
  isLimited: boolean;
  /** Remaining requests (PartnerAPIService compat) */
  remaining?: number;
  /** Request limit (PartnerAPIService compat) */
  limit?: number;
  /** Reset timestamp in seconds (PartnerAPIService compat) */
  resetAt?: number;
  /** Whether limit is exceeded (PartnerAPIService compat) */
  exceeded?: boolean;
}

/**
 * Rate limit headers for HTTP responses
 */
export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
}

/**
 * Rate limit entry for tracking
 */
export interface RateLimitEntry {
  /** Client identifier (API key or partner ID) */
  clientId: string;
  /** Request timestamps in current window */
  requests: number[];
  /** Window start time */
  windowStart: number;
}

// ============================================================================
// Webhook Types
// ============================================================================

/**
 * Webhook event types
 * @requirements 21.5 - Webhook delivery for order and call events
 */
export type WebhookEventType =
  | 'order.created'
  | 'order.updated'
  | 'order.completed'
  | 'order.cancelled'
  | 'call.started'
  | 'call.ended'
  | 'call.transferred'
  | 'payment.completed'
  | 'payment.failed'
  // Logistics vertical event types (Requirement 10.4)
  | 'shipment.created'
  | 'shipment.assigned'
  | 'shipment.status_updated'
  | 'shipment.delivered'
  | 'shipment.failed';

/**
 * Webhook delivery status
 */
export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying';

/**
 * Webhook subscription record
 */
export interface WebhookSubscription {
  /** Subscription ID */
  id: string;
  /** Partner ID */
  partnerId: string;
  /** Delivery URL */
  url: string;
  /** Webhook secret for signature verification */
  secret: string;
  /** Event types subscribed to */
  events: WebhookEventType[];
  /** Whether the subscription is active */
  isActive: boolean;
  /**
   * Delivery mode.
   * - "partner" (default): existing behaviour — X-Webhook-Signature with timestamp prefix
   * - "runsheet": Runsheet envelope with X-Dinee-Signature (raw HMAC, no timestamp)
   */
  mode?: "partner" | "runsheet";
  /**
   * Authoritative tenant ID attached to this subscription.
   * Used by runsheet mode to stamp tenant_id in the envelope
   * from server context rather than client input.
   */
  tenantId?: string;
  /** When the subscription was created */
  createdAt: number;
}

/**
 * Webhook event payload
 */
export interface WebhookPayload<T = unknown> {
  /** Unique event ID */
  id: string;
  /** Event type */
  type: WebhookEventType;
  /** When the event occurred */
  timestamp: number;
  /** API version */
  apiVersion: string;
  /** Event data */
  data: T;
}

/**
 * Webhook event record (stored)
 */
export interface WebhookEvent {
  /** Unique event ID */
  id: string;
  /** Event type */
  type: WebhookEventType;
  /** Event data */
  data: Record<string, unknown>;
  /** When the event occurred */
  timestamp: number;
  /** API version */
  apiVersion: string;
}

/**
 * Webhook delivery record
 * @requirements 21.6 - Retry with exponential backoff (5 retries)
 */
export interface WebhookDelivery {
  /** Delivery ID */
  id: string;
  /** Partner ID */
  partnerId?: string;
  /** Subscription ID (webhook-service compat) */
  subscriptionId?: string;
  /** Event being delivered */
  event?: WebhookEvent;
  /** Event type (webhook-service compat) */
  eventType?: WebhookEventType;
  /** Serialized payload (webhook-service compat) */
  payload?: string;
  /** Delivery URL */
  url?: string;
  /** Delivery status */
  status?: WebhookDeliveryStatus;
  /** Number of attempts made */
  attempts?: number;
  /** Attempt count (webhook-service compat) */
  attemptCount?: number;
  /** Maximum attempts allowed */
  maxAttempts?: number;
  /** HTTP status code of last attempt */
  lastStatusCode?: number;
  /** HTTP status code (webhook-service compat) */
  statusCode?: number;
  /** Response body (webhook-service compat) */
  responseBody?: string;
  /** Error message of last attempt */
  lastError?: string;
  /** Error message (webhook-service compat) */
  error?: string;
  /** Whether delivery succeeded (webhook-service compat) */
  success?: boolean;
  /** When the delivery was created */
  createdAt: number;
  /** When the last attempt was made */
  lastAttemptAt?: number;
  /** When the next retry is scheduled */
  nextRetryAt?: number;
  /** When the delivery was completed */
  completedAt?: number;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Standard API error response
 * @requirements 21.4 - Proper error responses
 */
export interface ApiErrorResponse {
  /** Error indicator (e.g. "Unauthorized", "Internal Server Error") */
  error?: string;
  /** Error code */
  code?: string;
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** Request ID for tracing */
  requestId?: string;
}

/** @deprecated Use ApiErrorResponse instead */
export type APIError = ApiErrorResponse;

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  /** Data items */
  data: T[];
  /** Pagination info */
  pagination: {
    /** Current page */
    page: number;
    /** Items per page */
    perPage: number;
    /** Total items */
    total: number;
    /** Total pages */
    totalPages: number;
    /** Has more pages */
    hasMore: boolean;
  };
}

/**
 * API success response wrapper
 */
export interface ApiSuccessResponse<T> {
  /** Response data */
  data: T;
  /** Response metadata */
  meta?: {
    /** Request ID */
    requestId: string;
    /** Response timestamp */
    timestamp: number;
    /** API version */
    apiVersion: string;
  };
}

/** @deprecated Use ApiSuccessResponse instead */
export type APIResponse<T> = ApiSuccessResponse<T>;

// ============================================================================
// API Usage Types
// ============================================================================

/**
 * API usage metrics
 * @requirements 21.7 - Display API usage metrics
 */
export interface ApiUsageMetrics {
  /** Partner ID */
  partnerId: string;
  /** Time period */
  period: {
    start: number;
    end: number;
  };
  /** Total requests */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests */
  failedRequests: number;
  /** Rate limited requests */
  rateLimitedRequests: number;
  /** Requests by endpoint */
  byEndpoint: Record<string, number>;
  /** Requests by status code */
  byStatusCode: Record<number, number>;
  /** Average response time in ms */
  averageResponseTimeMs: number;
}

/** @deprecated Use ApiUsageMetrics instead */
export type APIUsageMetrics = ApiUsageMetrics;

/**
 * Webhook delivery metrics
 */
export interface WebhookMetrics {
  /** Partner ID */
  partnerId: string;
  /** Time period */
  period: {
    start: number;
    end: number;
  };
  /** Total events */
  totalEvents: number;
  /** Successfully delivered */
  delivered: number;
  /** Failed deliveries */
  failed: number;
  /** Pending deliveries */
  pending: number;
  /** Average delivery time in ms */
  averageDeliveryTimeMs: number;
  /** Events by type */
  byEventType: Record<WebhookEventType, number>;
}

// ============================================================================
// Additional Types (referenced by consumers)
// ============================================================================

/**
 * Result of API key validation
 */
export interface ApiKeyValidationResult {
  valid: boolean;
  apiKey?: ApiKey;
  error?: string;
  errorCode?: string;
}

/**
 * Context for an API request
 */
export interface ApiRequestContext {
  requestId: string;
  apiKey: ApiKey;
  partnerId: string;
  clientIp?: string;
  ipAddress?: string;
  timestamp: number;
}

/**
 * OAuth token request parameters
 */
export interface OAuthTokenRequest {
  grantType: OAuthGrantType;
  clientId: string;
  clientSecret: string;
  scope?: string;
  refreshToken?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default rate limit configuration
 * @requirements 21.8 - 1000 requests per minute
 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 1000,
  windowSeconds: 60,
};

/**
 * Maximum webhook retry attempts
 * @requirements 21.6 - 5 retries
 */
export const MAX_WEBHOOK_RETRIES = 5;

/**
 * Webhook retry delays (exponential backoff in seconds)
 */
export const WEBHOOK_RETRY_DELAYS = [10, 30, 60, 300, 900]; // 10s, 30s, 1m, 5m, 15m

/**
 * API version
 */
export const API_VERSION = '2024-01-01';

/**
 * Available API scopes
 */
export const API_SCOPES = [
  'restaurants:read',
  'restaurants:write',
  'branches:read',
  'branches:write',
  'menus:read',
  'menus:write',
  'orders:read',
  'orders:write',
  'calls:read',
  'calls:write',
  'analytics:read',
  'webhooks:manage',
  'shipments:read',
  'shipments:write',
  'riders:write',
] as const;

export type ApiKeyScope = typeof API_SCOPES[number];

// ============================================================================
// Deprecated Aliases (backward compatibility)
// ============================================================================

/** @deprecated Use ApiKey instead */
export type APIKey = ApiKey;

/** @deprecated Use ApiKeyStatus instead */
export type APIKeyStatus = ApiKeyStatus;

/** @deprecated Use ApiKeyScope instead */
export type APIScope = ApiKeyScope;
