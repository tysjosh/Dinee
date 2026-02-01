/**
 * Partner API Rate Limiter
 * 
 * Implements rate limiting for the Partner API using a sliding window algorithm.
 * Enforces 1000 requests per minute per API key by default.
 * 
 * @module partner-api/rate-limiter
 * @requirements 21.8 - Enforce 1000 requests per minute per API key
 */

import type { RateLimitConfig, RateLimitStatus, RateLimitHeaders, ApiKey } from './types';
import { DEFAULT_RATE_LIMIT } from './auth';

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limit entry for tracking requests
 */
interface RateLimitEntry {
  /** Request timestamps within the current window */
  timestamps: number[];
  /** Window start time */
  windowStart: number;
}

// ============================================================================
// In-Memory Rate Limiter
// ============================================================================

/**
 * In-memory rate limiter using sliding window algorithm
 * 
 * Note: In production, this should be replaced with Redis or similar
 * distributed cache for multi-instance deployments.
 */
class InMemoryRateLimiter {
  private entries: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;
  
  constructor(config: RateLimitConfig = { maxRequests: DEFAULT_RATE_LIMIT, windowSeconds: 60 }) {
    this.config = config;
    
    // Clean up old entries periodically
    setInterval(() => this.cleanup(), 60000);
  }
  
  /**
   * Check if a request should be rate limited
   * 
   * @param key - The rate limit key (usually API key ID)
   * @param maxRequests - Override max requests (optional)
   * @returns Rate limit status
   */
  check(key: string, maxRequests?: number): RateLimitStatus {
    const now = Date.now();
    const windowMs = this.config.windowSeconds * 1000;
    const limit = maxRequests ?? this.config.maxRequests;
    
    let entry = this.entries.get(key);
    
    if (!entry) {
      entry = {
        timestamps: [],
        windowStart: now,
      };
      this.entries.set(key, entry);
    }
    
    // Remove timestamps outside the current window
    const windowStart = now - windowMs;
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);
    
    const currentCount = entry.timestamps.length;
    const isLimited = currentCount >= limit;
    
    // Calculate reset time
    const oldestTimestamp = entry.timestamps[0] || now;
    const resetInSeconds = Math.ceil((oldestTimestamp + windowMs - now) / 1000);
    
    return {
      currentCount,
      maxRequests: limit,
      resetInSeconds: Math.max(0, resetInSeconds),
      isLimited,
    };
  }
  
  /**
   * Record a request for rate limiting
   * 
   * @param key - The rate limit key
   * @returns Updated rate limit status
   */
  record(key: string, maxRequests?: number): RateLimitStatus {
    const now = Date.now();
    const windowMs = this.config.windowSeconds * 1000;
    const limit = maxRequests ?? this.config.maxRequests;
    
    let entry = this.entries.get(key);
    
    if (!entry) {
      entry = {
        timestamps: [],
        windowStart: now,
      };
      this.entries.set(key, entry);
    }
    
    // Remove timestamps outside the current window
    const windowStart = now - windowMs;
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);
    
    // Add current request timestamp
    entry.timestamps.push(now);
    
    const currentCount = entry.timestamps.length;
    const isLimited = currentCount > limit;
    
    // Calculate reset time
    const oldestTimestamp = entry.timestamps[0] || now;
    const resetInSeconds = Math.ceil((oldestTimestamp + windowMs - now) / 1000);
    
    return {
      currentCount,
      maxRequests: limit,
      resetInSeconds: Math.max(0, resetInSeconds),
      isLimited,
    };
  }
  
  /**
   * Reset rate limit for a key
   * 
   * @param key - The rate limit key
   */
  reset(key: string): void {
    this.entries.delete(key);
  }
  
  /**
   * Clean up old entries
   */
  private cleanup(): void {
    const now = Date.now();
    const windowMs = this.config.windowSeconds * 1000;
    const cutoff = now - windowMs * 2; // Keep entries for 2 windows
    
    for (const [key, entry] of this.entries) {
      if (entry.timestamps.length === 0 || 
          entry.timestamps[entry.timestamps.length - 1] < cutoff) {
        this.entries.delete(key);
      }
    }
  }
  
  /**
   * Get current stats for monitoring
   */
  getStats(): { totalKeys: number; totalRequests: number } {
    let totalRequests = 0;
    for (const entry of this.entries.values()) {
      totalRequests += entry.timestamps.length;
    }
    return {
      totalKeys: this.entries.size,
      totalRequests,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/** Global rate limiter instance */
let rateLimiterInstance: InMemoryRateLimiter | null = null;

/**
 * Get the rate limiter instance
 * 
 * @param config - Optional configuration override
 * @returns The rate limiter instance
 */
export function getRateLimiter(config?: RateLimitConfig): InMemoryRateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new InMemoryRateLimiter(config);
  }
  return rateLimiterInstance;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check rate limit for an API key
 * 
 * @param apiKey - The API key record
 * @returns Rate limit status
 * 
 * @requirements 21.8 - Enforce 1000 requests per minute per API key
 */
export function checkRateLimit(apiKey: ApiKey): RateLimitStatus {
  const limiter = getRateLimiter();
  const maxRequests = apiKey.rateLimitOverride ?? DEFAULT_RATE_LIMIT;
  return limiter.check(apiKey.id, maxRequests);
}

/**
 * Record a request and check rate limit
 * 
 * @param apiKey - The API key record
 * @returns Rate limit status after recording
 * 
 * @requirements 21.8 - Enforce 1000 requests per minute per API key
 */
export function recordAndCheckRateLimit(apiKey: ApiKey): RateLimitStatus {
  const limiter = getRateLimiter();
  const maxRequests = apiKey.rateLimitOverride ?? DEFAULT_RATE_LIMIT;
  return limiter.record(apiKey.id, maxRequests);
}

/**
 * Generate rate limit headers for response
 * 
 * @param status - The rate limit status
 * @returns Headers object
 */
export function getRateLimitHeaders(status: RateLimitStatus): RateLimitHeaders {
  return {
    'X-RateLimit-Limit': status.maxRequests.toString(),
    'X-RateLimit-Remaining': Math.max(0, status.maxRequests - status.currentCount).toString(),
    'X-RateLimit-Reset': (Math.floor(Date.now() / 1000) + status.resetInSeconds).toString(),
  };
}

/**
 * Create a rate limit exceeded response
 * 
 * @param status - The rate limit status
 * @returns Response object with 429 status
 */
export function createRateLimitResponse(status: RateLimitStatus): Response {
  const headers = getRateLimitHeaders(status);
  
  return new Response(
    JSON.stringify({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Maximum ${status.maxRequests} requests per minute.`,
      code: 'rate_limit_exceeded',
      retryAfter: status.resetInSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        'Retry-After': status.resetInSeconds.toString(),
      },
    }
  );
}

/**
 * Reset rate limit for an API key (for testing or admin purposes)
 * 
 * @param apiKeyId - The API key ID
 */
export function resetRateLimit(apiKeyId: string): void {
  const limiter = getRateLimiter();
  limiter.reset(apiKeyId);
}

/**
 * Get rate limiter statistics
 * 
 * @returns Statistics object
 */
export function getRateLimiterStats(): { totalKeys: number; totalRequests: number } {
  const limiter = getRateLimiter();
  return limiter.getStats();
}
