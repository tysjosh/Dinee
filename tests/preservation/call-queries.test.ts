/**
 * Preservation Test — Call Query Structure
 *
 * Validates: Requirements 3.5
 *
 * This test establishes the baseline behavior of restaurant/branch-scoped call
 * queries that MUST be preserved after fixes are applied. It uses static
 * analysis to verify:
 *   1. Call query functions exist and are exported from convex/calls.ts
 *   2. They use .withIndex() for their lookups (these are the GOOD queries)
 *   3. The index names match what's defined in convex/schema.ts
 *   4. They do NOT use the .collect().find() anti-pattern
 *
 * EXPECTED OUTCOME: All tests PASS on unfixed code (confirms baseline).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import fc from 'fast-check';

// ============================================================================
// Observed Baseline — Index-backed query functions in convex/calls.ts
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
  /** The table being queried (calls or transcripts) */
  table: string;
}

/**
 * These are the GOOD queries that already use .withIndex() on unfixed code.
 * They must remain index-backed after all fixes are applied.
 */
const INDEX_BACKED_QUERIES: IndexBackedQuery[] = [
  {
    functionName: 'getCallsByRestaurant',
    indexName: 'by_restaurant_id',
    indexField: 'restaurantId',
    hasPostFilter: false,
    table: 'calls',
  },
  {
    functionName: 'getCallsByBranch',
    indexName: 'by_branch_id',
    indexField: 'branchId',
    hasPostFilter: false,
    table: 'calls',
  },
  {
    functionName: 'getActiveCallsByRestaurant',
    indexName: 'by_restaurant_id',
    indexField: 'restaurantId',
    hasPostFilter: true, // filters by status === "active"
    table: 'calls',
  },
  {
    functionName: 'getActiveCallsByBranch',
    indexName: 'by_branch_id',
    indexField: 'branchId',
    hasPostFilter: true, // filters by status === "active"
    table: 'calls',
  },
  {
    functionName: 'getPastCallsByRestaurant',
    indexName: 'by_restaurant_id',
    indexField: 'restaurantId',
    hasPostFilter: true, // filters by status === "completed"
    table: 'calls',
  },
  {
    functionName: 'getPastCallsByBranch',
    indexName: 'by_branch_id',
    indexField: 'branchId',
    hasPostFilter: true, // filters by status === "completed"
    table: 'calls',
  },
  {
    functionName: 'getCallsWithLowConfidence',
    indexName: 'by_restaurant_id',
    indexField: 'restaurantId',
    hasPostFilter: false, // uses JS filter after .collect(), not Convex .filter()
    table: 'calls',
  },
  {
    functionName: 'getASRMetrics',
    indexName: 'by_restaurant_id',
    indexField: 'restaurantId',
    hasPostFilter: false, // uses JS filter after .collect(), not Convex .filter()
    table: 'calls',
  },
  {
    functionName: 'getTranscriptsByCallId',
    indexName: 'by_call_id',
    indexField: 'callId',
    hasPostFilter: false,
    table: 'transcripts',
  },
];

/**
 * Schema-defined indexes on the calls table.
 * These must exist for the queries above to work.
 */
const CALLS_SCHEMA_INDEXES: Record<string, string[]> = {
  'by_restaurant_id': ['restaurantId'],
  'by_branch_id': ['branchId'],
  'by_call_and_order_id': ['callId', 'orderId'],
};

/**
 * Schema-defined indexes on the transcripts table.
 */
const TRANSCRIPTS_SCHEMA_INDEXES: Record<string, string[]> = {
  'by_call_id': ['callId'],
};

// ============================================================================
// Helpers
// ============================================================================

function readSourceFile(relativePath: string): string {
  const fullPath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

function extractExportedNames(source: string): string[] {
  const names: string[] = [];
  const constRegex = /export\s+const\s+(\w+)\s*=/g;
  let match: RegExpExecArray | null;
  while ((match = constRegex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function extractFunctionBody(source: string, functionName: string): string | null {
  const startPattern = `export const ${functionName}`;
  const startIdx = source.indexOf(startPattern);
  if (startIdx === -1) return null;

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

function usesWithIndex(body: string, indexName: string): boolean {
  const pattern = new RegExp(`\\.withIndex\\s*\\(\\s*["']${indexName}["']`);
  return pattern.test(body);
}

function usesCollectThenFind(body: string): boolean {
  return /\.collect\(\)[\s\S]*?\.find\(/.test(body);
}

/**
 * Check if a function body uses Convex .filter() after .withIndex()
 * (not JS Array.filter after .collect())
 */
function usesPostIndexFilter(body: string): boolean {
  // Match .withIndex(...) followed by .filter() BEFORE the terminal read
  // (.collect() OR the bounded .take(...)). This distinguishes a Convex query
  // .filter() from a JS Array.filter after materialization, and treats a
  // bounded .take() the same as .collect() for this structural check.
  const withIndexToTerminal = body.match(
    /\.withIndex\([^)]+\)([\s\S]*?)\.(?:collect|take)\(/
  );
  if (!withIndexToTerminal) return false;
  return /\.filter\(/.test(withIndexToTerminal[1]);
}

function extractTableIndexes(schemaSource: string, tableName: string): Record<string, string[]> {
  const tableStart = schemaSource.indexOf(`${tableName}: defineTable(`);
  if (tableStart === -1) return {};

  const afterTable = schemaSource.substring(tableStart + 1);
  const nextTableMatch = afterTable.match(/\n\s{2}\/\/\s|^\s{2}\w+:\s*defineTable\(/m);
  const tableBlock = nextTableMatch
    ? schemaSource.substring(tableStart, tableStart + 1 + (nextTableMatch.index ?? afterTable.length))
    : schemaSource.substring(tableStart);

  const indexes: Record<string, string[]> = {};
  const indexRegex = /\.index\(\s*["']([^"']+)["']\s*,\s*\[([^\]]+)\]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = indexRegex.exec(tableBlock)) !== null) {
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

const CALLS_FILE = 'convex/calls.ts';
const SCHEMA_FILE = 'convex/schema.ts';

describe('Call Query Preservation — Index-Backed Queries Baseline', () => {
  // ---- 1. All index-backed query functions exist ----
  describe('1. Query functions exist and export correctly', () => {
    const callsSource = readSourceFile(CALLS_FILE);
    const exportedNames = extractExportedNames(callsSource);

    for (const q of INDEX_BACKED_QUERIES) {
      it(`${q.functionName} is exported from convex/calls.ts`, () => {
        expect(
          exportedNames,
          `Missing export: ${q.functionName} in ${CALLS_FILE}`
        ).toContain(q.functionName);
      });
    }
  });

  // ---- 2. Each query uses .withIndex() with the correct index name ----
  describe('2. Queries use .withIndex() for lookups', () => {
    const callsSource = readSourceFile(CALLS_FILE);

    for (const q of INDEX_BACKED_QUERIES) {
      it(`${q.functionName} uses .withIndex("${q.indexName}")`, () => {
        const body = extractFunctionBody(callsSource, q.functionName);
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
    const callsSource = readSourceFile(CALLS_FILE);

    for (const q of INDEX_BACKED_QUERIES) {
      it(`${q.functionName} does not use .collect().find() anti-pattern`, () => {
        const body = extractFunctionBody(callsSource, q.functionName);
        expect(body, `Could not extract body for ${q.functionName}`).not.toBeNull();
        expect(
          usesCollectThenFind(body!),
          `${q.functionName} uses .collect().find() — should use .withIndex() instead`
        ).toBe(false);
      });
    }
  });

  // ---- 4. Post-index filter usage matches observed baseline ----
  describe('4. Post-index Convex filter patterns match baseline', () => {
    const callsSource = readSourceFile(CALLS_FILE);

    for (const q of INDEX_BACKED_QUERIES) {
      it(`${q.functionName} ${q.hasPostFilter ? 'uses' : 'does not use'} Convex .filter() after .withIndex()`, () => {
        const body = extractFunctionBody(callsSource, q.functionName);
        expect(body, `Could not extract body for ${q.functionName}`).not.toBeNull();
        expect(
          usesPostIndexFilter(body!),
          `${q.functionName} post-index filter mismatch (expected hasPostFilter=${q.hasPostFilter})`
        ).toBe(q.hasPostFilter);
      });
    }
  });

  // ---- 5. Schema indexes exist and match expected fields ----
  describe('5. Schema indexes for calls table', () => {
    const schemaSource = readSourceFile(SCHEMA_FILE);
    const actualIndexes = extractTableIndexes(schemaSource, 'calls');

    for (const [indexName, expectedFields] of Object.entries(CALLS_SCHEMA_INDEXES)) {
      it(`index "${indexName}" exists with fields [${expectedFields.join(', ')}]`, () => {
        expect(
          actualIndexes,
          `Index "${indexName}" not found in calls table schema`
        ).toHaveProperty(indexName);
        expect(
          actualIndexes[indexName],
          `Index "${indexName}" fields mismatch`
        ).toEqual(expectedFields);
      });
    }
  });

  describe('5b. Schema indexes for transcripts table', () => {
    const schemaSource = readSourceFile(SCHEMA_FILE);
    const actualIndexes = extractTableIndexes(schemaSource, 'transcripts');

    for (const [indexName, expectedFields] of Object.entries(TRANSCRIPTS_SCHEMA_INDEXES)) {
      it(`index "${indexName}" exists with fields [${expectedFields.join(', ')}]`, () => {
        expect(
          actualIndexes,
          `Index "${indexName}" not found in transcripts table schema`
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
    const callsIndexes = extractTableIndexes(schemaSource, 'calls');
    const transcriptsIndexes = extractTableIndexes(schemaSource, 'transcripts');

    for (const q of INDEX_BACKED_QUERIES) {
      it(`${q.functionName} references index "${q.indexName}" which exists in ${q.table} schema`, () => {
        const relevantIndexes = q.table === 'transcripts' ? transcriptsIndexes : callsIndexes;
        expect(
          Object.keys(relevantIndexes),
          `Index "${q.indexName}" used by ${q.functionName} is not defined in ${q.table} schema`
        ).toContain(q.indexName);
      });
    }
  });

  // ---- 7. Property-based: for all index-backed queries, structural invariants hold ----
  describe('7. Property: all index-backed call queries preserve structural invariants', () => {
    /**
     * **Validates: Requirements 3.5**
     *
     * Property: For all restaurant/branch-scoped call query functions that use
     * index-backed lookups, the following invariants hold simultaneously:
     *   - Function is exported from convex/calls.ts
     *   - Function uses .withIndex() with the correct index name
     *   - Function does NOT use .collect().find() anti-pattern
     *   - The index name referenced exists in convex/schema.ts
     *   - Post-index filter usage matches the observed baseline
     */
    const queryArbitrary = fc.constantFrom(...INDEX_BACKED_QUERIES);
    const callsSource = readSourceFile(CALLS_FILE);
    const schemaSource = readSourceFile(SCHEMA_FILE);
    const exportedNames = extractExportedNames(callsSource);
    const callsIndexes = extractTableIndexes(schemaSource, 'calls');
    const transcriptsIndexes = extractTableIndexes(schemaSource, 'transcripts');

    it('all structural invariants hold for any index-backed call query', () => {
      fc.assert(
        fc.property(queryArbitrary, (q) => {
          // Function is exported
          expect(exportedNames).toContain(q.functionName);

          // Function body can be extracted
          const body = extractFunctionBody(callsSource, q.functionName);
          expect(body).not.toBeNull();

          // Uses .withIndex() with correct index
          expect(usesWithIndex(body!, q.indexName)).toBe(true);

          // Does NOT use collect-then-find
          expect(usesCollectThenFind(body!)).toBe(false);

          // Index exists in the correct table schema
          const relevantIndexes = q.table === 'transcripts' ? transcriptsIndexes : callsIndexes;
          expect(Object.keys(relevantIndexes)).toContain(q.indexName);

          // Post-filter matches baseline
          expect(usesPostIndexFilter(body!)).toBe(q.hasPostFilter);
        }),
        { numRuns: INDEX_BACKED_QUERIES.length * 3 }
      );
    });
  });
});
