/**
 * Preservation Test — Partner API Route Structure
 *
 * Validates: Requirements 3.1
 *
 * This test establishes the baseline behavior of partner API routes
 * that MUST be preserved after fixes are applied. It uses static analysis
 * to verify:
 *   1. All partner route files exist and export expected HTTP method handlers
 *   2. Response patterns use NextResponse.json() with proper status codes
 *   3. Routes import and use validateApiRequest from middleware
 *
 * EXPECTED OUTCOME: All tests PASS on unfixed code (confirms baseline).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import fc from 'fast-check';

// ============================================================================
// Route Definitions — Observed Baseline
// ============================================================================

interface RouteDefinition {
  /** Relative path from project root */
  filePath: string;
  /** HTTP methods exported as named functions */
  expectedMethods: string[];
  /** Required scopes used in validateApiRequest calls */
  expectedScopes: string[];
  /** Status codes used in NextResponse.json() calls */
  expectedStatusCodes: number[];
}

const PARTNER_ROUTES: RouteDefinition[] = [
  {
    filePath: 'src/app/client/api/v1/partner/branches/route.ts',
    expectedMethods: ['GET'],
    expectedScopes: ['branches:read'],
    expectedStatusCodes: [200, 403, 404, 500],
  },
  {
    filePath: 'src/app/client/api/v1/partner/calls/route.ts',
    expectedMethods: ['GET'],
    expectedScopes: ['calls:read'],
    expectedStatusCodes: [200, 400, 403, 500],
  },
  {
    filePath: 'src/app/client/api/v1/partner/menus/route.ts',
    expectedMethods: ['GET'],
    expectedScopes: ['menus:read'],
    expectedStatusCodes: [200, 400, 403, 500],
  },
  {
    filePath: 'src/app/client/api/v1/partner/orders/route.ts',
    expectedMethods: ['GET'],
    expectedScopes: ['orders:read'],
    expectedStatusCodes: [200, 400, 403, 500],
  },
  {
    filePath: 'src/app/client/api/v1/partner/orders/[orderId]/route.ts',
    expectedMethods: ['GET'],
    expectedScopes: ['orders:read'],
    expectedStatusCodes: [200, 403, 404, 500],
  },
  {
    filePath: 'src/app/client/api/v1/partner/restaurants/route.ts',
    expectedMethods: ['GET', 'OPTIONS'],
    expectedScopes: ['restaurants:read'],
    expectedStatusCodes: [200, 404, 500],
  },
  {
    filePath: 'src/app/client/api/v1/partner/restaurants/[restaurantId]/route.ts',
    expectedMethods: ['GET'],
    expectedScopes: ['restaurants:read'],
    expectedStatusCodes: [200, 403, 404, 500],
  },
  {
    filePath: 'src/app/client/api/v1/partner/webhooks/route.ts',
    expectedMethods: ['GET', 'POST'],
    expectedScopes: ['webhooks:manage'],
    expectedStatusCodes: [200, 201, 400, 500],
  },
  {
    filePath: 'src/app/client/api/v1/partner/webhooks/[subscriptionId]/route.ts',
    expectedMethods: ['GET', 'PATCH', 'DELETE'],
    expectedScopes: ['webhooks:manage'],
    expectedStatusCodes: [200, 400, 403, 404, 500],
  },
];

// ============================================================================
// Helpers
// ============================================================================

function readRouteFile(filePath: string): string {
  const fullPath = path.resolve(process.cwd(), filePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Extract exported async function names from source (e.g., `export async function GET`)
 */
function extractExportedMethods(source: string): string[] {
  const regex = /export\s+async\s+function\s+(\w+)/g;
  const methods: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    methods.push(match[1]);
  }
  return methods;
}

/**
 * Extract status codes from NextResponse.json() calls
 * Matches patterns like: `{ status: 200 }` or `{ status: 500 }`
 */
function extractStatusCodes(source: string): number[] {
  const regex = /\{\s*status:\s*(\d{3})\s*[,}]/g;
  const codes = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    codes.add(parseInt(match[1], 10));
  }
  return Array.from(codes).sort((a, b) => a - b);
}

/**
 * Check if source imports validateApiRequest from middleware
 */
function importsValidateApiRequest(source: string): boolean {
  return /import\s+\{[^}]*validateApiRequest[^}]*\}\s+from\s+['"]@\/lib\/partner-api\/middleware['"]/.test(source);
}

/**
 * Check if source calls validateApiRequest
 */
function callsValidateApiRequest(source: string): boolean {
  return /validateApiRequest\s*\(/.test(source);
}

/**
 * Check if source imports rate limiter functions
 */
function importsRateLimiter(source: string): boolean {
  return /import\s+\{[^}]*getRateLimitHeaders[^}]*\}\s+from\s+['"]@\/lib\/partner-api\/rate-limiter['"]/.test(source);
}

/**
 * Check if source imports ApiErrorResponse and ApiSuccessResponse from types
 */
function importsResponseTypes(source: string): boolean {
  return /import\s+type\s+\{[^}]*ApiErrorResponse[^}]*ApiSuccessResponse[^}]*\}\s+from\s+['"]@\/lib\/partner-api\/types['"]/.test(source)
    || /import\s+type\s+\{[^}]*ApiSuccessResponse[^}]*ApiErrorResponse[^}]*\}\s+from\s+['"]@\/lib\/partner-api\/types['"]/.test(source);
}

/**
 * Check if source uses success: true pattern in responses
 */
function usesSuccessTruePattern(source: string): boolean {
  return /success:\s*true\s+as\s+const/.test(source);
}

/**
 * Check if source uses error response shape { error: ..., message: ... }
 */
function usesErrorResponseShape(source: string): boolean {
  return /\{\s*error:\s*['"][^'"]+['"]\s*,\s*message:/.test(source);
}

/**
 * Extract required scopes from validateApiRequest calls
 */
function extractRequiredScopes(source: string): string[] {
  const regex = /requiredScopes:\s*\[([^\]]+)\]/g;
  const scopes = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const scopeList = match[1];
    const scopeRegex = /['"]([^'"]+)['"]/g;
    let scopeMatch: RegExpExecArray | null;
    while ((scopeMatch = scopeRegex.exec(scopeList)) !== null) {
      scopes.add(scopeMatch[1]);
    }
  }
  return Array.from(scopes);
}

// ============================================================================
// Tests
// ============================================================================

describe('Partner API Preservation — Route Structure Baseline', () => {
  // ---- 1. All route files exist ----
  describe('1. Route files exist', () => {
    for (const route of PARTNER_ROUTES) {
      it(`${route.filePath} exists`, () => {
        const fullPath = path.resolve(process.cwd(), route.filePath);
        expect(fs.existsSync(fullPath), `Route file missing: ${route.filePath}`).toBe(true);
      });
    }
  });

  // ---- 2. HTTP method exports match observed baseline ----
  describe('2. HTTP method exports', () => {
    for (const route of PARTNER_ROUTES) {
      it(`${route.filePath} exports ${route.expectedMethods.join(', ')}`, () => {
        const source = readRouteFile(route.filePath);
        const exported = extractExportedMethods(source);
        for (const method of route.expectedMethods) {
          expect(exported, `Missing export: ${method} in ${route.filePath}`).toContain(method);
        }
      });
    }
  });

  // ---- 3. All routes import and call validateApiRequest ----
  describe('3. Middleware integration (validateApiRequest)', () => {
    for (const route of PARTNER_ROUTES) {
      it(`${route.filePath} imports validateApiRequest from middleware`, () => {
        const source = readRouteFile(route.filePath);
        expect(
          importsValidateApiRequest(source),
          `${route.filePath} does not import validateApiRequest from @/lib/partner-api/middleware`
        ).toBe(true);
      });

      it(`${route.filePath} calls validateApiRequest`, () => {
        const source = readRouteFile(route.filePath);
        expect(
          callsValidateApiRequest(source),
          `${route.filePath} does not call validateApiRequest()`
        ).toBe(true);
      });
    }
  });

  // ---- 4. All routes import rate limiter ----
  describe('4. Rate limiter integration', () => {
    for (const route of PARTNER_ROUTES) {
      it(`${route.filePath} imports getRateLimitHeaders from rate-limiter`, () => {
        const source = readRouteFile(route.filePath);
        expect(
          importsRateLimiter(source),
          `${route.filePath} does not import getRateLimitHeaders from @/lib/partner-api/rate-limiter`
        ).toBe(true);
      });
    }
  });

  // ---- 5. All routes import response types ----
  describe('5. Response type imports', () => {
    for (const route of PARTNER_ROUTES) {
      it(`${route.filePath} imports ApiErrorResponse and ApiSuccessResponse from types`, () => {
        const source = readRouteFile(route.filePath);
        expect(
          importsResponseTypes(source),
          `${route.filePath} does not import ApiErrorResponse/ApiSuccessResponse from @/lib/partner-api/types`
        ).toBe(true);
      });
    }
  });

  // ---- 6. Response patterns ----
  describe('6. Response patterns', () => {
    for (const route of PARTNER_ROUTES) {
      it(`${route.filePath} uses success: true as const in success responses`, () => {
        const source = readRouteFile(route.filePath);
        expect(
          usesSuccessTruePattern(source),
          `${route.filePath} does not use 'success: true as const' pattern`
        ).toBe(true);
      });

      it(`${route.filePath} uses { error, message } shape in error responses`, () => {
        const source = readRouteFile(route.filePath);
        expect(
          usesErrorResponseShape(source),
          `${route.filePath} does not use { error, message } error response shape`
        ).toBe(true);
      });
    }
  });

  // ---- 7. Status codes match observed baseline ----
  describe('7. Status codes', () => {
    for (const route of PARTNER_ROUTES) {
      it(`${route.filePath} uses expected status codes: [${route.expectedStatusCodes.join(', ')}]`, () => {
        const source = readRouteFile(route.filePath);
        const actual = extractStatusCodes(source);
        for (const code of route.expectedStatusCodes) {
          expect(actual, `Missing status code ${code} in ${route.filePath}`).toContain(code);
        }
      });
    }
  });

  // ---- 8. Required scopes match observed baseline ----
  describe('8. Required scopes', () => {
    for (const route of PARTNER_ROUTES) {
      it(`${route.filePath} requires scopes: [${route.expectedScopes.join(', ')}]`, () => {
        const source = readRouteFile(route.filePath);
        const actual = extractRequiredScopes(source);
        for (const scope of route.expectedScopes) {
          expect(actual, `Missing required scope '${scope}' in ${route.filePath}`).toContain(scope);
        }
      });
    }
  });

  // ---- 9. Property-based: for any valid route from the set, structural invariants hold ----
  describe('9. Property: structural invariants hold for all partner routes', () => {
    /**
     * **Validates: Requirements 3.1**
     *
     * Property: For all partner API route files, the following structural
     * invariants hold simultaneously:
     *   - File exists
     *   - Exports at least one HTTP method handler
     *   - Imports and calls validateApiRequest
     *   - Imports rate limiter functions
     *   - Imports response types
     *   - Uses success: true as const pattern
     *   - Uses { error, message } error shape
     *   - Contains all expected status codes
     */
    const routeArbitrary = fc.constantFrom(...PARTNER_ROUTES);

    it('all structural invariants hold for any partner route', () => {
      fc.assert(
        fc.property(routeArbitrary, (route) => {
          const fullPath = path.resolve(process.cwd(), route.filePath);
          expect(fs.existsSync(fullPath)).toBe(true);

          const source = readRouteFile(route.filePath);

          // Exports expected methods
          const exported = extractExportedMethods(source);
          for (const method of route.expectedMethods) {
            expect(exported).toContain(method);
          }

          // Imports and calls validateApiRequest
          expect(importsValidateApiRequest(source)).toBe(true);
          expect(callsValidateApiRequest(source)).toBe(true);

          // Imports rate limiter
          expect(importsRateLimiter(source)).toBe(true);

          // Imports response types
          expect(importsResponseTypes(source)).toBe(true);

          // Uses correct response patterns
          expect(usesSuccessTruePattern(source)).toBe(true);
          expect(usesErrorResponseShape(source)).toBe(true);

          // Contains expected status codes
          const actualCodes = extractStatusCodes(source);
          for (const code of route.expectedStatusCodes) {
            expect(actualCodes).toContain(code);
          }

          // Contains expected scopes
          const actualScopes = extractRequiredScopes(source);
          for (const scope of route.expectedScopes) {
            expect(actualScopes).toContain(scope);
          }
        }),
        { numRuns: PARTNER_ROUTES.length * 3 }
      );
    });
  });
});
