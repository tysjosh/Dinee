/**
 * Non-Regression Contract Test — Restaurant API Response Shapes (Property 11)
 *
 * **Validates: Requirements 8.2, 8.6, 24.1, 24.2**
 *
 * Property 11: Restaurant API responses are unchanged after logistics deployment
 * - For all existing restaurant API endpoints: response payload shapes match pre-logistics baseline
 * - New optional fields do not break existing consumers
 * - Shared file changes (schema, types, webhookEvents, featureFlags) are strictly additive
 *
 * Approach: static analysis of source files to verify structural invariants.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Constants — Pre-logistics baselines
// ============================================================================

/** All restaurant route handler files that must remain unmodified. */
const RESTAURANT_ROUTE_FILES = [
  "src/app/client/api/v1/partner/branches/route.ts",
  "src/app/client/api/v1/partner/calls/route.ts",
  "src/app/client/api/v1/partner/menus/route.ts",
  "src/app/client/api/v1/partner/orders/route.ts",
  "src/app/client/api/v1/partner/orders/[orderId]/route.ts",
  "src/app/client/api/v1/partner/restaurants/route.ts",
  "src/app/client/api/v1/partner/restaurants/[restaurantId]/route.ts",
  "src/app/client/api/v1/partner/webhooks/route.ts",
  "src/app/client/api/v1/partner/webhooks/[subscriptionId]/route.ts",
] as const;

/** Original restaurant API scopes that must always be present in API_SCOPES. */
const ORIGINAL_API_SCOPES = [
  "restaurants:read",
  "restaurants:write",
  "branches:read",
  "branches:write",
  "menus:read",
  "menus:write",
  "orders:read",
  "orders:write",
  "calls:read",
  "calls:write",
  "analytics:read",
  "webhooks:manage",
] as const;

/** Original webhook event types that must always be present in WebhookEventType. */
const ORIGINAL_WEBHOOK_EVENT_TYPES = [
  "order.created",
  "order.updated",
  "order.completed",
  "order.cancelled",
  "call.started",
  "call.ended",
  "call.transferred",
  "payment.completed",
  "payment.failed",
] as const;

/** Original feature flag names that must remain in the flag name validator. */
const ORIGINAL_FEATURE_FLAG_NAMES = [
  "upsell_prompts_enabled",
  "fraud_detection_enabled",
  "multi_location_routing_enabled",
  "partner_api_enabled",
  "webhook_delivery_enabled",
  "self_serve_billing_enabled",
  "legacy_api_mode",
  "migration_complete",
] as const;

/**
 * Existing tables in schema.ts whose core field definitions must not have
 * required (non-optional) fields added by the logistics deployment.
 * We check that any new fields on these tables are wrapped in v.optional().
 */
const EXISTING_TABLES_WITH_ADDITIVE_FIELDS = [
  "platforms",
  "orders",
  "calls",
  "partners",
  "webhookEvents",
] as const;

/**
 * Tables that must remain completely unchanged (no new fields at all).
 */
const UNCHANGED_TABLES = ["restaurants", "branches"] as const;

// ============================================================================
// Helpers
// ============================================================================

function readSourceFile(filePath: string): string {
  const fullPath = path.resolve(process.cwd(), filePath);
  return fs.readFileSync(fullPath, "utf-8");
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(path.resolve(process.cwd(), filePath));
}

/**
 * Extract all string literals from an `API_SCOPES` array declaration.
 */
function extractApiScopes(source: string): string[] {
  const scopesMatch = source.match(
    /export\s+const\s+API_SCOPES\s*=\s*\[([\s\S]*?)\]\s*as\s+const/
  );
  if (!scopesMatch) return [];
  const literals = scopesMatch[1].match(/'([^']+)'|"([^"]+)"/g) || [];
  return literals.map((l) => l.replace(/['"]/g, ""));
}

/**
 * Extract all string literals from the WebhookEventType union.
 */
function extractWebhookEventTypes(source: string): string[] {
  const typeMatch = source.match(
    /export\s+type\s+WebhookEventType\s*=\s*([\s\S]*?);/
  );
  if (!typeMatch) return [];
  const literals = typeMatch[1].match(/'([^']+)'|"([^"]+)"/g) || [];
  return literals.map((l) => l.replace(/['"]/g, ""));
}

/**
 * Extract feature flag name literals from the flagNameValidator union in featureFlags.ts.
 */
function extractFeatureFlagNames(source: string): string[] {
  // The validator is a v.union(...) of v.literal("name") calls
  const literals = source.match(/v\.literal\(\s*"([^"]+)"\s*\)/g) || [];
  return literals.map((l) => {
    const m = l.match(/"([^"]+)"/);
    return m ? m[1] : "";
  }).filter(Boolean);
}

/**
 * Extract the table definition block for a given table name from schema.ts source.
 * Returns the text from `tableName: defineTable({` to the matching closing.
 */
function extractTableBlock(schemaSource: string, tableName: string): string | null {
  // Match pattern: `tableName: defineTable({`
  const regex = new RegExp(
    `(?:^|\\n)\\s*(?:\\/\\/[^\\n]*\\n\\s*)*${tableName}:\\s*defineTable\\(\\{`,
    "m"
  );
  const match = regex.exec(schemaSource);
  if (!match) return null;

  const startIdx = match.index;
  // Find the balanced closing of defineTable({ ... })
  let depth = 0;
  let inDefineTable = false;
  let blockStart = schemaSource.indexOf("defineTable({", startIdx);
  if (blockStart === -1) return null;

  // Start after "defineTable("
  let i = blockStart + "defineTable(".length;
  depth = 1; // We're inside the outer parens of defineTable(...)
  inDefineTable = true;

  while (i < schemaSource.length && depth > 0) {
    const ch = schemaSource[i];
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") depth--;
    i++;
  }

  // Now find the end of the chain (.index(...).index(...), etc.)
  // Keep going while we see .index( or whitespace/newlines
  while (i < schemaSource.length) {
    const rest = schemaSource.slice(i).trimStart();
    if (rest.startsWith(".index(") || rest.startsWith(".searchIndex(")) {
      // Skip past this chained call
      const parenStart = schemaSource.indexOf("(", i + (rest.indexOf("(") ));
      if (parenStart === -1) break;
      let d = 1;
      let j = parenStart + 1;
      while (j < schemaSource.length && d > 0) {
        if (schemaSource[j] === "(") d++;
        else if (schemaSource[j] === ")") d--;
        j++;
      }
      i = j;
    } else {
      break;
    }
  }

  return schemaSource.slice(startIdx, i);
}

/**
 * Check if a table block contains any logistics-related comment markers,
 * indicating fields were added for the logistics vertical.
 */
function hasLogisticsComments(tableBlock: string): boolean {
  return /[Ll]ogistics/.test(tableBlock);
}

/**
 * Extract field definitions that were added for the logistics vertical.
 * Strategy: find comment lines mentioning "logistics", then collect only the
 * immediately following field lines that are clearly new additions (contain
 * a field name with `:` and `v.`). Stop at the first line that doesn't look
 * like a new field definition (e.g., a pre-existing field like `createdAt`).
 *
 * We identify logistics-added fields by checking that the field name itself
 * is one of the known logistics additions rather than a pre-existing field.
 */
const KNOWN_LOGISTICS_FIELD_NAMES = new Set([
  "enabledVerticals",
  "vertical",
  "locationId",
  "organizationIds",
  "shipmentId",
  "resourceType",
  "resourceId",
]);

function getLogisticsFieldLines(tableBlock: string): string[] {
  const lines = tableBlock.split("\n");
  const logisticsLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/[Ll]ogistics/.test(line) && line.trim().startsWith("//")) {
      // Collect subsequent field lines that are known logistics additions
      for (let j = i + 1; j < lines.length; j++) {
        const fieldLine = lines[j].trim();
        if (fieldLine.startsWith("//") || fieldLine === "" || fieldLine === "}" || fieldLine === "},") {
          break;
        }
        // Extract field name from line like `fieldName: v.optional(...),`
        const fieldNameMatch = fieldLine.match(/^(\w+)\s*:/);
        if (fieldNameMatch && KNOWN_LOGISTICS_FIELD_NAMES.has(fieldNameMatch[1])) {
          logisticsLines.push(fieldLine);
        } else {
          // Hit a non-logistics field, stop collecting
          break;
        }
      }
    }
  }
  return logisticsLines;
}

/**
 * Check that restaurant route files do NOT import from logistics modules.
 */
function importsLogisticsModules(source: string): boolean {
  return /from\s+['"].*logistics.*['"]/.test(source) ||
    /import\s+.*logistics/i.test(source);
}

// ============================================================================
// Tests
// ============================================================================

describe("Restaurant API Non-Regression Contract — Property 11", () => {
  // ── 1. Restaurant route handler files exist and are unmodified ─────────

  describe("1. Restaurant route handler files exist", () => {
    for (const routeFile of RESTAURANT_ROUTE_FILES) {
      it(`${routeFile} exists`, () => {
        expect(fileExists(routeFile), `Missing route file: ${routeFile}`).toBe(true);
      });
    }
  });

  describe("2. Restaurant route handlers do not import logistics modules", () => {
    for (const routeFile of RESTAURANT_ROUTE_FILES) {
      it(`${routeFile} has no logistics imports`, () => {
        const source = readSourceFile(routeFile);
        expect(
          importsLogisticsModules(source),
          `${routeFile} imports from logistics modules — this breaks isolation`
        ).toBe(false);
      });
    }
  });

  describe("3. Restaurant route handlers preserve structural patterns", () => {
    for (const routeFile of RESTAURANT_ROUTE_FILES) {
      it(`${routeFile} still imports validateApiRequest from middleware`, () => {
        const source = readSourceFile(routeFile);
        expect(
          /import\s+\{[^}]*validateApiRequest[^}]*\}\s+from\s+['"]@\/lib\/partner-api\/middleware['"]/.test(source)
        ).toBe(true);
      });

      it(`${routeFile} still uses NextResponse.json()`, () => {
        const source = readSourceFile(routeFile);
        expect(source).toContain("NextResponse.json(");
      });
    }
  });

  // ── 4. types.ts — API_SCOPES preserves all original scopes ────────────

  describe("4. API_SCOPES array preserves all original restaurant scopes", () => {
    const typesSource = readSourceFile("src/lib/partner-api/types.ts");
    const actualScopes = extractApiScopes(typesSource);

    for (const scope of ORIGINAL_API_SCOPES) {
      it(`API_SCOPES contains "${scope}"`, () => {
        expect(actualScopes).toContain(scope);
      });
    }

    it("new scopes are additive only (original scopes still present)", () => {
      for (const scope of ORIGINAL_API_SCOPES) {
        expect(actualScopes).toContain(scope);
      }
      // Any additional scopes are fine — they're additive
    });
  });

  // ── 5. types.ts — WebhookEventType preserves all original event types ─

  describe("5. WebhookEventType preserves all original event types", () => {
    const typesSource = readSourceFile("src/lib/partner-api/types.ts");
    const actualTypes = extractWebhookEventTypes(typesSource);

    for (const eventType of ORIGINAL_WEBHOOK_EVENT_TYPES) {
      it(`WebhookEventType contains "${eventType}"`, () => {
        expect(actualTypes).toContain(eventType);
      });
    }

    it("new event types are additive only (original types still present)", () => {
      for (const eventType of ORIGINAL_WEBHOOK_EVENT_TYPES) {
        expect(actualTypes).toContain(eventType);
      }
    });
  });

  // ── 6. featureFlags.ts — original flag names preserved ────────────────

  describe("6. Feature flag names preserve all original flags", () => {
    const flagsSource = readSourceFile("convex/featureFlags.ts");
    const actualFlags = extractFeatureFlagNames(flagsSource);

    for (const flag of ORIGINAL_FEATURE_FLAG_NAMES) {
      it(`featureFlags contains "${flag}"`, () => {
        expect(actualFlags).toContain(flag);
      });
    }
  });

  // ── 7. schema.ts — restaurants and branches tables unchanged ──────────

  describe("7. Unchanged tables have no logistics modifications", () => {
    const schemaSource = readSourceFile("convex/schema.ts");

    for (const table of UNCHANGED_TABLES) {
      it(`"${table}" table has no logistics-related comments or fields`, () => {
        const block = extractTableBlock(schemaSource, table);
        expect(block, `Could not find "${table}" table in schema.ts`).not.toBeNull();
        expect(
          hasLogisticsComments(block!),
          `"${table}" table contains logistics-related modifications`
        ).toBe(false);
      });
    }
  });

  // ── 8. schema.ts — additive fields on existing tables are v.optional() ─

  describe("8. Additive logistics fields on existing tables are all v.optional()", () => {
    const schemaSource = readSourceFile("convex/schema.ts");

    for (const table of EXISTING_TABLES_WITH_ADDITIVE_FIELDS) {
      it(`"${table}" table logistics fields are all v.optional()`, () => {
        const block = extractTableBlock(schemaSource, table);
        expect(block, `Could not find "${table}" table in schema.ts`).not.toBeNull();

        const logisticsFields = getLogisticsFieldLines(block!);
        // If there are logistics fields, each must use v.optional()
        for (const fieldLine of logisticsFields) {
          expect(
            fieldLine.includes("v.optional("),
            `Non-optional logistics field found in "${table}": ${fieldLine.trim()}`
          ).toBe(true);
        }
      });
    }
  });

  // ── 9. webhookEvents.ts — original functions preserved ────────────────

  describe("9. webhookEvents.ts preserves original function exports", () => {
    const whSource = readSourceFile("convex/webhookEvents.ts");

    const originalFunctions = [
      "createWebhookEvent",
      "getWebhookEventByEventId",
      "getWebhookEventsByOrderId",
      "markWebhookEventAsProcessed",
      "updateWebhookEventVerification",
      "getUnprocessedWebhookEvents",
      "getWebhookEventsByProvider",
      "isWebhookEventProcessed",
    ];

    for (const fn of originalFunctions) {
      it(`exports "${fn}"`, () => {
        expect(whSource).toContain(fn);
      });
    }

    it("atomicInsertWebhookEvent is additive (new function)", () => {
      expect(whSource).toContain("atomicInsertWebhookEvent");
    });
  });

  // ── 10. Property-based: for any restaurant route, all contract invariants hold ─

  describe("10. Property: all contract invariants hold for any restaurant route", () => {
    /**
     * **Validates: Requirements 8.2, 8.6, 24.1, 24.2**
     *
     * For all restaurant API route files drawn from the baseline set:
     * - File exists
     * - Does not import logistics modules
     * - Imports validateApiRequest from middleware
     * - Uses NextResponse.json() for responses
     * - Contains success: true pattern
     * - Contains { error, message } error shape
     */
    const routeArb = fc.constantFrom(...RESTAURANT_ROUTE_FILES);

    it("structural contract invariants hold for all restaurant routes", () => {
      fc.assert(
        fc.property(routeArb, (routeFile) => {
          // File exists
          expect(fileExists(routeFile)).toBe(true);

          const source = readSourceFile(routeFile);

          // No logistics imports
          expect(importsLogisticsModules(source)).toBe(false);

          // Imports validateApiRequest
          expect(
            /import\s+\{[^}]*validateApiRequest[^}]*\}\s+from\s+['"]@\/lib\/partner-api\/middleware['"]/.test(source)
          ).toBe(true);

          // Uses NextResponse.json()
          expect(source).toContain("NextResponse.json(");

          // Uses success: true as const pattern
          expect(/success:\s*true\s+as\s+const/.test(source)).toBe(true);

          // Uses { error, message } error shape
          expect(/\{\s*error:\s*['"][^'"]+['"]\s*,\s*message:/.test(source)).toBe(true);
        }),
        { numRuns: RESTAURANT_ROUTE_FILES.length * 3 }
      );
    });
  });

  // ── 11. Property: all original scopes/event types preserved across shared files ─

  describe("11. Property: shared type definitions are backward-compatible", () => {
    /**
     * **Validates: Requirements 8.6, 24.1, 24.2**
     *
     * For any original API scope: it is still present in API_SCOPES.
     * For any original webhook event type: it is still present in WebhookEventType.
     * For any original feature flag: it is still present in the flag name validator.
     */
    const typesSource = readSourceFile("src/lib/partner-api/types.ts");
    const actualScopes = extractApiScopes(typesSource);
    const actualEventTypes = extractWebhookEventTypes(typesSource);
    const flagsSource = readSourceFile("convex/featureFlags.ts");
    const actualFlags = extractFeatureFlagNames(flagsSource);

    const scopeArb = fc.constantFrom(...ORIGINAL_API_SCOPES);
    const eventTypeArb = fc.constantFrom(...ORIGINAL_WEBHOOK_EVENT_TYPES);
    const flagArb = fc.constantFrom(...ORIGINAL_FEATURE_FLAG_NAMES);

    it("every original API scope is preserved", () => {
      fc.assert(
        fc.property(scopeArb, (scope) => {
          expect(actualScopes).toContain(scope);
        }),
        { numRuns: ORIGINAL_API_SCOPES.length * 3 }
      );
    });

    it("every original webhook event type is preserved", () => {
      fc.assert(
        fc.property(eventTypeArb, (eventType) => {
          expect(actualEventTypes).toContain(eventType);
        }),
        { numRuns: ORIGINAL_WEBHOOK_EVENT_TYPES.length * 3 }
      );
    });

    it("every original feature flag name is preserved", () => {
      fc.assert(
        fc.property(flagArb, (flag) => {
          expect(actualFlags).toContain(flag);
        }),
        { numRuns: ORIGINAL_FEATURE_FLAG_NAMES.length * 3 }
      );
    });
  });
});
