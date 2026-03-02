/**
 * Bug Condition Exploration Test — C2: Fail-Open Internal Auth, C3: Missing x-api-key Header
 *
 * Validates: Requirements 1.3, 1.4
 *
 * C2: Tests that internal-use route handlers reject requests with HTTP 500
 * when INTERNAL_API_KEY is not set in a non-development environment.
 * The current validateApiKey() returns true when expectedKey is undefined,
 * regardless of NODE_ENV — this is a fail-open security bug.
 *
 * C3: Tests that ws-server wrapper functions include the `x-api-key` header
 * in their fetch calls to internal API routes.
 *
 * EXPECTED OUTCOME on unfixed code: Tests FAIL —
 *   - C2: validateApiKey returns true (fail-open) when INTERNAL_API_KEY is unset,
 *     meaning routes return 200 instead of 500 in production
 *   - C3: Wrapper functions do not include x-api-key header in fetch calls
 *
 * When the internal auth hardening fix is applied, these tests should PASS.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// C2: Fail-open internal auth
// ---------------------------------------------------------------------------

// We now test the actual validateInternalApiKey function from src/lib/internal-auth.ts
// which implements fail-closed behavior. We mock NextRequest and environment variables
// to verify the function rejects requests when INTERNAL_API_KEY is unset in production.

describe('C2: Fail-Open Internal Auth — Exploration Test', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset module cache so env changes take effect on re-import
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should reject requests (return false) when INTERNAL_API_KEY is unset in production', async () => {
    // Simulate: NODE_ENV=production, INTERNAL_API_KEY is undefined, no header sent
    // The CORRECT behavior: validateInternalApiKey should return { valid: false }
    // so the route returns 500 for misconfiguration.
    //
    // The ACTUAL behavior on unfixed code: returns true (fail-open),
    // allowing unauthenticated access.

    delete process.env.INTERNAL_API_KEY;
    process.env.NODE_ENV = 'production';

    const { validateInternalApiKey } = await import('../../src/lib/internal-auth');

    // Create a minimal NextRequest-like object with headers
    const mockRequest = {
      headers: new Headers(),
    } as any;

    const result = validateInternalApiKey(mockRequest);

    // This assertion encodes the CORRECT expected behavior:
    // When INTERNAL_API_KEY is not configured in a non-dev environment,
    // the function should NOT allow the request through.
    expect(
      result.valid,
      'validateInternalApiKey returns valid=true when INTERNAL_API_KEY is undefined in production — ' +
      'this is a fail-open security bug (C2). In production with no key configured, ' +
      'requests should be REJECTED (valid: false), not allowed.'
    ).toBe(false);
  });

  it('should verify all 7 internal-use route files contain fail-closed logic', () => {
    // All internal-use route handlers should check NODE_ENV before
    // allowing requests when INTERNAL_API_KEY is unset.
    // On unfixed code, none of them do — they all return true unconditionally.

    const routeFiles = [
      'src/app/client/api/v1/(internal-use)/upsert-order/route.ts',
      'src/app/client/api/v1/(internal-use)/upsert-call/route.ts',
      'src/app/client/api/v1/(internal-use)/add-transcript-dialogue/route.ts',
      'src/app/client/api/v1/(internal-use)/check-blocked/route.ts',
      'src/app/client/api/v1/(internal-use)/match-prompts/route.ts',
      'src/app/client/api/v1/(internal-use)/record-prompt-acceptance/route.ts',
      'src/app/client/api/v1/(internal-use)/get-restaurant-data/[id]/route.ts',
    ];

    const routesWithFailOpen: string[] = [];

    for (const routeFile of routeFiles) {
      const fullPath = resolve(process.cwd(), routeFile);
      const source = readFileSync(fullPath, 'utf-8');

      // The fail-open pattern: when expectedKey is falsy, return true
      // without checking NODE_ENV. This means production with no key = open access.
      const hasFailOpenPattern =
        source.includes('if (!expectedKey)') &&
        source.includes('return true') &&
        !source.includes('NODE_ENV');

      if (hasFailOpenPattern) {
        routesWithFailOpen.push(routeFile);
      }
    }

    // The CORRECT behavior: 0 routes should have the fail-open pattern.
    // They should all check NODE_ENV before allowing keyless access.
    //
    // On unfixed code: all 7 routes have the fail-open pattern.
    expect(
      routesWithFailOpen.length,
      `Expected 0 routes with fail-open auth pattern, but found ${routesWithFailOpen.length}. ` +
      `Routes with fail-open bug:\n${routesWithFailOpen.map(r => `  - ${r}`).join('\n')}\n` +
      'This confirms the fail-open security bug (C2) exists in all internal-use routes.'
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C3: Missing x-api-key header in ws-server wrapper functions
// ---------------------------------------------------------------------------

describe('C3: Missing x-api-key Header in ws-server Wrappers — Exploration Test', () => {
  it('should verify all ws-server wrapper functions include x-api-key header in fetch calls', () => {
    const toolsPath = resolve(process.cwd(), 'src/app/ws-server/tools.ts');
    const source = readFileSync(toolsPath, 'utf-8');

    // These are the wrapper functions that make fetch calls to internal API routes.
    // Each one SHOULD include an x-api-key header.
    const wrapperFunctions = [
      'wrapperGetRestaurantDetails',
      'wrapperUpsertCallData',
      'wrapperAddTranscriptDialogues',
      'wrapperUpsertOrders',
      'wrapperMatchUpsellPrompts',
      'wrapperRecordPromptAcceptance',
      'wrapperCheckBlocked',
    ];

    const wrappersWithoutApiKey: string[] = [];

    for (const fnName of wrapperFunctions) {
      // Extract the function body for this wrapper
      const fnStart = source.indexOf(`async function ${fnName}`);
      if (fnStart === -1) continue;

      // Find the function body by tracking braces
      let braceCount = 0;
      let fnBody = '';
      let started = false;
      for (let i = fnStart; i < source.length; i++) {
        if (source[i] === '{') {
          braceCount++;
          started = true;
        }
        if (source[i] === '}') {
          braceCount--;
        }
        if (started) {
          fnBody += source[i];
        }
        if (started && braceCount === 0) break;
      }

      // Check if the function body includes x-api-key in its headers
      const hasApiKeyHeader = fnBody.includes('x-api-key');

      if (!hasApiKeyHeader) {
        wrappersWithoutApiKey.push(fnName);
      }
    }

    // Document counterexamples
    if (wrappersWithoutApiKey.length > 0) {
      console.log('\n=== COUNTEREXAMPLES: ws-server wrappers missing x-api-key header ===');
      console.log(`Total wrappers missing header: ${wrappersWithoutApiKey.length}`);
      for (const fn of wrappersWithoutApiKey) {
        console.log(`  - ${fn}()`);
      }
      console.log('=== END COUNTEREXAMPLES ===\n');
    }

    // The CORRECT behavior: 0 wrappers should be missing the x-api-key header.
    // All fetch calls to internal routes must authenticate.
    //
    // On unfixed code: all 7 wrappers omit the header.
    expect(
      wrappersWithoutApiKey.length,
      `Expected 0 ws-server wrappers missing x-api-key header, but found ${wrappersWithoutApiKey.length}. ` +
      `Wrappers missing header:\n${wrappersWithoutApiKey.map(fn => `  - ${fn}()`).join('\n')}\n` +
      'This confirms the missing auth header bug (C3) exists in ws-server wrapper functions.'
    ).toBe(0);
  });
});
