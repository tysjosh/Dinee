/**
 * Partner API Service Implementation
 * 
 * Provides authentication, rate limiting, and API management
 * for partner integrations.
 * 
 * @module partner-api/PartnerAPIService
 * @requirements 21.1 - Expose REST API for partner integrations
 * @requirements 21.2 - OAuth 2.0 authentication
 * @requirements 21.3 - API key management
 * @requirements 21.8 - Rate limiting
 */

import crypto from 'crypto';
import type {
  APIKey,
  APIKeyStatus,
  PartnerApplication,
  AccessToken,
  RateLimitConfig,
  RateLimitStatus,
  RateLimitEntry,
  APIUsageMetrics,
  APIScope,
} from './types';
import {
  DEFAULT_RATE_LIMIT,
  API_VERSION,
  API_SCOPES,
} from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Service configuration
 */
export interface PartnerAPIServiceConfig {
  /** Default rate limit configuration */
  rateLimit?: Partial<RateLimitConfig>;
  /** Token expiration time in seconds */
  tokenExpirationSeconds?: number;
  /** API key expiration time in seconds (optional) */
  apiKeyExpirationSeconds?: number;
  /** Function to persist partner data */
  persistPartnerFn?: (partner: PartnerApplication) => Promise<void>;
  /** Function to persist API key data */
  persistAPIKeyFn?: (key: APIKey) => Promise<void>;
  /** Function to log API usage */
  logUsageFn?: (usage: APIUsageRecord) => Promise<void>;
}

/**
 * API usage record for logging
 */
export interface APIUsageRecord {
  /** Partner ID */
  partnerId: string;
  /** API key ID */
  apiKeyId?: string;
  /** Request endpoint */
  endpoint: string;
  /** HTTP method */
  method: string;
  /** Response status code */
  statusCode: number;
  /** Response time in ms */
  responseTimeMs: number;
  /** Request timestamp */
  timestamp: number;
  /** Request ID */
  requestId: string;
}

/**
 * Authentication result
 */
export interface AuthResult {
  /** Whether authentication succeeded */
  success: boolean;
  /** Partner ID if authenticated */
  partnerId?: string;
  /** API key ID if key-based auth */
  apiKeyId?: string;
  /** Granted scopes */
  scopes?: string[];
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  errorCode?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a secure random string
 */
function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a unique ID with prefix
 */
function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Hash a string using SHA-256
 */
function hashString(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Verify a value against its hash
 */
function verifyHash(value: string, hash: string): boolean {
  return hashString(value) === hash;
}

// ============================================================================
// Partner API Service
// ============================================================================

/**
 * Partner API Service
 * 
 * Manages partner authentication, API keys, and rate limiting.
 * 
 * @requirements 21.2 - OAuth 2.0 authentication
 * @requirements 21.3 - API key management
 * @requirements 21.8 - Rate limiting
 */
export class PartnerAPIService {
  private config: PartnerAPIServiceConfig;
  private rateLimit: RateLimitConfig;
  
  // In-memory storage (would be database in production)
  private partners: Map<string, PartnerApplication> = new Map();
  private apiKeys: Map<string, APIKey> = new Map();
  private accessTokens: Map<string, AccessToken> = new Map();
  private rateLimitEntries: Map<string, RateLimitEntry> = new Map();
  private usageRecords: APIUsageRecord[] = [];

  constructor(config: PartnerAPIServiceConfig = {}) {
    this.config = {
      tokenExpirationSeconds: 3600, // 1 hour
      ...config,
    };
    
    this.rateLimit = {
      ...DEFAULT_RATE_LIMIT,
      ...config.rateLimit,
    };
  }

  // ==========================================================================
  // Partner Management
  // ==========================================================================

  /**
   * Register a new partner application
   * @requirements 21.2 - OAuth 2.0 authentication
   */
  async registerPartner(params: {
    name: string;
    description?: string;
    contactEmail: string;
    redirectUris?: string[];
    webhookUrl?: string;
  }): Promise<{ partner: PartnerApplication; clientSecret: string }> {
    const clientId = generateId('client');
    const clientSecret = generateSecureToken(32);
    const webhookSecret = params.webhookUrl ? generateSecureToken(32) : undefined;

    const partner: PartnerApplication = {
      id: generateId('partner'),
      name: params.name,
      description: params.description,
      clientId,
      clientSecretHash: hashString(clientSecret),
      redirectUris: params.redirectUris || [],
      webhookUrl: params.webhookUrl,
      webhookSecret,
      status: 'pending',
      createdAt: Date.now(),
      contactEmail: params.contactEmail,
    };

    this.partners.set(partner.id, partner);

    if (this.config.persistPartnerFn) {
      await this.config.persistPartnerFn(partner);
    }

    return { partner, clientSecret };
  }

  /**
   * Get partner by ID
   */
  getPartner(partnerId: string): PartnerApplication | undefined {
    return this.partners.get(partnerId);
  }

  /**
   * Get partner by client ID
   */
  getPartnerByClientId(clientId: string): PartnerApplication | undefined {
    return Array.from(this.partners.values()).find(p => p.clientId === clientId);
  }

  /**
   * Update partner status
   */
  async updatePartnerStatus(
    partnerId: string,
    status: PartnerApplication['status']
  ): Promise<boolean> {
    const partner = this.partners.get(partnerId);
    if (!partner) return false;

    partner.status = status;

    if (this.config.persistPartnerFn) {
      await this.config.persistPartnerFn(partner);
    }

    return true;
  }

  // ==========================================================================
  // API Key Management
  // ==========================================================================

  /**
   * Create a new API key for a partner
   * @requirements 21.3 - API key management
   */
  async createAPIKey(params: {
    partnerId: string;
    name: string;
    scopes: APIScope[];
    rateLimit?: number;
    expiresInDays?: number;
    ipWhitelist?: string[];
  }): Promise<{ apiKey: APIKey; key: string }> {
    const partner = this.partners.get(params.partnerId);
    if (!partner) {
      throw new Error('Partner not found');
    }

    // Validate scopes
    const invalidScopes = params.scopes.filter(s => !API_SCOPES.includes(s));
    if (invalidScopes.length > 0) {
      throw new Error(`Invalid scopes: ${invalidScopes.join(', ')}`);
    }

    const key = `pk_${generateSecureToken(24)}`;
    const keyPrefix = key.substring(0, 11); // "pk_" + 8 chars

    const apiKey: APIKey = {
      id: generateId('key'),
      partnerId: params.partnerId,
      keyHash: hashString(key),
      keyPrefix,
      name: params.name,
      status: 'active',
      scopes: params.scopes,
      rateLimit: params.rateLimit,
      createdAt: Date.now(),
      expiresAt: params.expiresInDays
        ? Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000
        : undefined,
      ipWhitelist: params.ipWhitelist,
    };

    this.apiKeys.set(apiKey.id, apiKey);

    if (this.config.persistAPIKeyFn) {
      await this.config.persistAPIKeyFn(apiKey);
    }

    return { apiKey, key };
  }

  /**
   * Revoke an API key
   */
  async revokeAPIKey(keyId: string): Promise<boolean> {
    const apiKey = this.apiKeys.get(keyId);
    if (!apiKey) return false;

    apiKey.status = 'revoked';

    if (this.config.persistAPIKeyFn) {
      await this.config.persistAPIKeyFn(apiKey);
    }

    return true;
  }

  /**
   * Get API keys for a partner
   */
  getAPIKeys(partnerId: string): APIKey[] {
    return Array.from(this.apiKeys.values())
      .filter(k => k.partnerId === partnerId);
  }

  /**
   * Validate an API key
   */
  validateAPIKey(key: string): APIKey | null {
    const keyHash = hashString(key);
    
    for (const apiKey of this.apiKeys.values()) {
      if (apiKey.keyHash === keyHash) {
        // Check status
        if (apiKey.status !== 'active') {
          return null;
        }
        
        // Check expiration
        if (apiKey.expiresAt && apiKey.expiresAt < Date.now()) {
          apiKey.status = 'expired';
          return null;
        }
        
        // Update last used
        apiKey.lastUsedAt = Date.now();
        
        return apiKey;
      }
    }
    
    return null;
  }

  // ==========================================================================
  // OAuth 2.0 Authentication
  // ==========================================================================

  /**
   * Authenticate using client credentials (OAuth 2.0)
   * @requirements 21.2 - OAuth 2.0 authentication
   */
  async authenticateClientCredentials(
    clientId: string,
    clientSecret: string
  ): Promise<{ accessToken: string; expiresIn: number } | null> {
    const partner = this.getPartnerByClientId(clientId);
    if (!partner) {
      return null;
    }

    if (partner.status !== 'active') {
      return null;
    }

    if (!verifyHash(clientSecret, partner.clientSecretHash)) {
      return null;
    }

    // Generate access token
    const tokenValue = generateSecureToken(32);
    const expiresIn = this.config.tokenExpirationSeconds || 3600;

    const token: AccessToken = {
      id: generateId('token'),
      partnerId: partner.id,
      tokenHash: hashString(tokenValue),
      tokenType: 'Bearer',
      scopes: API_SCOPES as unknown as string[],
      expiresAt: Date.now() + expiresIn * 1000,
      createdAt: Date.now(),
    };

    this.accessTokens.set(token.id!, token);

    return {
      accessToken: tokenValue,
      expiresIn,
    };
  }

  /**
   * Validate an access token
   */
  validateAccessToken(token: string): AccessToken | null {
    const tokenHash = hashString(token);
    
    for (const accessToken of this.accessTokens.values()) {
      if (accessToken.tokenHash === tokenHash) {
        // Check expiration
        if (accessToken.expiresAt && accessToken.expiresAt < Date.now()) {
          this.accessTokens.delete(accessToken.id!);
          return null;
        }
        
        return accessToken;
      }
    }
    
    return null;
  }

  // ==========================================================================
  // Request Authentication
  // ==========================================================================

  /**
   * Authenticate an API request
   */
  authenticateRequest(authHeader?: string): AuthResult {
    if (!authHeader) {
      return {
        success: false,
        error: 'Missing authorization header',
        errorCode: 'MISSING_AUTH',
      };
    }

    // Check for Bearer token
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const accessToken = this.validateAccessToken(token);
      
      if (accessToken) {
        return {
          success: true,
          partnerId: accessToken.partnerId,
          scopes: accessToken.scopes,
        };
      }
      
      return {
        success: false,
        error: 'Invalid or expired access token',
        errorCode: 'INVALID_TOKEN',
      };
    }

    // Check for API key
    if (authHeader.startsWith('ApiKey ')) {
      const key = authHeader.substring(7);
      const apiKey = this.validateAPIKey(key);
      
      if (apiKey) {
        return {
          success: true,
          partnerId: apiKey.partnerId,
          apiKeyId: apiKey.id,
          scopes: apiKey.scopes,
        };
      }
      
      return {
        success: false,
        error: 'Invalid or expired API key',
        errorCode: 'INVALID_API_KEY',
      };
    }

    return {
      success: false,
      error: 'Invalid authorization format',
      errorCode: 'INVALID_AUTH_FORMAT',
    };
  }

  /**
   * Check if authenticated request has required scope
   */
  hasScope(authResult: AuthResult, requiredScope: APIScope): boolean {
    if (!authResult.success || !authResult.scopes) {
      return false;
    }
    return authResult.scopes.includes(requiredScope);
  }

  // ==========================================================================
  // Rate Limiting
  // ==========================================================================

  /**
   * Check rate limit for a client
   * @requirements 21.8 - Rate limiting: 1000 requests per minute
   */
  checkRateLimit(clientId: string, customLimit?: number): RateLimitStatus {
    const now = Date.now();
    const windowMs = this.rateLimit.windowSeconds * 1000;
    const maxRequests = customLimit || this.rateLimit.maxRequests;

    let entry = this.rateLimitEntries.get(clientId);

    if (!entry) {
      entry = {
        clientId,
        requests: [],
        windowStart: now,
      };
      this.rateLimitEntries.set(clientId, entry);
    }

    // Clean up old requests (sliding window)
    if (this.rateLimit.slidingWindow) {
      entry.requests = entry.requests.filter(t => t > now - windowMs);
    } else {
      // Fixed window - reset if window has passed
      if (now - entry.windowStart >= windowMs) {
        entry.requests = [];
        entry.windowStart = now;
      }
    }

    const remaining = Math.max(0, maxRequests - entry.requests.length);
    const resetAt = this.rateLimit.slidingWindow
      ? now + windowMs
      : entry.windowStart + windowMs;

    return {
      currentCount: entry.requests.length,
      maxRequests,
      resetInSeconds: Math.max(0, Math.ceil((resetAt - now) / 1000)),
      isLimited: remaining === 0,
      remaining,
      limit: maxRequests,
      resetAt: Math.floor(resetAt / 1000),
      exceeded: remaining === 0,
    };
  }

  /**
   * Record a request for rate limiting
   */
  recordRequest(clientId: string): void {
    const entry = this.rateLimitEntries.get(clientId);
    if (entry) {
      entry.requests.push(Date.now());
    }
  }

  // ==========================================================================
  // Usage Tracking
  // ==========================================================================

  /**
   * Log API usage
   */
  async logUsage(record: APIUsageRecord): Promise<void> {
    this.usageRecords.push(record);

    // Trim old records (keep last 10000)
    if (this.usageRecords.length > 10000) {
      this.usageRecords = this.usageRecords.slice(-10000);
    }

    if (this.config.logUsageFn) {
      await this.config.logUsageFn(record);
    }
  }

  /**
   * Get usage metrics for a partner
   * @requirements 21.7 - Display API usage metrics
   */
  getUsageMetrics(
    partnerId: string,
    startTime?: number,
    endTime?: number
  ): APIUsageMetrics {
    const now = Date.now();
    const start = startTime || now - 24 * 60 * 60 * 1000;
    const end = endTime || now;

    const records = this.usageRecords.filter(
      r => r.partnerId === partnerId &&
           r.timestamp >= start &&
           r.timestamp <= end
    );

    const byEndpoint: Record<string, number> = {};
    const byStatusCode: Record<number, number> = {};
    let totalResponseTime = 0;

    for (const record of records) {
      byEndpoint[record.endpoint] = (byEndpoint[record.endpoint] || 0) + 1;
      byStatusCode[record.statusCode] = (byStatusCode[record.statusCode] || 0) + 1;
      totalResponseTime += record.responseTimeMs;
    }

    const successfulRequests = records.filter(r => r.statusCode < 400).length;
    const rateLimitedRequests = records.filter(r => r.statusCode === 429).length;

    return {
      partnerId,
      period: { start, end },
      totalRequests: records.length,
      successfulRequests,
      failedRequests: records.length - successfulRequests,
      rateLimitedRequests,
      byEndpoint,
      byStatusCode,
      averageResponseTimeMs: records.length > 0
        ? Math.round(totalResponseTime / records.length)
        : 0,
    };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get all partners (for admin)
   */
  getAllPartners(): PartnerApplication[] {
    return Array.from(this.partners.values());
  }

  /**
   * Clear all data (for testing)
   */
  clearAll(): void {
    this.partners.clear();
    this.apiKeys.clear();
    this.accessTokens.clear();
    this.rateLimitEntries.clear();
    this.usageRecords = [];
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a PartnerAPIService instance
 */
export function createPartnerAPIService(
  config: PartnerAPIServiceConfig = {}
): PartnerAPIService {
  return new PartnerAPIService(config);
}

// Singleton instance
let partnerAPIServiceInstance: PartnerAPIService | null = null;

/**
 * Get the singleton PartnerAPIService instance
 */
export function getPartnerAPIService(): PartnerAPIService {
  if (!partnerAPIServiceInstance) {
    partnerAPIServiceInstance = createPartnerAPIService();
  }
  return partnerAPIServiceInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetPartnerAPIService(): void {
  partnerAPIServiceInstance = null;
}

export default PartnerAPIService;
