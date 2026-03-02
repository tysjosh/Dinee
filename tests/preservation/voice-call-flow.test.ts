/**
 * Preservation Test — Voice Call Flow Structure
 *
 * Validates: Requirements 3.7
 *
 * This test establishes the baseline behavior of the ws-server voice call flow
 * that MUST be preserved after fixes are applied. It uses static analysis to verify:
 *   1. tools.ts exports all expected wrapper functions
 *   2. index.ts handles WebSocket connections and tool calls via switch statements
 *   3. The tool dispatch includes all expected tools for each route
 *   4. generateOrderId exists in tools.ts
 *
 * EXPECTED OUTCOME: All tests PASS on unfixed code (confirms baseline).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import fc from 'fast-check';

// ============================================================================
// Observed Baseline — ws-server tool exports and dispatch
// ============================================================================

/** Wrapper functions that must be exported from tools.ts */
const EXPECTED_WRAPPER_EXPORTS = [
  'wrapperGetRestaurantDetails',
  'wrapperUpsertCallData',
  'wrapperAddTranscriptDialogues',
  'wrapperUpsertOrders',
  'wrapperMatchUpsellPrompts',
  'wrapperRecordPromptAcceptance',
  'wrapperCheckBlocked',
] as const;

/** Non-wrapper utility functions that must be exported from tools.ts */
const EXPECTED_UTILITY_EXPORTS = [
  'generateOrderId',
  'extractItemCategories',
  'calculateOrderTotal',
  'generateBlockedCallTwiML',
  'generateVerificationTransferTwiML',
] as const;

/**
 * Tools dispatched in the main /media-stream switch statement.
 * These are the tool names the OpenAI Realtime API calls during a normal call.
 */
const MAIN_STREAM_DISPATCHED_TOOLS = [
  'get_restaurant_details',
  'add_transcript_dialogue',
  'upsert_order',
  'upsert_call_data',
  'generate_order_id',
] as const;

/**
 * Tools dispatched in the /media-stream-callback switch statement.
 */
const CALLBACK_STREAM_DISPATCHED_TOOLS = [
  'get_restaurant_details',
  'upsert_order',
  'generate_order_id',
] as const;

/**
 * Functions imported from tools.ts into index.ts.
 */
const EXPECTED_INDEX_IMPORTS = [
  'wrapperGetRestaurantDetails',
  'wrapperUpsertCallData',
  'wrapperAddTranscriptDialogues',
  'wrapperUpsertOrders',
  'generateOrderId',
  'wrapperCheckBlocked',
  'generateBlockedCallTwiML',
] as const;

// ============================================================================
// Helpers
// ============================================================================

function readSourceFile(relativePath: string): string {
  const fullPath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

function extractExportedFunctions(source: string): string[] {
  const names: string[] = [];
  // Match: export async function name( or export function name(
  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = funcRegex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function extractSwitchCaseNames(source: string): string[] {
  const names: string[] = [];
  const caseRegex = /case\s+["']([^"']+)["']\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = caseRegex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function extractImportsFrom(source: string, modulePattern: string): string[] {
  const importRegex = new RegExp(
    `import\\s*\\{([^}]+)\\}\\s*from\\s*["']${modulePattern}["']`,
    'g'
  );
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    const imports = match[1].split(',').map(s => s.trim()).filter(Boolean);
    names.push(...imports);
  }
  return names;
}

/**
 * Extract the tool dispatch switch block from a specific WebSocket route handler.
 * Looks for `switch (res.name)` blocks within the source.
 */
function extractToolSwitchBlocks(source: string): string[] {
  const blocks: string[] = [];
  const switchPattern = /switch\s*\(\s*res\.name\s*\)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = switchPattern.exec(source)) !== null) {
    const startIdx = match.index;
    let braceDepth = 0;
    let foundFirstBrace = false;

    for (let i = startIdx; i < source.length; i++) {
      if (source[i] === '{') {
        braceDepth++;
        foundFirstBrace = true;
      } else if (source[i] === '}') {
        braceDepth--;
        if (foundFirstBrace && braceDepth === 0) {
          blocks.push(source.substring(startIdx, i + 1));
          break;
        }
      }
    }
  }

  return blocks;
}

function hasWebSocketRoute(source: string, routePath: string): boolean {
  const pattern = new RegExp(`["']${routePath.replace(/\//g, '\\/')}["']`);
  return pattern.test(source);
}

function hasFunctionCallArgumentsHandler(source: string): boolean {
  return source.includes('response.function_call_arguments.done');
}

// ============================================================================
// Tests
// ============================================================================

const TOOLS_FILE = 'src/app/ws-server/tools.ts';
const INDEX_FILE = 'src/app/ws-server/index.ts';

describe('Voice Call Flow Preservation — ws-server Structure Baseline', () => {
  // ---- 1. tools.ts exports all expected wrapper functions ----
  describe('1. tools.ts exports all expected wrapper functions', () => {
    const toolsSource = readSourceFile(TOOLS_FILE);
    const exportedFunctions = extractExportedFunctions(toolsSource);

    for (const wrapperName of EXPECTED_WRAPPER_EXPORTS) {
      it(`exports ${wrapperName}`, () => {
        expect(
          exportedFunctions,
          `Missing export: ${wrapperName} in ${TOOLS_FILE}`
        ).toContain(wrapperName);
      });
    }
  });

  // ---- 2. tools.ts exports utility functions ----
  describe('2. tools.ts exports utility functions', () => {
    const toolsSource = readSourceFile(TOOLS_FILE);
    const exportedFunctions = extractExportedFunctions(toolsSource);

    for (const utilName of EXPECTED_UTILITY_EXPORTS) {
      it(`exports ${utilName}`, () => {
        expect(
          exportedFunctions,
          `Missing export: ${utilName} in ${TOOLS_FILE}`
        ).toContain(utilName);
      });
    }
  });

  // ---- 3. index.ts has WebSocket routes ----
  describe('3. index.ts registers WebSocket routes', () => {
    const indexSource = readSourceFile(INDEX_FILE);

    it('has /media-stream WebSocket route', () => {
      expect(hasWebSocketRoute(indexSource, '/media-stream')).toBe(true);
    });

    it('has /media-stream-callback WebSocket route', () => {
      expect(hasWebSocketRoute(indexSource, '/media-stream-callback')).toBe(true);
    });

    it('handles response.function_call_arguments.done events', () => {
      expect(hasFunctionCallArgumentsHandler(indexSource)).toBe(true);
    });
  });

  // ---- 4. Main stream tool dispatch includes all expected tools ----
  describe('4. Main /media-stream tool dispatch covers expected tools', () => {
    const indexSource = readSourceFile(INDEX_FILE);
    const switchBlocks = extractToolSwitchBlocks(indexSource);

    it('has at least two switch(res.name) blocks (main + callback)', () => {
      expect(switchBlocks.length).toBeGreaterThanOrEqual(2);
    });

    // The first switch block is the main /media-stream handler
    it('main stream switch block dispatches all expected tools', () => {
      expect(switchBlocks.length).toBeGreaterThan(0);
      const mainBlock = switchBlocks[0];
      const dispatchedTools = extractSwitchCaseNames(mainBlock);

      for (const tool of MAIN_STREAM_DISPATCHED_TOOLS) {
        expect(
          dispatchedTools,
          `Main stream missing tool dispatch: ${tool}`
        ).toContain(tool);
      }
    });
  });

  // ---- 5. Callback stream tool dispatch includes expected tools ----
  describe('5. Callback /media-stream-callback tool dispatch covers expected tools', () => {
    const indexSource = readSourceFile(INDEX_FILE);
    const switchBlocks = extractToolSwitchBlocks(indexSource);

    it('callback stream switch block dispatches expected tools', () => {
      expect(switchBlocks.length).toBeGreaterThanOrEqual(2);
      const callbackBlock = switchBlocks[1];
      const dispatchedTools = extractSwitchCaseNames(callbackBlock);

      for (const tool of CALLBACK_STREAM_DISPATCHED_TOOLS) {
        expect(
          dispatchedTools,
          `Callback stream missing tool dispatch: ${tool}`
        ).toContain(tool);
      }
    });
  });

  // ---- 6. index.ts imports expected functions from tools.ts ----
  describe('6. index.ts imports expected functions from tools.ts', () => {
    const indexSource = readSourceFile(INDEX_FILE);
    const toolImports = extractImportsFrom(indexSource, '\\./tools\\.ts');

    for (const importName of EXPECTED_INDEX_IMPORTS) {
      it(`imports ${importName} from tools.ts`, () => {
        expect(
          toolImports,
          `Missing import: ${importName} in ${INDEX_FILE}`
        ).toContain(importName);
      });
    }
  });

  // ---- 7. generateOrderId exists and is a non-async function ----
  describe('7. generateOrderId function structure', () => {
    const toolsSource = readSourceFile(TOOLS_FILE);

    it('generateOrderId is exported as a synchronous function', () => {
      // Should match "export function generateOrderId" (no async)
      expect(toolsSource).toMatch(/export\s+function\s+generateOrderId\s*\(/);
    });

    it('generateOrderId returns a string', () => {
      expect(toolsSource).toMatch(/function\s+generateOrderId\s*\(\s*\)\s*:\s*string/);
    });
  });

  // ---- 8. index.ts has HTTP routes for call entry points ----
  describe('8. index.ts has HTTP entry-point routes', () => {
    const indexSource = readSourceFile(INDEX_FILE);

    it('has /incoming-call route', () => {
      expect(indexSource).toMatch(/["']\/incoming-call["']/);
    });

    it('has /callback route', () => {
      expect(indexSource).toMatch(/["']\/callback["']/);
    });

    it('has /health route', () => {
      expect(indexSource).toMatch(/["']\/health["']/);
    });
  });

  // ---- 9. Property: all voice call flow structural invariants hold ----
  describe('9. Property: voice call flow structural invariants', () => {
    /**
     * **Validates: Requirements 3.7**
     *
     * Property: For all expected wrapper functions in tools.ts and all expected
     * tool dispatch entries in index.ts, the following invariants hold:
     *   - Every wrapper function is exported from tools.ts
     *   - Every main-stream tool has a case in the first switch(res.name) block
     *   - Every callback-stream tool has a case in the second switch(res.name) block
     *   - Every expected import is present in index.ts
     *   - generateOrderId exists as a synchronous exported function
     */
    const toolsSource = readSourceFile(TOOLS_FILE);
    const indexSource = readSourceFile(INDEX_FILE);
    const exportedFunctions = extractExportedFunctions(toolsSource);
    const toolImports = extractImportsFrom(indexSource, '\\./tools\\.ts');
    const switchBlocks = extractToolSwitchBlocks(indexSource);

    it('all wrapper exports are present for any sampled wrapper', () => {
      const wrapperArb = fc.constantFrom(...EXPECTED_WRAPPER_EXPORTS);

      fc.assert(
        fc.property(wrapperArb, (wrapperName) => {
          expect(exportedFunctions).toContain(wrapperName);
        }),
        { numRuns: EXPECTED_WRAPPER_EXPORTS.length * 3 }
      );
    });

    it('all main-stream tools are dispatched for any sampled tool', () => {
      expect(switchBlocks.length).toBeGreaterThan(0);
      const mainDispatch = extractSwitchCaseNames(switchBlocks[0]);
      const toolArb = fc.constantFrom(...MAIN_STREAM_DISPATCHED_TOOLS);

      fc.assert(
        fc.property(toolArb, (toolName) => {
          expect(mainDispatch).toContain(toolName);
        }),
        { numRuns: MAIN_STREAM_DISPATCHED_TOOLS.length * 3 }
      );
    });

    it('all callback-stream tools are dispatched for any sampled tool', () => {
      expect(switchBlocks.length).toBeGreaterThanOrEqual(2);
      const callbackDispatch = extractSwitchCaseNames(switchBlocks[1]);
      const toolArb = fc.constantFrom(...CALLBACK_STREAM_DISPATCHED_TOOLS);

      fc.assert(
        fc.property(toolArb, (toolName) => {
          expect(callbackDispatch).toContain(toolName);
        }),
        { numRuns: CALLBACK_STREAM_DISPATCHED_TOOLS.length * 3 }
      );
    });

    it('all expected imports are present for any sampled import', () => {
      const importArb = fc.constantFrom(...EXPECTED_INDEX_IMPORTS);

      fc.assert(
        fc.property(importArb, (importName) => {
          expect(toolImports).toContain(importName);
        }),
        { numRuns: EXPECTED_INDEX_IMPORTS.length * 3 }
      );
    });
  });
});
