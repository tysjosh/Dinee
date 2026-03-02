/**
 * Bug Condition Exploration Test — C6: Full-Table Scan in orders.ts, C7: Filter Without Index in calls.ts
 *
 * Validates: Requirements 1.7, 1.8
 *
 * C6: Six functions in convex/orders.ts perform single-record lookups by
 * calling `.query("orders").collect()` followed by `.find()` — a full-table
 * scan pattern that reads every row in the orders table. These should use
 * `.withIndex()` for O(1) lookups instead.
 *
 * Affected functions:
 *   - getOrderByOrderId
 *   - updatePaymentStatus
 *   - recordCODPaymentCollection
 *   - recordCODPaymentFailure
 *   - updateOrderStatus
 *   - updateDeliveryStatus
 *
 * C7: updateCallASRData in convex/calls.ts uses `.filter()` without
 * `.withIndex()`, performing a full-table scan instead of using the existing
 * `by_call_and_order_id` index.
 *
 * EXPECTED OUTCOME on unfixed code: Tests FAIL —
 *   - C6: All 6 functions use .collect() followed by .find() pattern
 *   - C7: updateCallASRData uses .filter() without .withIndex()
 *
 * When the index-backed query fix is applied, these tests should PASS.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the body of a named export function/const from source code.
 * Finds `export const <name>` and returns everything within its outermost braces.
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
// C6: Full-Table Scan in convex/orders.ts
// ---------------------------------------------------------------------------

describe('C6: Full-Table Scan in orders.ts — Exploration Test', () => {
  const ordersPath = resolve(process.cwd(), 'convex/orders.ts');
  const ordersSource = readFileSync(ordersPath, 'utf-8');

  const c6Functions = [
    'getOrderByOrderId',
    'updatePaymentStatus',
    'recordCODPaymentCollection',
    'recordCODPaymentFailure',
    'updateOrderStatus',
    'updateDeliveryStatus',
  ] as const;

  for (const fnName of c6Functions) {
    /**
     * **Validates: Requirements 1.7**
     *
     * Each function should use .withIndex() for single-record lookups.
     * On unfixed code, they use .query("orders").collect() followed by
     * .find() — scanning the entire orders table.
     */
    it(`${fnName} should use .withIndex() instead of .collect() + .find()`, () => {
      const body = extractFunctionBody(ordersSource, fnName);
      expect(body.length).toBeGreaterThan(0);

      const usesCollect = body.includes('.collect()');
      const usesFind = body.includes('.find(');
      const usesWithIndex = body.includes('.withIndex(');

      // Document the finding
      console.log(`\n=== ANALYSIS: ${fnName} ===`);
      console.log(`Uses .collect(): ${usesCollect}`);
      console.log(`Uses .find(): ${usesFind}`);
      console.log(`Uses .withIndex(): ${usesWithIndex}`);

      if (usesCollect && usesFind && !usesWithIndex) {
        console.log(
          `COUNTEREXAMPLE: ${fnName} performs a full-table scan via .collect() + .find(). ` +
          `This reads every order row for a single-record lookup — O(N) instead of O(1).`
        );
      }
      console.log(`=== END ANALYSIS ===\n`);

      // The function must NOT use the full-table scan pattern
      expect(
        usesCollect && usesFind && !usesWithIndex,
        `${fnName} uses .query("orders").collect() followed by .find() — ` +
        `a full-table scan pattern that reads every row in the orders table. ` +
        `It should use .withIndex() for O(1) single-record lookups (C6).`
      ).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// C7: Filter Without Index in convex/calls.ts
// ---------------------------------------------------------------------------

describe('C7: Filter Without Index in calls.ts — Exploration Test', () => {
  /**
   * **Validates: Requirements 1.8**
   *
   * updateCallASRData should use .withIndex() (e.g., by_call_and_order_id)
   * to look up a call record. On unfixed code, it uses .filter() without
   * .withIndex(), scanning the entire calls table.
   */
  it('updateCallASRData should use .withIndex() instead of .filter() without index', () => {
    const callsPath = resolve(process.cwd(), 'convex/calls.ts');
    const callsSource = readFileSync(callsPath, 'utf-8');

    const body = extractFunctionBody(callsSource, 'updateCallASRData');
    expect(body.length).toBeGreaterThan(0);

    const usesFilter = body.includes('.filter(');
    const usesWithIndex = body.includes('.withIndex(');

    // Document the finding
    console.log('\n=== ANALYSIS: updateCallASRData ===');
    console.log(`Uses .filter(): ${usesFilter}`);
    console.log(`Uses .withIndex(): ${usesWithIndex}`);

    if (usesFilter && !usesWithIndex) {
      console.log(
        'COUNTEREXAMPLE: updateCallASRData uses .filter() without .withIndex(). ' +
        'This scans the entire calls table instead of using the existing ' +
        'by_call_and_order_id index — O(N) instead of O(1).'
      );
    }
    console.log('=== END ANALYSIS ===\n');

    // The function must use .withIndex(), not bare .filter()
    expect(
      usesFilter && !usesWithIndex,
      'updateCallASRData uses .query("calls").filter() without .withIndex() — ' +
      'a full-table scan that reads every row in the calls table. ' +
      'It should use .withIndex("by_call_and_order_id", ...) for O(1) lookup (C7).'
    ).toBe(false);
  });
});
