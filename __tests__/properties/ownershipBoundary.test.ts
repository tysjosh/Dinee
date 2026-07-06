/**
 * Feature: dinee-voice-platform, Task 9.11: structural ownership-boundary test
 *
 * Validates: Requirements 10.7, 10.8, 20.1, 20.2, 20.3 (the ownership boundary)
 *   (task also references 12.8, 20.4, 9.2 for the review-queue / submission-path
 *   / auto-submit-toggle structural checks below)
 *
 * The most important constraint in the design (§"Ownership Boundary"):
 * operational truth lives in the Runsheet backend, NEVER in Dinee. Dinee stores
 * ONLY the concerns it owns — phone-number→conversation-type mappings, agent /
 * VoiceDomainPack configuration, integration configuration, call records,
 * transcripts, and audit logs (Req 20.1). The voice intake request record, the
 * persisted Order_Draft, the Dispatcher_Review_Queue, and the final order state
 * are owned and stored by the Runsheet backend (Req 20.2, 10.8). Any Order_Draft
 * Dinee produces is held TRANSIENTLY in memory only and is never persisted as a
 * Dinee order-of-record (Req 10.7, 20.3).
 *
 * These are STRUCTURAL properties of the Dinee repository, so this test reads the
 * source of record (the Convex schema, the transient OrderDraft module, the admin
 * UI, and the app routes) as text and asserts the boundary holds by construction.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import { buildOrderDraft, type OrderDraft } from "../../src/lib/modules/packs/runsheet/slots";

// ─── Locate the source-of-record files ──────────────────────────────────────

const repoRoot = path.join(__dirname, "..", "..");
const schemaPath = path.join(repoRoot, "convex", "schema.ts");
const slotsPath = path.join(repoRoot, "src", "lib", "modules", "packs", "runsheet", "slots.ts");
const intakeClientPath = path.join(
  repoRoot,
  "src",
  "lib",
  "integrations",
  "runsheet",
  "voiceIntakeClient.ts"
);
// The Runsheet-specific admin page was retired to a redirect; Auto_Submit is
// now an admin-configurable typed config field on the Runsheet platform
// definition, rendered by the generic platform integration admin.
const runsheetPlatformPath = path.join(
  repoRoot,
  "src",
  "lib",
  "integrations",
  "runsheet",
  "platform.ts"
);
const platformAdminPath = path.join(
  repoRoot,
  "src",
  "components",
  "dashboard",
  "PlatformIntegrationAdmin.tsx"
);
const appDir = path.join(repoRoot, "src", "app");

const schemaSource = readFileSync(schemaPath, "utf8");

/**
 * Extract every table name declared in the Convex schema. Tables are declared as
 * `<name>: defineTable({ ... })`, so we capture the identifier immediately before
 * `defineTable(`.
 */
function extractConvexTableNames(source: string): string[] {
  const names: string[] = [];
  const re = /(\w+)\s*:\s*defineTable\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

const tableNames = extractConvexTableNames(schemaSource);

// ─── Dinee stores ONLY what it owns (Req 20.1) ───────────────────────────────

describe("Ownership boundary — Dinee Convex schema (Req 20.1, 20.2, 10.8)", () => {
  it("declares at least one table (sanity: the schema parsed)", () => {
    expect(tableNames.length).toBeGreaterThan(0);
  });

  it("defines the two Dinee-owned Runsheet tables: runsheetIntegrations + runsheetNumberAssignments (Req 20.1)", () => {
    // These are the ONLY Runsheet-related concerns Dinee stores: the integration
    // configuration and the phone-number→conversation-type routing mapping.
    expect(tableNames).toContain("runsheetIntegrations");
    expect(tableNames).toContain("runsheetNumberAssignments");
  });

  it("does NOT define an orderDrafts table — the Order_Draft is Runsheet-owned (Req 20.2, 20.3)", () => {
    expect(tableNames).not.toContain("orderDrafts");
    // Guard against any near-miss naming (orderDraft, order_drafts, voiceOrderDrafts, ...).
    const draftLike = tableNames.filter((n) => /order.?draft/i.test(n));
    expect(draftLike).toEqual([]);
  });

  it("does NOT define a voiceIntakeRequests table — the intake request record is Runsheet-owned (Req 10.8, 20.2)", () => {
    expect(tableNames).not.toContain("voiceIntakeRequests");
    const intakeLike = tableNames.filter((n) => /voice.?intake.?request/i.test(n));
    expect(intakeLike).toEqual([]);
  });

  it("does NOT define a dispatcher-review-queue table — the review queue is Runsheet-owned (Req 20.2, 12.8)", () => {
    const reviewQueueLike = tableNames.filter(
      (n) => /(dispatch|dispatcher).*(review|queue)/i.test(n) || /reviewQueue/i.test(n)
    );
    expect(reviewQueueLike).toEqual([]);
  });

  it("does NOT define a final-order-of-record table for voice-originated orders (Req 20.2)", () => {
    // Dinee never becomes the system of record for voice-originated orders.
    const voiceOrderLike = tableNames.filter((n) => /voice.?order/i.test(n));
    expect(voiceOrderLike).toEqual([]);
  });
});

// ─── The Order_Draft is transient / in-memory only (Req 10.7, 20.3) ──────────

describe("Ownership boundary — transient in-memory Order_Draft (Req 10.7, 20.3)", () => {
  const slotsSource = readFileSync(slotsPath, "utf8");

  it("exports the OrderDraft as a plain TypeScript type (not a Convex table)", () => {
    // A structural TypeScript type declaration, never a `defineTable(...)`.
    expect(/export\s+interface\s+OrderDraft\b/.test(slotsSource)).toBe(true);
  });

  it("slots.ts contains NO Convex persistence — no defineTable, no defineSchema", () => {
    expect(slotsSource).not.toMatch(/defineTable/);
    expect(slotsSource).not.toMatch(/defineSchema/);
  });

  it("slots.ts does NOT import Convex server/database primitives (pure in-memory module)", () => {
    // No import from "convex/server", "convex/values", or the generated data model.
    expect(slotsSource).not.toMatch(/from\s+["']convex\/server["']/);
    expect(slotsSource).not.toMatch(/from\s+["']convex\/values["']/);
    expect(slotsSource).not.toMatch(/_generated\/(server|dataModel)/);
  });

  it("buildOrderDraft produces a plain in-memory object with no persistence handles (Req 10.7)", () => {
    const draft: OrderDraft = buildOrderDraft(
      {
        slots: {
          customer: { rawValue: "Acme Fuel", requestCount: 1 },
          delivery_site: { rawValue: "Site A", requestCount: 1 },
          product_code: { rawValue: "diesel", requestCount: 1 },
          quantity: { rawValue: "500 gallons", requestCount: 1 },
          delivery_window: { rawValue: "tomorrow morning", requestCount: 1 },
        },
        confidenceScore: 0.9,
      },
      { requiresPurchaseOrder: false }
    );

    // A plain object literal — the transient draft — with exactly the in-memory
    // shape and no Convex document id (`_id`) or persistence metadata.
    expect(draft).toBeTypeOf("object");
    expect(draft).not.toHaveProperty("_id");
    expect(draft).not.toHaveProperty("_creationTime");
    expect(Object.keys(draft).sort()).toEqual(
      ["confidenceScore", "missingSlots", "slots", "urgency"].sort()
    );
  });
});

// ─── The only Dinee submission path is the Intake_Contract client (Req 20.4) ─

describe("Ownership boundary — submission path (Req 20.4)", () => {
  it("the signed Intake_Contract client exists as the submission seam", () => {
    expect(existsSync(intakeClientPath)).toBe(true);
    const intakeSource = readFileSync(intakeClientPath, "utf8");
    // It is the module that signs and POSTs the intake payload over the contract.
    expect(intakeSource).toMatch(/submitVoiceIntake/);
    expect(intakeSource).toMatch(/signIntake/);
  });

  it("no Dinee Convex function persists a voice-originated order-of-record", () => {
    // Since there is no orderDrafts / voiceIntakeRequests table, there can be no
    // Dinee mutation that inserts one. Assert no convex/runsheet module inserts
    // into a would-be order table.
    const runsheetConvexDir = path.join(repoRoot, "convex", "runsheet");
    if (existsSync(runsheetConvexDir)) {
      for (const file of readdirSync(runsheetConvexDir)) {
        if (!file.endsWith(".ts")) continue;
        const src = readFileSync(path.join(runsheetConvexDir, file), "utf8");
        expect(src).not.toMatch(/\.insert\(\s*["']orderDrafts["']/);
        expect(src).not.toMatch(/\.insert\(\s*["']voiceIntakeRequests["']/);
      }
    }
  });
});

// ─── No Dinee review-queue page (Req 12.8) ───────────────────────────────────

describe("Ownership boundary — no Dinee review-queue page (Req 12.8)", () => {
  /** Recursively collect route file paths (page/route) under src/app. */
  function collectRouteFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectRouteFiles(full, acc);
      } else if (/(page|route)\.(t|j)sx?$/.test(entry.name)) {
        acc.push(full);
      }
    }
    return acc;
  }

  it("no route directory or page implements a dispatcher review queue", () => {
    const routeFiles = collectRouteFiles(appDir);
    const reviewQueueRoutes = routeFiles.filter((f) => {
      const rel = path.relative(appDir, f).toLowerCase();
      return (
        /(dispatch|dispatcher).*(review|queue)/.test(rel) ||
        /review-queue/.test(rel) ||
        /review_queue/.test(rel)
      );
    });
    expect(reviewQueueRoutes).toEqual([]);
  });
});

// ─── Admin UI surfaces the Auto_Submit toggle now that Req 9.3 is delivered ──
//
// This block previously encoded the MVP-only invariant (Req 9.2): no Auto_Submit
// toggle surfaced during MVP. That invariant was intentionally superseded when
// task 12.2 (Req 9.3) was completed and the Auto_Submit feature (Req 13) was
// delivered — the Runsheet admin page now exposes an admin-configurable
// enable/disable control. The assertion is inverted accordingly: the toggle
// SHOULD now be present and wired to an interactive, accessible control.

describe("Ownership boundary — Auto_Submit toggle is surfaced (Req 9.3)", () => {
  it("the Runsheet platform definition declares an admin-configurable Auto_Submit control", () => {
    expect(existsSync(runsheetPlatformPath)).toBe(true);
    const source = readFileSync(runsheetPlatformPath, "utf8");

    // Req 9.3: Auto_Submit is admin-configurable — the platform declares an
    // `autoSubmitEnabled` config field so it renders as a first-class setting
    // rather than being hidden in a raw JSON blob.
    expect(source).toMatch(/autoSubmitEnabled/);

    // The field must be part of the typed configFields schema and be a boolean
    // (i.e. an enable/disable control), so the admin renders it as a toggle.
    expect(source).toMatch(/configFields/);
    const autoSubmitBlock = source
      .slice(source.indexOf("autoSubmitEnabled"))
      .slice(0, 200);
    expect(autoSubmitBlock).toMatch(/type:\s*["']boolean["']/);
  });

  it("the generic platform admin renders boolean config fields as accessible interactive controls", () => {
    expect(existsSync(platformAdminPath)).toBe(true);
    const source = readFileSync(platformAdminPath, "utf8");

    // Boolean config fields (like Auto_Submit) render as an accessible switch:
    // a checkbox with role="switch" wired to an onChange handler.
    const interactiveBoolean = source
      .split("\n")
      .filter((line) =>
        /(type="checkbox"|role="switch"|checked=|onChange)/.test(line)
      );
    expect(interactiveBoolean.length).toBeGreaterThan(0);
    expect(source).toMatch(/type="checkbox"/);
    expect(source).toMatch(/role="switch"/);
  });
});
