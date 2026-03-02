/**
 * Bug Condition Exploration Test — C13: Webhook Race Condition (TOCTOU)
 *
 * Validates: Requirements 1.14
 *
 * The current idempotency check in the Paystack webhook handler uses a
 * query-then-insert pattern:
 *   1. Query: getWebhookEventByEventId (check if event exists)
 *   2. Insert: createWebhookEvent (insert the event record)
 *
 * These are two separate Convex operations (a query and a mutation) called
 * from the Next.js route handler via ConvexHttpClient. Between the query
 * returning "not found" and the mutation inserting the record, a second
 * concurrent request can also see "not found" and proceed — both requests
 * then process the same payment (double-processing).
 *
 * Additionally, there is no unique constraint on `eventId` in the Convex
 * schema — the `by_event_id` index allows duplicates.
 *
 * The fix requires an atomic check-and-insert in a single Convex mutation
 * (Convex mutations are serialized per document, eliminating the TOCTOU
 * window), and the webhook handler must use this atomic guard before any
 * payment processing.
 *
 * EXPECTED OUTCOME on unfixed code: Tests FAIL —
 *   - webhookEvents.ts has no atomic check-and-insert mutation
 *   - Paystack handler uses separate query + mutation (racy pattern)
 *
 * When the atomic idempotency fix is applied, these tests should PASS.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the body of a named export function/const from source code.
 */
function extractFunctionBody(source: string, exportName: string): string {
  const marker = `export const ${exportName}`;
  const start = source.indexOf(marker);
  if (start === -1) return '';

  let braceCount = 0;
  let body = '';
  let started = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') {
      braceCount++;
      started = true;
    }
    if (source[i] === '}') {
      braceCount--;
    }
    if (started) {
      body += source[i];
    }
    if (started && braceCount === 0) break;
  }
  return body;
}

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

const webhookEventsPath = resolve(process.cwd(), 'convex/webhookEvents.ts');
const webhookEventsSource = readFileSync(webhookEventsPath, 'utf-8');

const paystackHandlerPath = resolve(
  process.cwd(),
  'src/app/client/api/v1/webhooks/paystack/route.ts'
);
const paystackHandlerSource = readFileSync(paystackHandlerPath, 'utf-8');

// ---------------------------------------------------------------------------
// C13: Webhook Idempotency Must Be Atomic
// ---------------------------------------------------------------------------

describe('C13: Webhook Race Condition (TOCTOU) — Exploration Test', () => {
  /**
   * **Validates: Requirements 1.14**
   *
   * convex/webhookEvents.ts must export an atomic check-and-insert mutation
   * that queries for an existing event AND inserts in a single Convex
   * mutation (which is serialized, eliminating the race window).
   *
   * On unfixed code, only separate `getWebhookEventByEventId` (query) and
   * `createWebhookEvent` (mutation) exist — no atomic guard.
   */
  it('webhookEvents.ts should export an atomic check-and-insert idempotency mutation', () => {
    // Look for an atomic mutation that does both check and insert
    // It should query by eventId AND insert in the same mutation handler
    const hasAtomicInsert =
      webhookEventsSource.includes('atomicInsertWebhookEvent') ||
      webhookEventsSource.includes('atomicInsert') ||
      webhookEventsSource.includes('checkAndInsert');

    // If no explicitly named atomic function, check if any mutation does
    // both a query (ctx.db.query) and an insert (ctx.db.insert) for
    // idempotency in a single handler
    let hasAtomicPattern = false;
    if (!hasAtomicInsert) {
      // Find all mutation exports and check if any single mutation body
      // contains both a query-by-eventId and an insert
      const mutationExports = webhookEventsSource.match(
        /export const (\w+)\s*=\s*mutation/g
      );
      if (mutationExports) {
        for (const match of mutationExports) {
          const name = match.match(/export const (\w+)/)?.[1];
          if (!name) continue;
          const body = extractFunctionBody(webhookEventsSource, name);
          const queriesByEventId =
            body.includes('.query("webhookEvents")') &&
            body.includes('eventId');
          const insertsRecord = body.includes('ctx.db.insert(');
          const returnsInsertedFlag =
            body.includes('inserted') || body.includes('alreadyExists');
          if (queriesByEventId && insertsRecord && returnsInsertedFlag) {
            hasAtomicPattern = true;
            break;
          }
        }
      }
    }

    const isAtomic = hasAtomicInsert || hasAtomicPattern;

    // Document the finding
    console.log('\n=== ANALYSIS: webhookEvents.ts atomic idempotency ===');
    console.log(`Has named atomic mutation (atomicInsertWebhookEvent/etc): ${hasAtomicInsert}`);
    console.log(`Has atomic check-and-insert pattern in any mutation: ${hasAtomicPattern}`);
    console.log(`Idempotency is atomic: ${isAtomic}`);

    if (!isAtomic) {
      console.log(
        'COUNTEREXAMPLE: convex/webhookEvents.ts has no atomic check-and-insert ' +
        'mutation. The idempotency check uses separate getWebhookEventByEventId ' +
        '(query) and createWebhookEvent (mutation) — a TOCTOU race window where ' +
        'two concurrent webhook deliveries can both pass the check and process ' +
        'the same payment twice.'
      );
    }
    console.log('=== END ANALYSIS ===\n');

    expect(
      isAtomic,
      'convex/webhookEvents.ts does not have an atomic check-and-insert ' +
      'idempotency mutation. The current pattern uses a separate query ' +
      '(getWebhookEventByEventId) and mutation (createWebhookEvent), ' +
      'creating a TOCTOU race window for duplicate webhook processing (C13).'
    ).toBe(true);
  });

  /**
   * **Validates: Requirements 1.14**
   *
   * The Paystack webhook handler must use an atomic idempotency guard
   * (a single Convex mutation that checks-and-inserts) BEFORE processing
   * any payment. On unfixed code, it calls a query first, then a separate
   * mutation — the racy query-then-insert pattern.
   */
  it('Paystack webhook handler should use atomic idempotency guard, not query-then-insert', () => {
    // Detect the racy pattern: calling a query to check existence, then
    // a separate mutation to insert — two distinct Convex operations
    const usesQueryCheck =
      paystackHandlerSource.includes('getWebhookEventByEventId') ||
      paystackHandlerSource.includes('isWebhookEventProcessed');
    const usesSeparateInsert =
      paystackHandlerSource.includes('createWebhookEvent');

    const isRacyPattern = usesQueryCheck && usesSeparateInsert;

    // Check if it uses an atomic guard instead
    const usesAtomicGuard =
      paystackHandlerSource.includes('atomicInsertWebhookEvent') ||
      paystackHandlerSource.includes('atomicInsert') ||
      paystackHandlerSource.includes('checkAndInsert');

    // The handler is safe if it uses an atomic guard and does NOT use
    // the racy query-then-insert pattern for idempotency
    const isSafe = usesAtomicGuard && !isRacyPattern;

    // Document the finding
    console.log('\n=== ANALYSIS: Paystack webhook handler idempotency ===');
    console.log(`Uses separate query check (getWebhookEventByEventId): ${usesQueryCheck}`);
    console.log(`Uses separate insert (createWebhookEvent): ${usesSeparateInsert}`);
    console.log(`Has racy query-then-insert pattern: ${isRacyPattern}`);
    console.log(`Uses atomic idempotency guard: ${usesAtomicGuard}`);
    console.log(`Idempotency is race-safe: ${isSafe}`);

    if (!isSafe) {
      console.log(
        'COUNTEREXAMPLE: Paystack webhook handler uses a racy query-then-insert ' +
        'pattern for idempotency. It calls getWebhookEventByEventId (query) to ' +
        'check if the event exists, then createWebhookEvent (mutation) to insert. ' +
        'Two concurrent webhook deliveries can both see "not found" from the query ' +
        'and proceed to process the same payment — violating exactly-once semantics.'
      );
    }
    console.log('=== END ANALYSIS ===\n');

    expect(
      isSafe,
      'Paystack webhook handler uses a racy query-then-insert pattern: it calls ' +
      'getWebhookEventByEventId (query) then createWebhookEvent (mutation) as ' +
      'separate Convex operations. This creates a TOCTOU race window where ' +
      'concurrent duplicate webhooks can both pass the idempotency check and ' +
      'double-process the payment. It should use an atomic check-and-insert ' +
      'mutation instead (C13).'
    ).toBe(true);
  });
});
