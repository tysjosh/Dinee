/**
 * Preservation Test — Order Query Structure
 *
 * Validates: Requirements 3.4
 *
 * This test establishes the baseline behavior of restaurant-scoped order
 * queries that MUST be preserved after fixes are applied. It uses static
 * analysis to verify:
 *   1. Restaurant-scoped query functions exist and use .withIndex() for lookups
 *   2. The index names used match what's defined in convex/schema.ts
 *   3. The query patterns are preserved (withIndex, not collect+find)
 *   4. All expected query functions are exported from convex/orders.ts
 *
 * EXPECTED OUTCOME: All tests PASS on unfixed code (confirms baseline).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import fc from 'fast-check';

// ============================================================================
// Observed Baseline — Index-backed query functions in convex/orders.ts
// ============================================================================

interface IndexBackedQuery {
  /** Exported function name */
  functionName: string;
  /** Index name used in .withIndex() */
  indexName: string;
  /** Fields passed to the index equality check */
  indexField: string;
  /** Whether it applies additional .filter() after index */
  hasPostFilter: boolean;
}

/**
 * These are the GOOD queries that already use .withIndex() on unfixed code.
 * They must remain index-backed after all fixes are applied.
 */
const INDEX_BACKED_QUERIES: IndexBackedQuery[] = [
  {
    functionName: 'getOrdersByRestaurant',
    indexName: 'by_restaurant_id',
    indexField: 'restaurantId',
    hasPostFilter: false,
  },
  {
    functionName: 'getActiveOrdersByRestaurant',
    indexName: 'by_restaurant_id',
    indexField: 'restaurantId',
    hasPostFilter: true, // filters by status === "active"
  },
  {
    functionName: 'getOrdersByBranch',
    indexName: 'by_branch_id',
    indexField: 'branchId',
    hasPostFilter: false,
  },
  {
    functionName: 'getActiveOrdersByBranch',
    indexName: 'by_branch_id',
    indexField: 'branchId',
    hasPostFilter: true, // filters by status === "active"
  },
  {
    functionName: 'getPastOrdersByRestaurant',
    indexName: 'by_restaurant_id',
    indexField: 'restaurantId',
    hasPostFilter: true, // filters by status completed/cancelled
  },
  {
    functionName: 'getPastOrdersByBranch',
    indexName: 'by_branch_id',
    indexField: 'branchId',
    hasPostFilter: true, // filters by status completed/cancelled
  },
  {
    functionName: 'getOrdersByPaymentStatus',
    indexName: 'by_payment_status',
    indexField: 'paymentStatus',
    hasPostFilter: false,
  },
  {
    functionName: 'getOrdersByDeliveryStatus',
    indexName: 'by_delivery_status',
    indexField: 'deliveryStatus',
    hasPostFilter: false,
  },
  {
    functionName: 'getCODOrdersByBranch',
    indexName: 'by_branch_id',
    indexField: 'branchId',
    hasPostFilter: true, // filters by paymentMethod === "cod"
  },
];

/**
 * Schema-defined indexes on the orders table.
 * These must exist for the queries above to work.
 */
const SCHEMA_INDEXES: Record<string, string[]> = {
  'by_restaurant_id': ['restaurantId'],
  'by_branch_id': ['branchId'],
  'by_order_and_restaurant_id': ['orderId', 'restaurantId'],
  'by_payment_status': ['paymentStatus'],
  'by_delivery_status': ['deliveryStatus'],
};

// ============================================================================
// Helpers
// ============================================================================

function readSourceFile(relativePath: string): string {
  const fullPath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Extract all exported function/const names from source
 */
function extractExportedNames(source: string): string[] {
  const names: string[] = [];
  // export const name = query/mutation(...)
  const constRegex = /export\s+const\s+(\w+)\s*=/g;
  let match: RegExpExecArray | null;
  while ((match = constRegex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Extract the function body for a given exported const (query/mutation).
 * Returns the source from `export const <name>` to the closing `});`
 */
function extractFunctionBody(source: string, functionName: string): string | null {
  const startPattern = `export const ${functionName}`;
  const startIdx = source.indexOf(startPattern);
  if (startIdx === -1) return null;

  // Find the matching closing — track brace depth from the first `{`
  let braceDepth = 0;
  let foundFirstBrace = false;
  let endIdx = startIdx;

  for (let i = startIdx; i < source.length; i++) {
    if (source[i] === '{') {
      braceDepth++;
      foundFirstBrace = true;
    } else if (source[i] === '}') {
      braceDepth--;
      if (foundFirstBrace && braceDepth === 0) {
        // Look for the closing `);` after the `}`
        const remaining = source.substring(i);
        const closeMatch = remaining.match(/^\}\s*\)\s*;/);
        if (closeMatch) {
          endIdx = i + closeMatch[0].length;
        } else {
          endIdx = i + 1;
        }
        break;
      }
    }
  }

  return source.substring(startIdx, endIdx);
}

/**
 * Check if a function body uses .withIndex("indexName", ...)
 */
function usesWithIndex(body: string, indexName: string): boolean {
  const pattern = new RegExp(`\\.withIndex\\s*\\(\\s*["']${indexName}["']`);
  return pattern.test(body);
}

/**
 * Check if a function body uses the collect-then-find anti-pattern
 * (i.e., .collect() followed by .find())
 */
function usesCollectThenFind(body: string): boolean {
  return /\.collect\(\)[\s\S]*?\.find\(/.test(body);
}

/**
 * Check if a function body uses .filter() after .withIndex()
 */
function usesPostIndexFilter(body: string): boolean {
  return /\.withIndex\([^)]+\)[\s\S]*?\.filter\(/.test(body);
}

/**
 * Extract index definitions from schema source for the orders table.
 *
 * Strategy: find the `orders: defineTable({` start, then scan forward
 * collecting all chained `.index(...)` calls until we hit the next
 * top-level table definition (i.e., a line starting with `  // ` comment
 * or `  tableName: defineTable(`).
 */
function extractOrdersIndexes(schemaSource: string): Record<string, string[]> {
  // Find where the orders table starts
  const ordersStart = schemaSource.indexOf('orders: defineTable(');
  if (ordersStart === -1) return {};

  // Find the next table definition after orders (look for `\n\n  //` or next `defineTable`)
  // We search for the next top-level key: `\n  word: defineTable(`
  const afterOrders = schemaSource.substring(ordersStart + 1);
  const nextTableMatch = afterOrders.match(/\n\s{2}\/\/\s|^\s{2}\w+:\s*defineTable\(/m);
  const ordersBlock = nextTableMatch
    ? schemaSource.substring(ordersStart, ordersStart + 1 + (nextTableMatch.index ?? afterOrders.length))
    : schemaSource.substring(ordersStart);

  const indexes: Record<string, string[]> = {};

  // Match .index("name", ["field1", "field2"])
  const indexRegex = /\.index\(\s*["']([^"']+)["']\s*,\s*\[([^\]]+)\]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = indexRegex.exec(ordersBlock)) !== null) {
    const indexName = match[1];
    const fieldsStr = match[2];
    const fields = fieldsStr.match(/["']([^"']+)["']/g)?.map(f => f.replace(/["']/g, '')) || [];
    indexes[indexName] = fields;
  }

  return indexes;
}

// ============================================================================
// Tests
// ============================================================================

const ORDERS_FILE = 'convex/orders.ts';
const SCHEMA_FILE = 'convex/schema.ts';

describe('Order Query Preservation — Index-Backed Queries Baseline', () => {
  // ---- 1. All index-backed query functions exist ----
  describe('1. Query functions exist and export correctly', () => {
    const ordersSource = readSourceFile(ORDERS_FILE);
    const exportedNames = extractExportedNames(ordersSource);

    for (const q of INDEX_BACKED_QUERIES) {
      it(`${q.functionName} is exported from convex/orders.ts`, () => {
        expect(
          exportedNames,
          `Missing export: ${q.functionName} in ${ORDERS_FILE}`
        ).toContain(q.functionName);
      });
    }
  });

  // ---- 2. Each query uses .withIndex() with the correct index name ----
  describe('2. Queries use .withIndex() for lookups', () => {
    const ordersSource = readSourceFile(ORDERS_FILE);

    for (const q of INDEX_BACKED_QUERIES) {
      it(`${q.functionName} uses .withIndex("${q.indexName}")`, () => {
        const body = extractFunctionBody(ordersSource, q.functionName);
        expect(body, `Could not extract body for ${q.functionName}`).not.toBeNull();
        expect(
          usesWithIndex(body!, q.indexName),
          `${q.functionName} does not use .withIndex("${q.indexName}")`
        ).toBe(true);
      });
    }
  });

  // ---- 3. None of the index-backed queries use collect-then-find ----
  describe('3. Index-backed queries do NOT use collect-then-find pattern', () => {
    const ordersSource = readSourceFile(ORDERS_FILE);

    for (const q of INDEX_BACKED_QUERIES) {
      it(`${q.functionName} does not use .collect().find() anti-pattern`, () => {
        const body = extractFunctionBody(ordersSource, q.functionName);
        expect(body, `Could not extract body for ${q.functionName}`).not.toBeNull();
        expect(
          usesCollectThenFind(body!),
          `${q.functionName} uses .collect().find() — should use .withIndex() instead`
        ).toBe(false);
      });
    }
  });

  // ---- 4. Post-index filter usage matches observed baseline ----
  describe('4. Post-index filter patterns match baseline', () => {
    const ordersSource = readSourceFile(ORDERS_FILE);

    for (const q of INDEX_BACKED_QUERIES) {
      it(`${q.functionName} ${q.hasPostFilter ? 'uses' : 'does not use'} .filter() after .withIndex()`, () => {
        const body = extractFunctionBody(ordersSource, q.functionName);
        expect(body, `Could not extract body for ${q.functionName}`).not.toBeNull();
        expect(
          usesPostIndexFilter(body!),
          `${q.functionName} post-index filter mismatch (expected hasPostFilter=${q.hasPostFilter})`
        ).toBe(q.hasPostFilter);
      });
    }
  });

  // ---- 5. Schema indexes exist and match expected fields ----
  describe('5. Schema indexes for orders table', () => {
    const schemaSource = readSourceFile(SCHEMA_FILE);
    const actualIndexes = extractOrdersIndexes(schemaSource);

    for (const [indexName, expectedFields] of Object.entries(SCHEMA_INDEXES)) {
      it(`index "${indexName}" exists with fields [${expectedFields.join(', ')}]`, () => {
        expect(
          actualIndexes,
          `Index "${indexName}" not found in orders table schema`
        ).toHaveProperty(indexName);
        expect(
          actualIndexes[indexName],
          `Index "${indexName}" fields mismatch`
        ).toEqual(expectedFields);
      });
    }
  });

  // ---- 6. Index names used in queries match schema definitions ----
  describe('6. Index names in queries match schema', () => {
    const schemaSource = readSourceFile(SCHEMA_FILE);
    const actualIndexes = extractOrdersIndexes(schemaSource);
    const schemaIndexNames = Object.keys(actualIndexes);

    for (const q of INDEX_BACKED_QUERIES) {
      it(`${q.functionName} references index "${q.indexName}" which exists in schema`, () => {
        expect(
          schemaIndexNames,
          `Index "${q.indexName}" used by ${q.functionName} is not defined in schema`
        ).toContain(q.indexName);
      });
    }
  });

  // ---- 7. Property-based: for all index-backed queries, structural invariants hold ----
  describe('7. Property: all index-backed queries preserve structural invariants', () => {
    /**
     * **Validates: Requirements 3.4**
     *
     * Property: For all restaurant-scoped order query functions that use
     * index-backed lookups, the following invariants hold simultaneously:
     *   - Function is exported from convex/orders.ts
     *   - Function uses .withIndex() with the correct index name
     *   - Function does NOT use .collect().find() anti-pattern
     *   - The index name referenced exists in convex/schema.ts
     *   - Post-index filter usage matches the observed baseline
     */
    const queryArbitrary = fc.constantFrom(...INDEX_BACKED_QUERIES);
    const ordersSource = readSourceFile(ORDERS_FILE);
    const schemaSource = readSourceFile(SCHEMA_FILE);
    const exportedNames = extractExportedNames(ordersSource);
    const actualIndexes = extractOrdersIndexes(schemaSource);
    const schemaIndexNames = Object.keys(actualIndexes);

    it('all structural invariants hold for any index-backed order query', () => {
      fc.assert(
        fc.property(queryArbitrary, (q) => {
          // Function is exported
          expect(exportedNames).toContain(q.functionName);

          // Function body can be extracted
          const body = extractFunctionBody(ordersSource, q.functionName);
          expect(body).not.toBeNull();

          // Uses .withIndex() with correct index
          expect(usesWithIndex(body!, q.indexName)).toBe(true);

          // Does NOT use collect-then-find
          expect(usesCollectThenFind(body!)).toBe(false);

          // Index exists in schema
          expect(schemaIndexNames).toContain(q.indexName);

          // Post-filter matches baseline
          expect(usesPostIndexFilter(body!)).toBe(q.hasPostFilter);
        }),
        { numRuns: INDEX_BACKED_QUERIES.length * 3 }
      );
    });
  });
});
