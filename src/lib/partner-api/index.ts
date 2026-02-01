/**
 * Partner API Module
 * 
 * Provides partner integration capabilities including authentication,
 * API key management, rate limiting, and webhook delivery.
 * 
 * @module partner-api
 * @requirements 21.1 - Expose REST API for partner integrations
 * @requirements 21.2 - OAuth 2.0 authentication
 * @requirements 21.3 - API key management
 * @requirements 21.5 - Webhook delivery for events
 * @requirements 21.6 - Retry with exponential backoff
 * @requirements 21.7 - Display API usage metrics
 * @requirements 21.8 - Rate limiting
 */

// Export types
export type {
  // Authentication types
  APIKeyStatus,
  OAuthGrantType,
  APIKey,
  PartnerApplication,
  AccessToken,
  
  // Rate limiting types
  RateLimitConfig,
  RateLimitStatus,
  RateLimitEntry,
  
  // Webhook types
  WebhookEventType,
  WebhookDeliveryStatus,
  WebhookEvent,
  WebhookDelivery,
  
  // API response types
  APIError,
  PaginatedResponse,
  APIResponse,
  
  // Metrics types
  APIUsageMetrics,
  WebhookMetrics,
  
  // Scope type
  APIScope,
} from './types';

// Export constants
export {
  DEFAULT_RATE_LIMIT,
  MAX_WEBHOOK_RETRIES,
  WEBHOOK_RETRY_DELAYS,
  API_VERSION,
  API_SCOPES,
} from './types';

// Export Partner API Service
export {
  PartnerAPIService,
  createPartnerAPIService,
  getPartnerAPIService,
  resetPartnerAPIService,
} from './PartnerAPIService';

export type {
  PartnerAPIServiceConfig,
  APIUsageRecord,
  AuthResult,
} from './PartnerAPIService';

// Export Webhook Service
export {
  WebhookService,
  createWebhookService,
  getWebhookService,
  resetWebhookService,
} from './WebhookService';

export type {
  WebhookServiceConfig,
  CreateWebhookEventParams,
} from './WebhookService';

// Default export
export { default } from './PartnerAPIService';
