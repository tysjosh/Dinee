/**
 * Partner API Rate Limiter
 * 
 * Implements rate limiting for the Partner API using Upstash Redis sliding window
 * in production, with an in-memory fallback for local development.
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
 * Rate limit entry for tracking requests (in-memory fallback)
 */
interface RateLimitEntry {
  timestamps: number[];
  windowStart: number;
}

/**
 * Backend interface that both Upstash and in-memory implementations satisfy
 */
interface RateLimiterBackend {
  check(key: string, maxRequests: number): Promise<RateLimitStatus>;
  record(key: string, maxRequests: number): Promise<RateLimitStatus>;
  reset(key: string): void;
  getStats(): { totalKeys: number; totalRequests: number };
}

// ============================================================================
// In-Memory Rate Limiter (fallback for local dev)
// ============================================================================

class InMemoryRateLimiter {
  private entries: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimitConfig = { maxRequests: DEFAULT_RATE_LIMIT, windowSeconds: 60 }) {
    this.config = config;
    if (typeof globalThis !== 'undefined' && typeof setInterval === 'function') {
      this.cleanupTimer = setInterval(() => this.cleanup(), 60000);
    }
  }

  async check(key: string, maxRequests: number): Promise<RateLimitStatus> {
    const now = Date.now();
    const windowMs = this.config.windowSeconds * 1000;
    const limit = maxRequests;

    let entry = this.entries.get(key);
    if (!entry) {
      entry = { timestamps: [], windowStart: now };
      this.entries.set(key, entry);
    }

    const windowStart = now - windowMs;
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);

    const currentCount = entry.timestamps.length;
    const isLimited = currentCount >= limit;
    const oldestTimestamp = entry.timestamps[0] || now;
    const resetInSeconds = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

    return {
      currentCount,
      maxRequests: limit,
      resetInSeconds: Math.max(0, resetInSeconds),
      isLimited,
    };
  }

  async record(key: string, maxRequests: number): Promise<RateLimitStatus> {
    const now = Date.now();
    const windowMs = this.config.windowSeconds * 1000;
    const limit = maxRequests;

    let entry = this.entries.get(key);
    if (!entry) {
      entry = { timestamps: [], windowStart: now };
      this.entries.set(key, entry);
    }

    const windowStart = now - windowMs;
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);
    entry.timestamps.push(now);

    const currentCount = entry.timestamps.length;
    const isLimited = currentCount > limit;
    const oldestTimestamp = entry.timestamps[0] || now;
    const resetInSeconds = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

    return {
      currentCount,
      maxRequests: limit,
      resetInSeconds: Math.max(0, resetInSeconds),
      isLimited,
    };
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    const windowMs = this.config.windowSeconds * 1000;
    const cutoff = now - windowMs * 2;

    for (const [key, entry] of this.entries) {
      if (entry.timestamps.length === 0 ||
          entry.timestamps[entry.timestamps.length - 1] < cutoff) {
        this.entries.delete(key);
      }
    }
  }

  getStats(): { totalKeys: number; totalRequests: number } {
    let totalRequests = 0;
    for (const entry of this.entries.values()) {
      totalRequests += entry.timestamps.length;
    }
    return { totalKeys: this.entries.size, totalRequests };
  }
}

// ============================================================================
// Upstash Rate Limiter Backend
// ============================================================================

class UpstashRateLimiter {
  private ratelimit: import('@upstash/ratelimit').Ratelimit;
  private defaultMaxRequests: number;

  constructor(ratelimit: import('@upstash/ratelimit').Ratelimit, defaultMaxRequests: number) {
    this.ratelimit = ratelimit;
    this.defaultMaxRequests = defaultMaxRequests;
  }

  async check(key: string, maxRequests: number): Promise<RateLimitStatus> {
    const result = await this.ratelimit.getRemaining(key);
    const limit = maxRequests ?? this.defaultMaxRequests;
    const remaining = typeof result === 'number' ? result : 0;

    return {
      currentCount: limit - remaining,
      maxRequests: limit,
      resetInSeconds: 60,
      isLimited: remaining <= 0,
    };
  }

  async record(key: string, maxRequests: number): Promise<RateLimitStatus> {
    const result = await this.ratelimit.limit(key);
    const limit = maxRequests ?? this.defaultMaxRequests;

    return {
      currentCount: limit - result.remaining,
      maxRequests: limit,
      resetInSeconds: Math.max(0, Math.ceil((result.reset - Date.now()) / 1000)),
      isLimited: !result.success,
    };
  }

  reset(key: string): void {
    this.ratelimit.resetUsedTokens(key).catch(() => {
      // Best-effort reset
    });
  }

  getStats(): { totalKeys: number; totalRequests: number } {
    // Upstash doesn't expose per-key enumeration; return zeroes.
    // Use Upstash analytics dashboard for production monitoring.
    return { totalKeys: 0, totalRequests: 0 };
  }
}

// ============================================================================
// Backend Initialization
// ============================================================================

let backend: RateLimiterBackend | null = null;

/**
 * Whether the per-instance in-memory limiter is acceptable. It is NOT safe for
 * distributed/serverless production (each instance keeps its own counters, so
 * the global limit is bypassable by fan-out). We therefore only allow it
 * outside production, OR when an operator explicitly opts in for a known
 * single-instance deployment via RATE_LIMIT_ALLOW_INMEMORY=true.
 */
function inMemoryFallbackAllowed(): boolean {
  if (process.env.RATE_LIMIT_ALLOW_INMEMORY === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

function getBackend(): RateLimiterBackend {
  if (backend) return backend;

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    try {
      // Dynamic imports are resolved at build time in Next.js; these packages
      // are listed in dependencies so the require calls work at runtime.
      const { Ratelimit } = require('@upstash/ratelimit') as typeof import('@upstash/ratelimit');
      const { Redis } = require('@upstash/redis') as typeof import('@upstash/redis');

      const redis = new Redis({ url: redisUrl, token: redisToken });
      const ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(DEFAULT_RATE_LIMIT, '60 s'),
        analytics: true,
        prefix: 'partner-api',
      });

      backend = new UpstashRateLimiter(ratelimit, DEFAULT_RATE_LIMIT);
      return backend;
    } catch (err) {
      // Fail closed in production: a distributed limiter that can't initialize
      // must not silently degrade to unenforceable per-instance limiting.
      if (!inMemoryFallbackAllowed()) {
        throw new Error(
          '[rate-limiter] Upstash rate limiter failed to initialize and in-memory ' +
          'fallback is disabled in production. Fix UPSTASH_REDIS_REST_URL/TOKEN, or ' +
          'set RATE_LIMIT_ALLOW_INMEMORY=true only for a single-instance deployment.'
        );
      }
      console.warn('[rate-limiter] Failed to initialize Upstash rate limiter, falling back to in-memory:', err);
    }
  } else if (!inMemoryFallbackAllowed()) {
    // Misconfiguration in production — fail fast rather than fail open.
    throw new Error(
      '[rate-limiter] UPSTASH_REDIS_REST_URL/TOKEN are required in production for ' +
      'distributed rate limiting. Set them, or set RATE_LIMIT_ALLOW_INMEMORY=true ' +
      'only for a single-instance deployment.'
    );
  } else {
    console.warn(
      '[rate-limiter] UPSTASH_REDIS_REST_URL is not set. Using in-memory rate limiter. ' +
      'This is fine for local development but NOT suitable for production with multiple server instances.'
    );
  }

  backend = new InMemoryRateLimiter();
  return backend;
}

// ============================================================================
// Public API (unchanged signatures, now async)
// ============================================================================

/**
 * Check rate limit for an API key (does not record a request)
 */
export function checkRateLimit(apiKey: ApiKey): Promise<RateLimitStatus> {
  const limiter = getBackend();
  const maxRequests = apiKey.rateLimitOverride ?? DEFAULT_RATE_LIMIT;
  return limiter.check(apiKey.id, maxRequests);
}

/**
 * Record a request and check rate limit
 */
export function recordAndCheckRateLimit(apiKey: ApiKey): Promise<RateLimitStatus> {
  const limiter = getBackend();
  const maxRequests = apiKey.rateLimitOverride ?? DEFAULT_RATE_LIMIT;
  return limiter.record(apiKey.id, maxRequests);
}

/**
 * Generate rate limit headers for response
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
 * Reset rate limit for an API key
 */
export function resetRateLimit(apiKeyId: string): void {
  const limiter = getBackend();
  limiter.reset(apiKeyId);
}

/**
 * Get rate limiter statistics
 */
export function getRateLimiterStats(): { totalKeys: number; totalRequests: number } {
  const limiter = getBackend();
  return limiter.getStats();
}

/**
 * Get the rate limiter backend instance (for advanced usage)
 */
export function getRateLimiter(): RateLimiterBackend {
  return getBackend();
}
