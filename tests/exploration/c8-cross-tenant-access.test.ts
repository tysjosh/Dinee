/**
 * Bug Condition Exploration Test — C8: Cross-Tenant Access via Partner API
 *
 * Validates: Requirements 1.9
 *
 * The partner API middleware (`validateApiRequest` in middleware.ts) validates
 * API keys and scopes but does NOT enforce that the authenticated partner's
 * `restaurantIds` includes the requested resource. There is no centralized
 * `authorizeResourceAccess()` utility — the expected fix (per bugfix.md §2.9)
 * is a shared function that every route handler calls before any read/write.
 *
 * This test performs static analysis on:
 *   1. The middleware itself — verifying it delegates to `authorizeResourceAccess`
 *   2. All partner route handler source files — verifying each calls
 *      `authorizeResourceAccess` (the centralized utility) before data access
 *
 * EXPECTED OUTCOME on unfixed code: Test FAILS —
 *   - The middleware has no `authorizeResourceAccess` call
 *   - No route handler imports or calls `authorizeResourceAccess`
 *   - The centralized authorization module does not exist
 *
 * When the authorizeResourceAccess fix is applied (task 7), these tests should PASS.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Constants — all partner route handler files
// ---------------------------------------------------------------------------

const PARTNER_ROUTE_FILES = [
  'src/app/client/api/v1/partner/branches/route.ts',
  'src/app/client/api/v1/partner/calls/route.ts',
  'src/app/client/api/v1/partner/menus/route.ts',
  'src/app/client/api/v1/partner/orders/route.ts',
  'src/app/client/api/v1/partner/orders/[orderId]/route.ts',
  'src/app/client/api/v1/partner/restaurants/route.ts',
  'src/app/client/api/v1/partner/restaurants/[restaurantId]/route.ts',
  'src/app/client/api/v1/partner/webhooks/route.ts',
  'src/app/client/api/v1/partner/webhooks/[subscriptionId]/route.ts',
] as const;

const MIDDLEWARE_PATH = 'src/lib/partner-api/middleware.ts';
const AUTHORIZATION_MODULE_PATH = 'src/lib/partner-api/authorization.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSource(relativePath: string): string {
  const fullPath = resolve(process.cwd(), relativePath);
  return readFileSync(fullPath, 'utf-8');
}

/**
 * Check whether source code references a centralized tenant authorization
 * function. We look for either:
 *   - `authorizeResourceAccess` (the expected utility name from the spec)
 *   - An import from `@/lib/partner-api/authorization` or `../authorization`
 */
function hasCentralizedAuthCheck(source: string): boolean {
  return (
    source.includes('authorizeResourceAccess') ||
    source.includes('from \'@/lib/partner-api/authorization\'') ||
    source.includes('from "@/lib/partner-api/authorization"') ||
    source.includes('from \'../authorization\'') ||
    source.includes('from "../authorization"')
  );
}

// ---------------------------------------------------------------------------
// C8: Cross-Tenant Access — Centralized Authorization Module Exists
// ---------------------------------------------------------------------------

describe('C8: Cross-Tenant Access — Exploration Test', () => {
  /**
   * **Validates: Requirements 1.9**
   *
   * A centralized `authorizeResourceAccess` module should exist at
   * `src/lib/partner-api/authorization.ts`. On unfixed code, this file
   * does not exist.
   */
  it('centralized authorization module (authorization.ts) should exist', () => {
    const fullPath = resolve(process.cwd(), AUTHORIZATION_MODULE_PATH);
    const exists = existsSync(fullPath);

    console.log('\n=== ANALYSIS: Centralized Authorization Module ===');
    console.log(`Path: ${AUTHORIZATION_MODULE_PATH}`);
    console.log(`Exists: ${exists}`);

    if (!exists) {
      console.log(
        'COUNTEREXAMPLE: No centralized authorizeResourceAccess module exists. ' +
        'Per §2.9, a shared utility should verify partner ownership of every ' +
        'requested resource before any read/write operation.'
      );
    }
    console.log('=== END ANALYSIS ===\n');

    expect(
      exists,
      `${AUTHORIZATION_MODULE_PATH} does not exist — there is no centralized ` +
      `tenant authorization utility. Each route must implement its own ad-hoc ` +
      `ownership check (or skip it entirely), violating the single-enforcement-point ` +
      `requirement (C8 / §2.9).`
    ).toBe(true);
  });

  /**
   * **Validates: Requirements 1.9**
   *
   * The middleware should reference `authorizeResourceAccess` or delegate
   * tenant checks to the centralized module. On unfixed code, the middleware
   * only validates API key + scopes — no tenant ownership verification.
   */
  it('middleware.ts should reference authorizeResourceAccess for tenant checks', () => {
    const source = readSource(MIDDLEWARE_PATH);
    const hasAuth = hasCentralizedAuthCheck(source);

    console.log('\n=== ANALYSIS: middleware.ts tenant authorization ===');
    console.log(`References authorizeResourceAccess: ${hasAuth}`);

    if (!hasAuth) {
      console.log(
        'COUNTEREXAMPLE: middleware.ts validates API key and scopes but never ' +
        'references authorizeResourceAccess or imports from the authorization ' +
        'module. After key+scope validation, there is no tenant ownership check — ' +
        'a partner authorized for restaurant R001 can request data for R002.'
      );
    }
    console.log('=== END ANALYSIS ===\n');

    expect(
      hasAuth,
      `middleware.ts does not reference authorizeResourceAccess — after API key ` +
      `and scope validation, there is no tenant ownership verification. A partner ` +
      `authorized for restaurant R001 could access R002's data (C8 / §2.9).`
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Per-route handler checks
  // -------------------------------------------------------------------------

  for (const routeFile of PARTNER_ROUTE_FILES) {
    /**
     * **Validates: Requirements 1.9**
     *
     * Every partner route handler should call `authorizeResourceAccess()`
     * before performing any read/write operation. On unfixed code, none of
     * them import or call this function — they either do ad-hoc platformId
     * checks or skip tenant verification entirely.
     */
    it(`${routeFile} should call authorizeResourceAccess before data access`, () => {
      const source = readSource(routeFile);
      const hasAuth = hasCentralizedAuthCheck(source);

      console.log(`\n=== ANALYSIS: ${routeFile} ===`);
      console.log(`Calls authorizeResourceAccess: ${hasAuth}`);

      if (!hasAuth) {
        // Detect if there's any ad-hoc ownership check
        const hasAdHocCheck =
          source.includes('restaurantIds') &&
          source.includes('.includes(');
        const hasPlatformCheck = source.includes('platformId');

        console.log(`Has ad-hoc restaurantIds.includes() check: ${hasAdHocCheck}`);
        console.log(`Has platformId check: ${hasPlatformCheck}`);
        console.log(
          `COUNTEREXAMPLE: ${routeFile} does not use the centralized ` +
          `authorizeResourceAccess utility. ` +
          (hasAdHocCheck
            ? 'It has an ad-hoc restaurantIds check, but this is not the ' +
              'single-enforcement-point required by §2.9.'
            : 'It has NO tenant ownership verification at all — cross-tenant ' +
              'access is possible.')
        );
      }
      console.log('=== END ANALYSIS ===\n');

      expect(
        hasAuth,
        `${routeFile} does not call authorizeResourceAccess() — there is no ` +
        `centralized tenant authorization check before data access. Per §2.9, ` +
        `every route handler must call authorizeResourceAccess() as the single ` +
        `enforcement point (C8).`
      ).toBe(true);
    });
  }
});
