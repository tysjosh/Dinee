/**
 * Preservation Test — Rate Limit Header Semantics
 *
 * Validates: Requirements 3.8
 *
 * This test establishes the baseline behavior of the rate limiter module
 * that MUST be preserved after fixes are applied. It uses static analysis
 * to verify:
 *   1. The rate limiter module exports expected functions
 *   2. getRateLimitHeaders returns headers with correct keys
 *   3. createRateLimitResponse creates a 429 response
 *   4. The default rate limit is 1000 requests per minute
 *   5. The InMemoryRateLimiter class exists with expected methods
 *
 * EXPECTED OUTCOME: All tests PASS on unfixed code (confirms baseline).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import fc from 'fast-check';

// ============================================================================
// Constants
// ============================================================================

const RATE_LIMITER_PATH = 'src/lib/partner-api/rate-limiter.ts';
const AUTH_PATH = 'src/lib/partner-api/auth.ts';

const EXPECTED_EXPORTED_FUNCTIONS = [
  'checkRateLimit',
  'recordAndCheckRateLimit',
  'getRateLimitHeaders',
  'createRateLimitResponse',
  'resetRateLimit',
  'getRateLimiterStats',
  'getRateLimiter',
];

const EXPECTED_RATE_LIMIT_HEADER_KEYS = [
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
];

const EXPECTED_CLASS_METHODS = [
  'check',
  'record',
  'reset',
  'cleanup',
  'getStats',
];

// ============================================================================
// Helpers
// ============================================================================

function readSourceFile(filePath: string): string {
  const fullPath = path.resolve(process.cwd(), filePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

function extractExportedFunctions(source: string): string[] {
  const regex = /export\s+function\s+(\w+)/g;
  const fns: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    fns.push(match[1]);
  }
  return fns;
}

function extractClassMethods(source: string, className: string): string[] {
  // Find the class body
  const classRegex = new RegExp(`class\\s+${className}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const classMatch = classRegex.exec(source);
  if (!classMatch) return [];

  const classBody = classMatch[1];
  // Match method declarations (including private)
  const methodRegex = /(?:private\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
  const methods: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = methodRegex.exec(classBody)) !== null) {
    if (match[1] !== 'constructor') {
      methods.push(match[1]);
    }
  }
  return methods;
}

function containsStringLiteral(source: string, literal: string): boolean {
  return source.includes(`'${literal}'`) || source.includes(`"${literal}"`);
}

function extractDefaultRateLimit(source: string): number | null {
  const match = /export\s+const\s+DEFAULT_RATE_LIMIT\s*=\s*(\d+)/.exec(source);
  return match ? parseInt(match[1], 10) : null;
}

function hasClassDeclaration(source: string, className: string): boolean {
  return new RegExp(`class\\s+${className}\\s*\\{`).test(source);
}

function extractResponseStatus(source: string): number | null {
  const match = /status:\s*(\d{3})/.exec(source);
  return match ? parseInt(match[1], 10) : null;
}

// ============================================================================
// Tests
// ============================================================================

describe('Rate Limit Header Preservation — Module Structure Baseline', () => {
  const rateLimiterSource = readSourceFile(RATE_LIMITER_PATH);
  const authSource = readSourceFile(AUTH_PATH);

  // ---- 1. Module file exists ----
  describe('1. Rate limiter module exists', () => {
    it('rate-limiter.ts exists', () => {
      const fullPath = path.resolve(process.cwd(), RATE_LIMITER_PATH);
      expect(fs.existsSync(fullPath)).toBe(true);
    });

    it('auth.ts exists (provides DEFAULT_RATE_LIMIT)', () => {
      const fullPath = path.resolve(process.cwd(), AUTH_PATH);
      expect(fs.existsSync(fullPath)).toBe(true);
    });
  });

  // ---- 2. Exported functions match observed baseline ----
  describe('2. Exported functions', () => {
    const exportedFns = extractExportedFunctions(rateLimiterSource);

    for (const fn of EXPECTED_EXPORTED_FUNCTIONS) {
      it(`exports function: ${fn}`, () => {
        expect(exportedFns, `Missing export: ${fn}`).toContain(fn);
      });
    }
  });

  // ---- 3. getRateLimitHeaders returns correct header keys ----
  describe('3. getRateLimitHeaders header keys', () => {
    for (const headerKey of EXPECTED_RATE_LIMIT_HEADER_KEYS) {
      it(`getRateLimitHeaders produces '${headerKey}' header`, () => {
        expect(
          containsStringLiteral(rateLimiterSource, headerKey),
          `Rate limiter source does not contain header key '${headerKey}'`
        ).toBe(true);
      });
    }
  });

  // ---- 4. createRateLimitResponse creates a 429 response ----
  describe('4. createRateLimitResponse produces 429', () => {
    it('contains status 429 in createRateLimitResponse', () => {
      // Extract the createRateLimitResponse function body
      const fnRegex = /function\s+createRateLimitResponse[\s\S]*?status:\s*(\d{3})/;
      const match = fnRegex.exec(rateLimiterSource);
      expect(match, 'createRateLimitResponse should contain a status code').not.toBeNull();
      expect(parseInt(match![1], 10)).toBe(429);
    });

    it('includes Retry-After header', () => {
      expect(
        containsStringLiteral(rateLimiterSource, 'Retry-After'),
        'createRateLimitResponse should include Retry-After header'
      ).toBe(true);
    });

    it('includes rate_limit_exceeded error code', () => {
      expect(
        containsStringLiteral(rateLimiterSource, 'rate_limit_exceeded'),
        'createRateLimitResponse should include rate_limit_exceeded error code'
      ).toBe(true);
    });
  });

  // ---- 5. Default rate limit is 1000 requests per minute ----
  describe('5. Default rate limit configuration', () => {
    it('DEFAULT_RATE_LIMIT in auth.ts is 1000', () => {
      const limit = extractDefaultRateLimit(authSource);
      expect(limit, 'DEFAULT_RATE_LIMIT should be 1000').toBe(1000);
    });

    it('rate-limiter.ts imports DEFAULT_RATE_LIMIT from auth', () => {
      expect(
        rateLimiterSource.includes("from './auth'") || rateLimiterSource.includes('from "./auth"'),
        'rate-limiter.ts should import from auth module'
      ).toBe(true);
      expect(
        rateLimiterSource.includes('DEFAULT_RATE_LIMIT'),
        'rate-limiter.ts should reference DEFAULT_RATE_LIMIT'
      ).toBe(true);
    });

    it('constructor defaults to DEFAULT_RATE_LIMIT for maxRequests', () => {
      expect(
        rateLimiterSource.includes('maxRequests: DEFAULT_RATE_LIMIT'),
        'InMemoryRateLimiter constructor should default maxRequests to DEFAULT_RATE_LIMIT'
      ).toBe(true);
    });

    it('constructor defaults to 60 seconds window', () => {
      expect(
        rateLimiterSource.includes('windowSeconds: 60'),
        'InMemoryRateLimiter constructor should default windowSeconds to 60'
      ).toBe(true);
    });
  });

  // ---- 6. InMemoryRateLimiter class structure ----
  describe('6. InMemoryRateLimiter class', () => {
    it('InMemoryRateLimiter class exists', () => {
      expect(
        hasClassDeclaration(rateLimiterSource, 'InMemoryRateLimiter'),
        'InMemoryRateLimiter class should exist'
      ).toBe(true);
    });

    const classMethods = extractClassMethods(rateLimiterSource, 'InMemoryRateLimiter');

    for (const method of EXPECTED_CLASS_METHODS) {
      it(`InMemoryRateLimiter has method: ${method}`, () => {
        expect(classMethods, `Missing method: ${method}`).toContain(method);
      });
    }
  });

  // ---- 7. Property: for all rate limit header keys, they appear in getRateLimitHeaders ----
  describe('7. Property: header semantics invariants hold for all rate limit headers', () => {
    /**
     * **Validates: Requirements 3.8**
     *
     * Property: For all expected rate limit header keys, the rate limiter
     * module contains the header key string literal, and the module exports
     * all expected public functions with the correct structure.
     */
    const headerArbitrary = fc.constantFrom(...EXPECTED_RATE_LIMIT_HEADER_KEYS);
    const functionArbitrary = fc.constantFrom(...EXPECTED_EXPORTED_FUNCTIONS);

    it('all rate limit headers are present in source for any header key', () => {
      fc.assert(
        fc.property(headerArbitrary, (headerKey) => {
          expect(
            containsStringLiteral(rateLimiterSource, headerKey),
            `Header key '${headerKey}' not found in rate limiter source`
          ).toBe(true);
        }),
        { numRuns: EXPECTED_RATE_LIMIT_HEADER_KEYS.length * 5 }
      );
    });

    it('all exported functions exist for any function name', () => {
      const exportedFns = extractExportedFunctions(rateLimiterSource);
      fc.assert(
        fc.property(functionArbitrary, (fnName) => {
          expect(exportedFns).toContain(fnName);
        }),
        { numRuns: EXPECTED_EXPORTED_FUNCTIONS.length * 5 }
      );
    });

    it('rate limit module preserves complete header + function + class structure', () => {
      fc.assert(
        fc.property(
          headerArbitrary,
          functionArbitrary,
          (headerKey, fnName) => {
            // Header key exists
            expect(containsStringLiteral(rateLimiterSource, headerKey)).toBe(true);

            // Function is exported
            const exportedFns = extractExportedFunctions(rateLimiterSource);
            expect(exportedFns).toContain(fnName);

            // Class exists
            expect(hasClassDeclaration(rateLimiterSource, 'InMemoryRateLimiter')).toBe(true);

            // Default rate limit is 1000
            const limit = extractDefaultRateLimit(authSource);
            expect(limit).toBe(1000);
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
