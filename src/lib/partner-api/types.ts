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
export type APIKeyStatus = 'active' | 'revoked' | 'expired';

/**
 * OAuth 2.0 grant types supported
 */
export type OAuthGrantType = 'client_credentials' | 'authorization_code' | 'refresh_token';

/**
 * API key record
 * @requirements 21.3 - API key management
 */
export interface APIKey {
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
  status: APIKeyStatus;
  /** Scopes/permissions granted to this key */
  scopes: string[];
  /** Rate limit override (requests per minute) */
  rateLimit?: number;
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
 * Partner application record
 * @requirements 21.2 - OAuth 2.0 authentication
 */
export interface PartnerApplication {
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
  /** When the partner was created */
  createdAt: number;
  /** Contact email */
  contactEmail: string;
}

/**
 * OAuth access token
 */
export interface AccessToken {
  /** Token ID */
  id: string;
  /** Partner ID */
  partnerId: string;
  /** API key ID (if key-based auth) */
  apiKeyId?: string;
  /** Token value (hashed in storage) */
  tokenHash: string;
  /** Token type */
  tokenType: 'Bearer';
  /** Scopes granted */
  scopes: string[];
  /** When the token expires */
  expiresAt: number;
  /** When the token was created */
  createdAt: number;
}

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
  /** Whether to use sliding window */
  slidingWindow: boolean;
}

/**
 * Rate limit status for a client
 */
export interface RateLimitStatus {
  /** Number of requests remaining */
  remaining: number;
  /** Total limit */
  limit: number;
  /** When the window resets (Unix timestamp) */
  resetAt: number;
  /** Whether the limit is exceeded */
  exceeded: boolean;
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
  | 'payment.failed';

/**
 * Webhook delivery status
 */
export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying';

/**
 * Webhook event payload
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
  partnerId: string;
  /** Event being delivered */
  event: WebhookEvent;
  /** Delivery URL */
  url: string;
  /** Delivery status */
  status: WebhookDeliveryStatus;
  /** Number of attempts made */
  attempts: number;
  /** Maximum attempts allowed */
  maxAttempts: number;
  /** HTTP status code of last attempt */
  lastStatusCode?: number;
  /** Error message of last attempt */
  lastError?: string;
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
export interface APIError {
  /** Error code */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** Request ID for tracing */
  requestId?: string;
}

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
 * API response wrapper
 */
export interface APIResponse<T> {
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

// ============================================================================
// API Usage Types
// ============================================================================

/**
 * API usage metrics
 * @requirements 21.7 - Display API usage metrics
 */
export interface APIUsageMetrics {
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
// Constants
// ============================================================================

/**
 * Default rate limit configuration
 * @requirements 21.8 - 1000 requests per minute
 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 1000,
  windowSeconds: 60,
  slidingWindow: true,
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
] as const;

export type APIScope = typeof API_SCOPES[number];
