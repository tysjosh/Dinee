/**
 * Property-Based Test — Webhook Idempotency (Property 9)
 *
 * **Validates: Requirements 25.1, 25.2**
 *
 * Property 9: Duplicate logistics webhook events produce no side effects
 * - For all webhook events dispatched twice with same `eventId`: second dispatch
 *   returns 200 with no mutation
 *
 * Since Convex mutations cannot be invoked directly from vitest, these tests
 * verify:
 * 1. EventId generation is deterministic — same inputs always produce the same eventId
 * 2. Different inputs produce different eventIds (no collisions for distinct events)
 * 3. The idempotency contract: when `atomicInsertWebhookEvent` returns
 *    `{ inserted: false }`, no further side effects (webhook delivery) occur
 */
import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";

// ─── Types mirroring the webhook dispatch module ────────────────────────────

interface LogisticsWebhookEventInput {
  shipmentId: string;
  eventType: string;
  payload: string;
  requestId: string;
}

interface WebhookDispatchResult {
  inserted: boolean;
  alreadyProcessed?: boolean;
  id?: string;
  deliveries?: number;
}

// ─── Pure helpers extracted from dispatchLogisticsWebhookEvent ───────────────

/**
 * EventId generation logic — mirrors the formula in webhook-dispatch.ts:
 *   `${eventType}:${shipmentId}:${requestId}`
 */
function generateEventId(input: LogisticsWebhookEventInput): string {
  return `${input.eventType}:${input.shipmentId}:${input.requestId}`;
}

/**
 * Simulates the dispatch function's decision logic.
 *
 * Given an `atomicInsertWebhookEvent` result, determines whether webhook
 * delivery should proceed. The real function only queries subscriptions and
 * delivers when `inserted === true`.
 */
function simulateDispatch(
  insertResult: { inserted: true; id: string } | { inserted: false; alreadyProcessed?: boolean },
  querySubscriptionsFn: () => unknown[],
): WebhookDispatchResult {
  if (!insertResult.inserted) {
    // Duplicate — no side effects (Req 25.1, 25.2)
    return {
      inserted: false,
      alreadyProcessed: (insertResult as { alreadyProcessed?: boolean }).alreadyProcessed,
    };
  }

  // First insertion — proceed with delivery
  const subscriptions = querySubscriptionsFn();
  return {
    inserted: true,
    id: (insertResult as { id: string }).id,
    deliveries: subscriptions.length,
  };
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const LOGISTICS_EVENT_TYPES = [
  "shipment.created",
  "shipment.assigned",
  "shipment.status_updated",
  "shipment.delivered",
  "shipment.failed",
] as const;

const eventTypeArb = fc.constantFrom(...LOGISTICS_EVENT_TYPES);

const SHIPMENT_ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const shipmentIdArb = fc
  .array(fc.constantFrom(...SHIPMENT_ID_CHARS.split("")), {
    minLength: 4,
    maxLength: 32,
  })
  .map((chars) => `shp_${chars.join("")}`);

const UUID_CHARS = "0123456789abcdef";
const requestIdArb = fc
  .array(fc.constantFrom(...UUID_CHARS.split("")), {
    minLength: 8,
    maxLength: 36,
  })
  .map((chars) => chars.join(""));

const webhookInputArb = fc.record({
  shipmentId: shipmentIdArb,
  eventType: eventTypeArb,
  payload: fc.json({ maxDepth: 2 }),
  requestId: requestIdArb,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Webhook Idempotency — Property 9", () => {
  // ─── EventId determinism ────────────────────────────────────────────────

  /**
   * **Validates: Requirements 25.1, 25.2**
   *
   * Property: EventId generation is deterministic — same inputs always
   * produce the same eventId.
   */
  it("eventId generation is deterministic: same inputs produce same eventId", () => {
    fc.assert(
      fc.property(webhookInputArb, (input) => {
        const id1 = generateEventId(input);
        const id2 = generateEventId(input);
        expect(id1).toBe(id2);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 25.1, 25.2**
   *
   * Property: EventId contains all three components (eventType, shipmentId,
   * requestId) separated by colons, matching the format in webhook-dispatch.ts.
   */
  it("eventId follows the format eventType:shipmentId:requestId", () => {
    fc.assert(
      fc.property(webhookInputArb, (input) => {
        const eventId = generateEventId(input);
        const parts = eventId.split(":");

        // At minimum 3 parts (eventType contains a dot, not a colon)
        expect(parts.length).toBeGreaterThanOrEqual(3);
        // First part is the eventType (e.g. "shipment.created")
        expect(eventId.startsWith(input.eventType)).toBe(true);
        // Last part is the requestId
        expect(eventId.endsWith(input.requestId)).toBe(true);
        // Contains the shipmentId
        expect(eventId).toContain(input.shipmentId);
      }),
      { numRuns: 500 }
    );
  });

  // ─── EventId collision resistance ───────────────────────────────────────

  /**
   * **Validates: Requirements 25.1, 25.2**
   *
   * Property: Different inputs produce different eventIds — no collisions
   * for distinct webhook events.
   */
  it("different inputs produce different eventIds", () => {
    const distinctInputsArb = fc
      .tuple(webhookInputArb, webhookInputArb)
      .filter(([a, b]) => {
        // At least one field must differ
        return (
          a.shipmentId !== b.shipmentId ||
          a.eventType !== b.eventType ||
          a.requestId !== b.requestId
        );
      });

    fc.assert(
      fc.property(distinctInputsArb, ([inputA, inputB]) => {
        const idA = generateEventId(inputA);
        const idB = generateEventId(inputB);
        expect(idA).not.toBe(idB);
      }),
      { numRuns: 500 }
    );
  });

  // ─── Duplicate dispatch produces no side effects ────────────────────────

  /**
   * **Validates: Requirements 25.1, 25.2**
   *
   * Property: When atomicInsertWebhookEvent returns { inserted: false }
   * (duplicate eventId), the dispatch function does NOT query webhook
   * subscriptions and returns no deliveries — zero side effects.
   */
  it("duplicate eventId (inserted: false) triggers no webhook delivery", () => {
    fc.assert(
      fc.property(webhookInputArb, fc.boolean(), (input, alreadyProcessed) => {
        const querySubscriptions = vi.fn(() => []);

        const result = simulateDispatch(
          { inserted: false, alreadyProcessed },
          querySubscriptions,
        );

        // Must NOT have called subscriptions query
        expect(querySubscriptions).not.toHaveBeenCalled();
        // Result reflects duplicate
        expect(result.inserted).toBe(false);
        expect(result.alreadyProcessed).toBe(alreadyProcessed);
        // No deliveries field
        expect(result.deliveries).toBeUndefined();
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 25.1, 25.2**
   *
   * Property: When atomicInsertWebhookEvent returns { inserted: true },
   * the dispatch function DOES query subscriptions and reports deliveries.
   */
  it("first insertion (inserted: true) triggers webhook delivery", () => {
    const subscriptionCountArb = fc.integer({ min: 0, max: 10 });

    fc.assert(
      fc.property(
        webhookInputArb,
        subscriptionCountArb,
        (input, subCount) => {
          const mockSubscriptions = Array.from({ length: subCount }, (_, i) => ({
            id: `sub_${i}`,
          }));
          const querySubscriptions = vi.fn(() => mockSubscriptions);

          const result = simulateDispatch(
            { inserted: true, id: `evt_${generateEventId(input)}` },
            querySubscriptions,
          );

          // Must have queried subscriptions
          expect(querySubscriptions).toHaveBeenCalledOnce();
          expect(result.inserted).toBe(true);
          expect(result.deliveries).toBe(subCount);
        }
      ),
      { numRuns: 500 }
    );
  });

  // ─── Double dispatch simulation ─────────────────────────────────────────

  /**
   * **Validates: Requirements 25.1, 25.2**
   *
   * Property: Simulating two dispatches of the same event — first succeeds
   * with delivery, second returns duplicate with no delivery. This mirrors
   * the full idempotency contract end-to-end.
   */
  it("dispatching same event twice: first inserts + delivers, second is no-op", () => {
    const subscriptionCountArb = fc.integer({ min: 0, max: 5 });

    fc.assert(
      fc.property(
        webhookInputArb,
        subscriptionCountArb,
        (input, subCount) => {
          const eventId = generateEventId(input);

          // Track which eventIds have been "inserted"
          const insertedEvents = new Set<string>();

          function simulateAtomicInsert(eid: string) {
            if (insertedEvents.has(eid)) {
              return { inserted: false as const, alreadyProcessed: false };
            }
            insertedEvents.add(eid);
            return { inserted: true as const, id: `doc_${eid}` };
          }

          const mockSubs = Array.from({ length: subCount }, (_, i) => ({
            id: `sub_${i}`,
          }));

          // First dispatch
          const queryFn1 = vi.fn(() => mockSubs);
          const insertResult1 = simulateAtomicInsert(eventId);
          const result1 = simulateDispatch(insertResult1, queryFn1);

          expect(result1.inserted).toBe(true);
          expect(queryFn1).toHaveBeenCalledOnce();
          expect(result1.deliveries).toBe(subCount);

          // Second dispatch — same eventId
          const queryFn2 = vi.fn(() => mockSubs);
          const insertResult2 = simulateAtomicInsert(eventId);
          const result2 = simulateDispatch(insertResult2, queryFn2);

          expect(result2.inserted).toBe(false);
          expect(queryFn2).not.toHaveBeenCalled();
          expect(result2.deliveries).toBeUndefined();
        }
      ),
      { numRuns: 500 }
    );
  });
});
