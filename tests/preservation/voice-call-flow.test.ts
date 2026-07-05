/**
 * Preservation Test — Voice Call Flow Structure (post pack-extraction)
 *
 * Validates: Requirements 3.7
 *
 * This test establishes the baseline behavior of the voice call flow that MUST
 * be preserved. The dinee-voice-platform refactor (task 4.8) extracted the
 * ws-server voice logic into VoiceDomainPacks and removed the legacy
 * `src/app/ws-server/tools.ts` / `call-phase.ts` modules and the inline
 * per-vertical branching in `index.ts`. This test was updated to pin the SAME
 * capabilities in their new home:
 *   1. The restaurant wrapper functions are exported from the restaurant pack
 *      wrappers module (still authenticated — see the C3 auth test).
 *   2. The restaurant pack declares the tool definitions the agent dispatches.
 *   3. index.ts still registers the WebSocket routes and handles tool calls.
 *   4. The callback route still dispatches its restaurant tool subset.
 *   5. index.ts imports the wrappers from the restaurant pack.
 *   6. generateOrderId still exists as a synchronous function.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import fc from 'fast-check';

// ============================================================================
// Observed Baseline — restaurant pack wrappers, tool definitions, and dispatch
// ============================================================================

/** Wrapper functions that must be exported from the restaurant pack wrappers. */
const EXPECTED_WRAPPER_EXPORTS = [
  'wrapperGetRestaurantDetails',
  'wrapperUpsertCallData',
  'wrapperAddTranscriptDialogues',
  'wrapperUpsertOrders',
  'wrapperMatchUpsellPrompts',
  'wrapperRecordPromptAcceptance',
  'wrapperCheckBlocked',
] as const;

/** Non-wrapper utility functions that must be exported from the wrappers module. */
const EXPECTED_WRAPPER_UTILITY_EXPORTS = [
  'extractItemCategories',
  'calculateOrderTotal',
  'generateBlockedCallTwiML',
  'generateVerificationTransferTwiML',
] as const;

/**
 * Tool definitions the restaurant pack must declare — the tool names the OpenAI
 * Realtime API calls during a normal restaurant call (formerly the main
 * /media-stream switch dispatch).
 */
const RESTAURANT_PACK_TOOLS = [
  'get_restaurant_details',
  'add_transcript_dialogue',
  'upsert_order',
  'upsert_call_data',
  'generate_order_id',
] as const;

/**
 * Tools dispatched in the /media-stream-callback switch statement (still an
 * inline switch on the callback route).
 */
const CALLBACK_STREAM_DISPATCHED_TOOLS = [
  'get_restaurant_details',
  'upsert_order',
  'generate_order_id',
] as const;

/** Functions imported from the restaurant pack wrappers into index.ts. */
const EXPECTED_INDEX_WRAPPER_IMPORTS = [
  'wrapperGetRestaurantDetails',
  'wrapperUpsertCallData',
  'wrapperAddTranscriptDialogues',
  'wrapperUpsertOrders',
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

/** Extract the tool names declared in a VoiceDomainPack tool-definition module. */
function extractToolDefinitionNames(source: string): string[] {
  const names: string[] = [];
  const nameRegex = /name:\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = nameRegex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function extractImportedNames(source: string, modulePattern: string): string[] {
  const importRegex = new RegExp(
    `import\\s*\\{([^}]+)\\}\\s*from\\s*["'][^"']*${modulePattern}[^"']*["']`,
    'g'
  );
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    const imports = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    names.push(...imports);
  }
  return names;
}

function extractToolSwitchBlocks(source: string): string[] {
  const blocks: string[] = [];
  const switchPattern = /switch\s*\(\s*(?:res\.name|toolName)\s*\)\s*\{/g;
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

function findSwitchBlocksContaining(blocks: string[], toolName: string): string[] {
  return blocks.filter((block) => {
    const cases = extractSwitchCaseNames(block);
    return cases.includes(toolName);
  });
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

const WRAPPERS_FILE = 'src/lib/modules/packs/restaurant/wrappers.ts';
const HANDLERS_FILE = 'src/lib/modules/packs/restaurant/handlers.ts';
const TOOL_DEFS_FILE = 'src/lib/modules/packs/restaurant/tools.ts';
const INDEX_FILE = 'src/app/ws-server/index.ts';

describe('Voice Call Flow Preservation — pack-extracted structure baseline', () => {
  // ---- 1. restaurant wrappers module exports all expected wrapper functions ----
  describe('1. restaurant wrappers module exports all expected wrapper functions', () => {
    const source = readSourceFile(WRAPPERS_FILE);
    const exportedFunctions = extractExportedFunctions(source);

    for (const wrapperName of EXPECTED_WRAPPER_EXPORTS) {
      it(`exports ${wrapperName}`, () => {
        expect(
          exportedFunctions,
          `Missing export: ${wrapperName} in ${WRAPPERS_FILE}`
        ).toContain(wrapperName);
      });
    }
  });

  // ---- 2. wrappers + handlers export utility functions ----
  describe('2. restaurant pack exports utility functions', () => {
    const wrappersSource = readSourceFile(WRAPPERS_FILE);
    const handlersSource = readSourceFile(HANDLERS_FILE);
    const wrapperFns = extractExportedFunctions(wrappersSource);
    const handlerFns = extractExportedFunctions(handlersSource);

    for (const utilName of EXPECTED_WRAPPER_UTILITY_EXPORTS) {
      it(`exports ${utilName} from wrappers`, () => {
        expect(
          wrapperFns,
          `Missing export: ${utilName} in ${WRAPPERS_FILE}`
        ).toContain(utilName);
      });
    }

    it('exports generateOrderId from handlers', () => {
      expect(handlerFns, `Missing export: generateOrderId in ${HANDLERS_FILE}`).toContain(
        'generateOrderId'
      );
    });
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

  // ---- 4. Restaurant pack declares all expected tool definitions ----
  describe('4. restaurant pack declares all expected tool definitions', () => {
    const toolDefsSource = readSourceFile(TOOL_DEFS_FILE);
    const declaredTools = extractToolDefinitionNames(toolDefsSource);

    for (const tool of RESTAURANT_PACK_TOOLS) {
      it(`declares tool ${tool}`, () => {
        expect(
          declaredTools,
          `Restaurant pack missing tool definition: ${tool}`
        ).toContain(tool);
      });
    }
  });

  // ---- 5. Callback stream tool dispatch includes expected tools ----
  describe('5. Callback /media-stream-callback tool dispatch covers expected tools', () => {
    const indexSource = readSourceFile(INDEX_FILE);
    const switchBlocks = extractToolSwitchBlocks(indexSource);

    it('callback stream switch block dispatches expected tools', () => {
      const restaurantBlocks = findSwitchBlocksContaining(switchBlocks, 'get_restaurant_details');
      expect(restaurantBlocks.length).toBeGreaterThanOrEqual(1);
      const callbackBlock = restaurantBlocks[restaurantBlocks.length - 1];
      const dispatchedTools = extractSwitchCaseNames(callbackBlock);

      for (const tool of CALLBACK_STREAM_DISPATCHED_TOOLS) {
        expect(
          dispatchedTools,
          `Callback stream missing tool dispatch: ${tool}`
        ).toContain(tool);
      }
    });
  });

  // ---- 6. index.ts imports wrappers from the restaurant pack ----
  describe('6. index.ts imports wrappers from the restaurant pack', () => {
    const indexSource = readSourceFile(INDEX_FILE);
    const wrapperImports = extractImportedNames(indexSource, 'packs/restaurant/wrappers');

    for (const importName of EXPECTED_INDEX_WRAPPER_IMPORTS) {
      it(`imports ${importName} from the restaurant pack wrappers`, () => {
        expect(
          wrapperImports,
          `Missing import: ${importName} in ${INDEX_FILE}`
        ).toContain(importName);
      });
    }
  });

  // ---- 7. generateOrderId exists and is a non-async function ----
  describe('7. generateOrderId function structure', () => {
    const handlersSource = readSourceFile(HANDLERS_FILE);

    it('generateOrderId is exported as a synchronous function', () => {
      expect(handlersSource).toMatch(/export\s+function\s+generateOrderId\s*\(/);
    });

    it('generateOrderId returns a string', () => {
      expect(handlersSource).toMatch(/function\s+generateOrderId\s*\(\s*\)\s*:\s*string/);
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
     * Property: the extracted voice-call-flow building blocks are all present:
     *   - Every wrapper function is exported from the restaurant wrappers module
     *   - Every expected restaurant tool is declared in the pack tool definitions
     *   - Every callback-stream tool has a case in the callback switch block
     *   - Every expected wrapper import is present in index.ts
     */
    const wrappersSource = readSourceFile(WRAPPERS_FILE);
    const toolDefsSource = readSourceFile(TOOL_DEFS_FILE);
    const indexSource = readSourceFile(INDEX_FILE);
    const exportedFunctions = extractExportedFunctions(wrappersSource);
    const declaredTools = extractToolDefinitionNames(toolDefsSource);
    const wrapperImports = extractImportedNames(indexSource, 'packs/restaurant/wrappers');
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

    it('all expected restaurant tools are declared for any sampled tool', () => {
      const toolArb = fc.constantFrom(...RESTAURANT_PACK_TOOLS);

      fc.assert(
        fc.property(toolArb, (toolName) => {
          expect(declaredTools).toContain(toolName);
        }),
        { numRuns: RESTAURANT_PACK_TOOLS.length * 3 }
      );
    });

    it('all callback-stream tools are dispatched for any sampled tool', () => {
      const restaurantBlocks = findSwitchBlocksContaining(switchBlocks, 'get_restaurant_details');
      expect(restaurantBlocks.length).toBeGreaterThanOrEqual(1);
      const callbackDispatch = extractSwitchCaseNames(restaurantBlocks[restaurantBlocks.length - 1]);
      const toolArb = fc.constantFrom(...CALLBACK_STREAM_DISPATCHED_TOOLS);

      fc.assert(
        fc.property(toolArb, (toolName) => {
          expect(callbackDispatch).toContain(toolName);
        }),
        { numRuns: CALLBACK_STREAM_DISPATCHED_TOOLS.length * 3 }
      );
    });

    it('all expected wrapper imports are present for any sampled import', () => {
      const importArb = fc.constantFrom(...EXPECTED_INDEX_WRAPPER_IMPORTS);

      fc.assert(
        fc.property(importArb, (importName) => {
          expect(wrapperImports).toContain(importName);
        }),
        { numRuns: EXPECTED_INDEX_WRAPPER_IMPORTS.length * 3 }
      );
    });
  });
});
