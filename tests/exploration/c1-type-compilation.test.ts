/**
 * Bug Condition Exploration Test — C1: Type System Drift
 *
 * Validates: Requirements 1.1, 1.2
 *
 * This test runs `npx tsc --noEmit` and asserts 0 type errors across files
 * that import from `@/lib/partner-api/types`.
 *
 * EXPECTED OUTCOME on unfixed code: Test FAILS — the TypeScript compiler
 * produces errors for missing/misnamed type exports:
 *   - `ApiKey` vs `APIKey`
 *   - Missing `ApiErrorResponse`, `ApiSuccessResponse`
 *   - Missing `ApiKeyValidationResult`, `RateLimitHeaders`
 *   - Missing `ApiRequestContext`, `OAuthClient`, `OAuthAccessToken`, `OAuthTokenRequest`
 *   - Mismatched `RateLimitStatus` fields (`currentCount`, `maxRequests`, `resetInSeconds`, `isLimited` vs `remaining`, `limit`, `resetAt`, `exceeded`)
 *
 * When the type normalization fix is applied, this test should PASS.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

/**
 * Files that directly import from `@/lib/partner-api/types` or `./types`
 * (relative within the partner-api directory).
 */
const PARTNER_API_CONSUMER_FILES = [
  'src/lib/partner-api/auth.ts',
  'src/lib/partner-api/middleware.ts',
  'src/lib/partner-api/rate-limiter.ts',
  'src/lib/partner-api/webhook-service.ts',
  'src/app/client/api/v1/partner/branches/route.ts',
  'src/app/client/api/v1/partner/calls/route.ts',
  'src/app/client/api/v1/partner/menus/route.ts',
  'src/app/client/api/v1/partner/orders/route.ts',
  'src/app/client/api/v1/partner/orders/[orderId]/route.ts',
  'src/app/client/api/v1/partner/restaurants/route.ts',
  'src/app/client/api/v1/partner/restaurants/[restaurantId]/route.ts',
  'src/app/client/api/v1/partner/webhooks/route.ts',
  'src/app/client/api/v1/partner/webhooks/[subscriptionId]/route.ts',
];

describe('C1: Type System Drift — Exploration Test', () => {
  it('should produce 0 type errors across files importing from @/lib/partner-api/types', () => {
    let tscOutput = '';
    try {
      tscOutput = execSync('npx tsc --noEmit 2>&1', {
        encoding: 'utf-8',
        timeout: 60000,
      });
    } catch (error: unknown) {
      // tsc exits with code 2 when there are type errors — capture stdout
      if (error && typeof error === 'object' && 'stdout' in error) {
        tscOutput = (error as { stdout: string }).stdout || '';
      }
    }

    // Parse all TS error lines
    const errorLines = tscOutput
      .split('\n')
      .filter((line) => line.includes('error TS'));

    // Filter to only errors in files that import from partner-api/types
    const partnerApiTypeErrors = errorLines.filter((line) =>
      PARTNER_API_CONSUMER_FILES.some((file) => line.includes(file))
    );

    // Document all counterexamples found
    if (partnerApiTypeErrors.length > 0) {
      console.log('\n=== COUNTEREXAMPLES: Type errors in partner-api/types consumers ===');
      console.log(`Total type errors found: ${partnerApiTypeErrors.length}`);
      console.log('');

      // Group errors by file
      const errorsByFile = new Map<string, string[]>();
      for (const errorLine of partnerApiTypeErrors) {
        const fileMatch = errorLine.match(/^([^(]+)\(/);
        const file = fileMatch ? fileMatch[1] : 'unknown';
        if (!errorsByFile.has(file)) {
          errorsByFile.set(file, []);
        }
        errorsByFile.get(file)!.push(errorLine);
      }

      for (const [file, errors] of errorsByFile) {
        console.log(`--- ${file} (${errors.length} errors) ---`);
        for (const err of errors) {
          console.log(`  ${err}`);
        }
        console.log('');
      }

      console.log('=== END COUNTEREXAMPLES ===\n');
    }

    // Assert 0 type errors — this SHOULD FAIL on unfixed code
    expect(
      partnerApiTypeErrors.length,
      `Expected 0 type errors in partner-api/types consumers, but found ${partnerApiTypeErrors.length}. ` +
      `This confirms the type drift bug (C1) exists. Errors:\n${partnerApiTypeErrors.join('\n')}`
    ).toBe(0);
  });
});
