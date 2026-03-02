/**
 * Preservation Test — upsertCallData Structure
 *
 * Validates: Requirements 3.9
 *
 * This test establishes the baseline behavior of `upsertCallData` in
 * convex/internal.ts that MUST be preserved after fixes are applied.
 * It uses static analysis to verify:
 *   1. `upsertCallData` is exported from convex/internal.ts
 *   2. It uses `.withIndex("by_call_and_order_id", ...)` for lookups
 *   3. It has both insert and update (patch) code paths
 *   4. It queries the "calls" table
 *
 * EXPECTED OUTCOME: All tests PASS on unfixed code (confirms baseline).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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
        const closeMatch = remaining.match(/^\}\s*\)\s*;?/);
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

// ============================================================================
// Constants
// ============================================================================

const INTERNAL_FILE = 'convex/internal.ts';
const SCHEMA_FILE = 'convex/schema.ts';

// ============================================================================
// Tests
// ============================================================================

describe('upsertCallData Preservation — Index-Backed Lookup and Insert/Update Behavior', () => {
  const internalSource = readSourceFile(INTERNAL_FILE);

  // ---- 1. upsertCallData is exported ----
  describe('1. upsertCallData is exported from convex/internal.ts', () => {
    it('upsertCallData is exported', () => {
      const exportedNames = extractExportedNames(internalSource);
      expect(
        exportedNames,
        'upsertCallData should be exported from convex/internal.ts'
      ).toContain('upsertCallData');
    });
  });

  // ---- 2. Uses .withIndex("by_call_and_order_id", ...) for lookups ----
  describe('2. Uses index-backed lookup with by_call_and_order_id', () => {
    it('uses .withIndex("by_call_and_order_id", ...) for call lookups', () => {
      const body = extractFunctionBody(internalSource, 'upsertCallData');
      expect(body, 'Could not extract body for upsertCallData').not.toBeNull();

      const indexPattern = /\.withIndex\s*\(\s*["']by_call_and_order_id["']/;
      expect(
        indexPattern.test(body!),
        'upsertCallData should use .withIndex("by_call_and_order_id", ...) for lookups'
      ).toBe(true);
    });

    it('the by_call_and_order_id index exists in the calls table schema', () => {
      const schemaSource = readSourceFile(SCHEMA_FILE);
      // Find the calls table definition and check for the index
      const callsTableMatch = schemaSource.match(
        /calls:\s*defineTable\([\s\S]*?\.index\(\s*["']by_call_and_order_id["']\s*,\s*\[([^\]]+)\]\s*\)/
      );
      expect(
        callsTableMatch,
        'by_call_and_order_id index should exist on the calls table'
      ).not.toBeNull();

      // Verify the index fields include callId
      const fieldsStr = callsTableMatch![1];
      expect(
        fieldsStr,
        'by_call_and_order_id index should include "callId" field'
      ).toContain('"callId"');
    });
  });

  // ---- 3. Has both insert and update (patch) code paths ----
  describe('3. Has both insert and update (patch) code paths', () => {
    it('has a ctx.db.insert("calls", ...) code path for new records', () => {
      const body = extractFunctionBody(internalSource, 'upsertCallData');
      expect(body, 'Could not extract body for upsertCallData').not.toBeNull();

      const insertPattern = /ctx\.db\.insert\s*\(\s*["']calls["']/;
      expect(
        insertPattern.test(body!),
        'upsertCallData should have a ctx.db.insert("calls", ...) path for new call records'
      ).toBe(true);
    });

    it('has a ctx.db.patch(...) code path for existing records', () => {
      const body = extractFunctionBody(internalSource, 'upsertCallData');
      expect(body, 'Could not extract body for upsertCallData').not.toBeNull();

      const patchPattern = /ctx\.db\.patch\s*\(/;
      expect(
        patchPattern.test(body!),
        'upsertCallData should have a ctx.db.patch(...) path for updating existing call records'
      ).toBe(true);
    });

    it('checks for existing record before deciding insert vs update', () => {
      const body = extractFunctionBody(internalSource, 'upsertCallData');
      expect(body, 'Could not extract body for upsertCallData').not.toBeNull();

      // The function should check if the query result is null/falsy before inserting
      const nullCheckPattern = /if\s*\(\s*!callDataResponse\s*\)/;
      expect(
        nullCheckPattern.test(body!),
        'upsertCallData should check if the lookup returned null before deciding to insert'
      ).toBe(true);
    });
  });

  // ---- 4. Queries the "calls" table ----
  describe('4. Queries the "calls" table', () => {
    it('queries the "calls" table via ctx.db.query("calls")', () => {
      const body = extractFunctionBody(internalSource, 'upsertCallData');
      expect(body, 'Could not extract body for upsertCallData').not.toBeNull();

      const queryPattern = /ctx\.db\.query\s*\(\s*["']calls["']\s*\)/;
      expect(
        queryPattern.test(body!),
        'upsertCallData should query the "calls" table'
      ).toBe(true);
    });

    it('uses .unique() for single-record lookup', () => {
      const body = extractFunctionBody(internalSource, 'upsertCallData');
      expect(body, 'Could not extract body for upsertCallData').not.toBeNull();

      const uniquePattern = /\.unique\s*\(\s*\)/;
      expect(
        uniquePattern.test(body!),
        'upsertCallData should use .unique() for single-record lookup after index query'
      ).toBe(true);
    });

    it('does NOT use .collect().find() anti-pattern', () => {
      const body = extractFunctionBody(internalSource, 'upsertCallData');
      expect(body, 'Could not extract body for upsertCallData').not.toBeNull();

      const collectFindPattern = /\.collect\(\)[\s\S]*?\.find\(/;
      expect(
        collectFindPattern.test(body!),
        'upsertCallData should NOT use .collect().find() anti-pattern'
      ).toBe(false);
    });
  });
});
