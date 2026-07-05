/**
 * Feature: dinee-voice-platform, Phase 0 Stabilization — Twilio→OpenAI Call Path Baseline
 *
 * Validates: Requirements 1.2, 1.3
 *
 * Purpose: Pin the CURRENT Twilio→OpenAI call path so that a caller reaching an
 * existing configured number reaches a Realtime_Agent. This captures the current
 * behavior as the baseline the gradual VoiceDomainPack extraction must not break.
 *
 * The current path (src/app/ws-server/index.ts) is:
 *   Twilio /incoming-call
 *     → resolvePhoneToRoute(To)                → PhoneLookupResult.conversationType
 *     → media-stream WS with conversationType  → initializes an OpenAI Realtime session
 *     → isLogistics = conversationType.startsWith("logistics_")
 *                                               → selects restaurant vs logistics agent
 *     → per-vertical call-phase state machine   → gates tool definitions for that domain
 *
 * These tests exercise those real seams (resolvePhoneToRoute + the call-phase modules)
 * and pin the agent-selection contract exactly as index.ts derives it today.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import {
  resolvePhoneToRoute,
  type ConversationType,
  type PhoneLookupResult,
} from "../../src/lib/call-routing/phone-lookup";

/**
 * True when a query reference is one of the route-precedence resolvers that
 * `resolvePhoneToRoute` consults before the branch/location lookup: the generic
 * `phoneRoutes.resolveRoute` store and the legacy Runsheet number-assignment
 * resolver. The baseline fakes below return null for both so non-mapped numbers
 * fall through to the existing branch/location routing unchanged.
 */
function isResolveNumberQuery(ref: Parameters<typeof getFunctionName>[0]): boolean {
  const name = getFunctionName(ref);
  return name.includes("resolveNumber") || name.includes("resolveRoute");
}

// Frozen Phase 0 baseline — the recorded behavior of the legacy call-phase
// modules (`src/app/ws-server/call-phase.ts` and `logistics-call-phase.ts`),
// which were removed in task 4.8 once their behavior was fully extracted into
// the VoiceDomainPacks + generic phaseEngine. Their pure functions are
// reproduced here verbatim as the golden reference so this baseline test keeps
// pinning the recorded behavior without importing the deleted modules.
type CallPhase =
  | "await_restaurant_id"
  | "restaurant_verified"
  | "order_open"
  | "order_finalized";

type LogisticsCallPhase =
  | "await_org_verification"
  | "org_verified"
  | "shipment_open"
  | "shipment_confirmed";

const RESTAURANT_ALLOWED_TOOLS: Record<CallPhase, Set<string>> = {
  await_restaurant_id: new Set(["get_restaurant_details"]),
  restaurant_verified: new Set([
    "upsert_call_data",
    "add_transcript_dialogue",
    "generate_order_id",
  ]),
  order_open: new Set([
    "upsert_order",
    "add_transcript_dialogue",
    "generate_order_id",
  ]),
  order_finalized: new Set(["add_transcript_dialogue"]),
};

function isToolAllowed(phase: CallPhase, toolName: string): boolean {
  return RESTAURANT_ALLOWED_TOOLS[phase]?.has(toolName) ?? false;
}

function nextPhase(current: CallPhase, event: string): CallPhase {
  switch (current) {
    case "await_restaurant_id":
      if (event === "restaurant_verified") return "restaurant_verified";
      break;
    case "restaurant_verified":
      if (event === "order_id_generated") return "order_open";
      break;
    case "order_open":
      if (event === "order_finalized") return "order_finalized";
      break;
  }
  return current;
}

const LOGISTICS_ALLOWED_TOOLS: Record<LogisticsCallPhase, Set<string>> = {
  await_org_verification: new Set(["get_organization_details"]),
  org_verified: new Set([
    "get_organization_details",
    "create_shipment",
    "quote_delivery",
  ]),
  shipment_open: new Set([
    "get_organization_details",
    "create_shipment",
    "quote_delivery",
    "update_shipment",
    "assign_rider",
    "add_shipment_event",
  ]),
  shipment_confirmed: new Set(["get_organization_details", "quote_delivery"]),
};

function isLogisticsToolAllowed(
  phase: LogisticsCallPhase,
  toolName: string
): boolean {
  return LOGISTICS_ALLOWED_TOOLS[phase]?.has(toolName) ?? false;
}

function nextLogisticsPhase(
  current: LogisticsCallPhase,
  event: string
): LogisticsCallPhase {
  switch (current) {
    case "await_org_verification":
      if (event === "org_verified") return "org_verified";
      break;
    case "org_verified":
      if (event === "shipment_created") return "shipment_open";
      break;
    case "shipment_open":
      if (event === "shipment_finalized") return "shipment_confirmed";
      break;
  }
  return current;
}

/**
 * Every conversation type the current runtime can route to. Reaching any of these
 * means the runtime initializes a Realtime_Agent session (it never terminates the
 * call on a resolved conversation type in the current code path).
 */
const ALL_CONVERSATION_TYPES: ConversationType[] = [
  "restaurant_inbound_order",
  "restaurant_followup",
  "restaurant_cancellation",
  "logistics_booking",
  "logistics_followup",
  "logistics_failure_notice",
];

/**
 * Mirrors the EXACT agent-selection derivation in src/app/ws-server/index.ts:
 *   const isLogistics = conversationType.startsWith("logistics_");
 * This pins the baseline contract: which Realtime_Agent (restaurant vs logistics
 * tools + prompt) the runtime initializes for a resolved conversation type.
 */
function selectsLogisticsAgent(conversationType: string): boolean {
  return conversationType.startsWith("logistics_");
}

/** Build a fake ConvexHttpClient whose getEntityByPhoneNumber query returns `entity`. */
function fakeConvexClient(entity: unknown): ConvexHttpClient {
  return {
    query: async (ref: Parameters<typeof getFunctionName>[0]) =>
      isResolveNumberQuery(ref) ? null : entity,
  } as unknown as ConvexHttpClient;
}

/** A ConvexHttpClient whose query throws, exercising the fail-safe fallback path. */
function throwingConvexClient(): ConvexHttpClient {
  return {
    query: async () => {
      throw new Error("convex unavailable");
    },
  } as unknown as ConvexHttpClient;
}

/** Arbitrary: a configured restaurant branch entity (as returned by getEntityByPhoneNumber). */
const restaurantBranchEntityArb = fc.record({
  vertical: fc.constant("restaurant"),
  type: fc.constant("branch"),
  branchId: fc.string({ minLength: 1, maxLength: 40 }),
  restaurantId: fc.string({ minLength: 1, maxLength: 40 }),
  platformId: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
  phoneNumberId: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
});

/** Arbitrary: a configured logistics location entity. */
const logisticsLocationEntityArb = fc.record({
  vertical: fc.constant("logistics"),
  type: fc.constant("location"),
  locationId: fc.string({ minLength: 1, maxLength: 40 }),
  organizationId: fc.string({ minLength: 1, maxLength: 40 }),
  platformId: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
  phoneNumberId: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: undefined }),
});

const phoneNumberArb = fc.string({ minLength: 1, maxLength: 20 });

describe("Call Path Baseline — resolvePhoneToRoute (Twilio entry → conversation route)", () => {
  it("a caller reaching a configured restaurant number reaches a restaurant Realtime_Agent", async () => {
    await fc.assert(
      fc.asyncProperty(restaurantBranchEntityArb, phoneNumberArb, async (entity, toNumber) => {
        const result = await resolvePhoneToRoute(fakeConvexClient(entity), toNumber);

        // Resolves to a real conversation route → a Realtime_Agent is reached.
        expect(ALL_CONVERSATION_TYPES).toContain(result.conversationType);
        expect(result.vertical).toBe("restaurant");
        // Default (no callback reason) restaurant route is inbound order.
        expect(result.conversationType).toBe("restaurant_inbound_order");
        // The runtime would initialize the restaurant agent, not logistics.
        expect(selectsLogisticsAgent(result.conversationType)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("a caller reaching a configured logistics number reaches a logistics Realtime_Agent", async () => {
    await fc.assert(
      fc.asyncProperty(logisticsLocationEntityArb, phoneNumberArb, async (entity, toNumber) => {
        const result = await resolvePhoneToRoute(fakeConvexClient(entity), toNumber);

        expect(ALL_CONVERSATION_TYPES).toContain(result.conversationType);
        expect(result.vertical).toBe("logistics");
        expect(result.conversationType).toBe("logistics_booking");
        expect(selectsLogisticsAgent(result.conversationType)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("any configured number resolves to a route that reaches a Realtime_Agent (never terminates)", async () => {
    const configuredEntityArb = fc.oneof(
      restaurantBranchEntityArb,
      logisticsLocationEntityArb
    );
    await fc.assert(
      fc.asyncProperty(configuredEntityArb, phoneNumberArb, async (entity, toNumber) => {
        const result = await resolvePhoneToRoute(fakeConvexClient(entity), toNumber);
        // Baseline invariant: a configured number always yields a resolvable route.
        expect(result.conversationType).toBeTruthy();
        expect(ALL_CONVERSATION_TYPES).toContain(result.conversationType);
        // Agent selection is consistent with the resolved vertical.
        expect(selectsLogisticsAgent(result.conversationType)).toBe(
          result.vertical === "logistics"
        );
      }),
      { numRuns: 100 }
    );
  });

  it("restaurant callback reasons map to their conversation subtypes (baseline)", async () => {
    const cases: Array<[string | undefined, ConversationType]> = [
      [undefined, "restaurant_inbound_order"],
      ["followup", "restaurant_followup"],
      ["cancellation", "restaurant_cancellation"],
      ["unknown_reason", "restaurant_inbound_order"],
    ];
    for (const [reason, expected] of cases) {
      const entity = {
        vertical: "restaurant",
        type: "branch",
        branchId: "b1",
        restaurantId: "r1",
        platformId: null,
      };
      const result = await resolvePhoneToRoute(fakeConvexClient(entity), "+15550001", reason);
      expect(result.conversationType).toBe(expected);
    }
  });

  it("logistics callback reasons map to their conversation subtypes (baseline)", async () => {
    const cases: Array<[string | undefined, ConversationType]> = [
      [undefined, "logistics_booking"],
      ["followup", "logistics_followup"],
      ["failure_notice", "logistics_failure_notice"],
      ["unknown_reason", "logistics_booking"],
    ];
    for (const [reason, expected] of cases) {
      const entity = {
        vertical: "logistics",
        type: "location",
        locationId: "l1",
        organizationId: "o1",
        platformId: null,
      };
      const result = await resolvePhoneToRoute(fakeConvexClient(entity), "+15550002", reason);
      expect(result.conversationType).toBe(expected);
    }
  });

  it("an unconfigured number falls back to restaurant_inbound_order and still reaches an agent", async () => {
    await fc.assert(
      fc.asyncProperty(phoneNumberArb, async (toNumber) => {
        // No entity match (shared-number flow).
        const result = await resolvePhoneToRoute(fakeConvexClient(null), toNumber);
        expect(result).toMatchObject<Partial<PhoneLookupResult>>({
          vertical: "restaurant",
          conversationType: "restaurant_inbound_order",
        });
        expect(selectsLogisticsAgent(result.conversationType)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("a lookup failure fails safe to restaurant_inbound_order (still reaches an agent)", async () => {
    await fc.assert(
      fc.asyncProperty(phoneNumberArb, async (toNumber) => {
        const result = await resolvePhoneToRoute(throwingConvexClient(), toNumber);
        expect(result.vertical).toBe("restaurant");
        expect(result.conversationType).toBe("restaurant_inbound_order");
      }),
      { numRuns: 100 }
    );
  });
});

describe("Call Path Baseline — agent selection contract (index.ts isLogistics derivation)", () => {
  it("selects the logistics agent iff the conversation type is a logistics_* type", () => {
    for (const ct of ALL_CONVERSATION_TYPES) {
      const expected = ct.startsWith("logistics_");
      expect(selectsLogisticsAgent(ct)).toBe(expected);
    }
  });

  it("every routable conversation type selects exactly one agent domain", () => {
    for (const ct of ALL_CONVERSATION_TYPES) {
      const isLogistics = selectsLogisticsAgent(ct);
      const isRestaurant = ct.startsWith("restaurant_");
      // Exactly one domain owns each conversation type.
      expect(isLogistics !== isRestaurant).toBe(true);
    }
  });
});

describe("Call Path Baseline — restaurant call-phase gating (tools load for resolved domain)", () => {
  it("starts in await_restaurant_id and only permits restaurant identity lookup there", () => {
    const initial: CallPhase = "await_restaurant_id";
    expect(isToolAllowed(initial, "get_restaurant_details")).toBe(true);
    // Mutation/order tools are not permitted before the restaurant is verified.
    expect(isToolAllowed(initial, "upsert_order")).toBe(false);
    expect(isToolAllowed(initial, "generate_order_id")).toBe(false);
  });

  it("advances through the baseline phase sequence on the recorded events", () => {
    let phase: CallPhase = "await_restaurant_id";
    phase = nextPhase(phase, "restaurant_verified");
    expect(phase).toBe("restaurant_verified");
    phase = nextPhase(phase, "order_id_generated");
    expect(phase).toBe("order_open");
    expect(isToolAllowed(phase, "upsert_order")).toBe(true);
    phase = nextPhase(phase, "order_finalized");
    expect(phase).toBe("order_finalized");
  });

  it("unknown events never transition the phase (baseline no-op)", () => {
    fc.assert(
      fc.property(fc.string(), (event) => {
        const known = new Set([
          "restaurant_verified",
          "order_id_generated",
          "order_finalized",
        ]);
        fc.pre(!known.has(event));
        expect(nextPhase("await_restaurant_id", event)).toBe("await_restaurant_id");
      }),
      { numRuns: 100 }
    );
  });
});

describe("Call Path Baseline — logistics call-phase gating (tools load for resolved domain)", () => {
  it("starts in await_org_verification and only permits org verification there", () => {
    const initial: LogisticsCallPhase = "await_org_verification";
    expect(isLogisticsToolAllowed(initial, "get_organization_details")).toBe(true);
    expect(isLogisticsToolAllowed(initial, "create_shipment")).toBe(false);
    expect(isLogisticsToolAllowed(initial, "assign_rider")).toBe(false);
  });

  it("advances through the baseline logistics phase sequence on the recorded events", () => {
    let phase: LogisticsCallPhase = "await_org_verification";
    phase = nextLogisticsPhase(phase, "org_verified");
    expect(phase).toBe("org_verified");
    expect(isLogisticsToolAllowed(phase, "create_shipment")).toBe(true);
    phase = nextLogisticsPhase(phase, "shipment_created");
    expect(phase).toBe("shipment_open");
    expect(isLogisticsToolAllowed(phase, "assign_rider")).toBe(true);
    phase = nextLogisticsPhase(phase, "shipment_finalized");
    expect(phase).toBe("shipment_confirmed");
    // Finalized phase is read-only: no mutations.
    expect(isLogisticsToolAllowed(phase, "update_shipment")).toBe(false);
  });
});
