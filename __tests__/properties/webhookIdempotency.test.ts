/**
 * Feature: ai-reception-os-pivot, Property 6: Webhook Idempotency
 *
 * Validates: Requirements 8.7, 8.3, 8.4, 8.5
 *
 * For any valid Runsheet webhook event with a given eventId, processing the
 * event N times (N >= 1) SHALL produce the same database state as processing
 * it exactly once. Specifically: the Shipment record's deliveryStatus and
 * assignedRiderId SHALL have the same values, and exactly one ShipmentEvent
 * audit entry SHALL exist for that eventId.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ============================================================================
// Pure-function abstraction of the webhook idempotency logic
// ============================================================================

/** Represents a shipment record in the DB */
interface ShipmentRecord {
  shipmentId: string;
  deliveryStatus: string;
  assignedRiderId: string | null;
}

/** Represents a ShipmentEvent audit log entry */
interface ShipmentEventEntry {
  eventId: string;
  eventType: "shipment_status" | "rider_assignment";
  shipmentId: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

/** Represents a deduplication entry */
interface DeduplicationEntry {
  eventId: string;
  provider: string;
  processedAt: number;
}

/** In-memory store simulating the DB tables */
interface WebhookStore {
  shipments: Map<string, ShipmentRecord>;
  shipmentEvents: ShipmentEventEntry[];
  deduplication: Map<string, DeduplicationEntry>;
}

/** A webhook event to process */
interface WebhookEvent {
  eventId: string;
  eventType: "shipment_status" | "rider_assignment";
  timestamp: string;
  payload: {
    shipmentId: string;
    deliveryStatus?: string;
    riderId?: string;
  };
}

function createStore(initialShipments: ShipmentRecord[]): WebhookStore {
  const shipments = new Map<string, ShipmentRecord>();
  for (const s of initialShipments) {
    shipments.set(s.shipmentId, { ...s });
  }
  return {
    shipments,
    shipmentEvents: [],
    deduplication: new Map(),
  };
}

/**
 * Pure-function webhook event processor with idempotency via deduplication.
 *
 * Mirrors the logic in the actual webhook route handler:
 * 1. Check deduplication store — if already processed, return early
 * 2. Process the event (update shipment, create audit entry)
 * 3. Record deduplication entry
 */
function processWebhookEvent(
  store: WebhookStore,
  event: WebhookEvent
): { status: "processed" | "already_processed" | "unmatched" } {
  // Step 1: Deduplication check (Req 8.7)
  const dedupKey = `${event.eventId}:runsheet`;
  if (store.deduplication.has(dedupKey)) {
    return { status: "already_processed" };
  }

  const shipment = store.shipments.get(event.payload.shipmentId);

  // Step 2: Handle unmatched shipment
  if (!shipment) {
    // Still record deduplication to prevent reprocessing
    store.deduplication.set(dedupKey, {
      eventId: event.eventId,
      provider: "runsheet",
      processedAt: Date.now(),
    });
    return { status: "unmatched" };
  }

  // Step 3: Process based on event type
  if (event.eventType === "shipment_status" && event.payload.deliveryStatus) {
    // Req 8.3: Update shipment deliveryStatus
    shipment.deliveryStatus = event.payload.deliveryStatus;
  } else if (event.eventType === "rider_assignment" && event.payload.riderId) {
    // Req 8.4: Update shipment assignedRiderId
    shipment.assignedRiderId = event.payload.riderId;
  }

  // Step 4: Create ShipmentEvent audit entry (Req 8.5)
  store.shipmentEvents.push({
    eventId: event.eventId,
    eventType: event.eventType,
    shipmentId: event.payload.shipmentId,
    payload: { ...event.payload },
    createdAt: Date.now(),
  });

  // Step 5: Record deduplication entry (Req 8.7)
  store.deduplication.set(dedupKey, {
    eventId: event.eventId,
    provider: "runsheet",
    processedAt: Date.now(),
  });

  return { status: "processed" };
}

/** Snapshot the store state for comparison */
function snapshotStore(store: WebhookStore) {
  const shipments: Record<string, ShipmentRecord> = {};
  for (const [id, s] of store.shipments) {
    shipments[id] = { ...s };
  }
  return {
    shipments,
    shipmentEventCount: store.shipmentEvents.length,
    shipmentEventIds: store.shipmentEvents.map((e) => e.eventId),
    deduplicationCount: store.deduplication.size,
    deduplicationKeys: [...store.deduplication.keys()],
  };
}

// ============================================================================
// Arbitraries
// ============================================================================

const DELIVERY_STATUSES = [
  "pending",
  "assigned",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
];

const eventTypeArb = fc.constantFrom(
  "shipment_status" as const,
  "rider_assignment" as const
);

const shipmentIdArb = fc.stringMatching(/^ship_[a-z0-9]{4,8}$/);
const eventIdArb = fc.stringMatching(/^evt_[a-z0-9]{6,12}$/);
const riderIdArb = fc.stringMatching(/^rider_[a-z0-9]{4,8}$/);
const deliveryStatusArb = fc.constantFrom(...DELIVERY_STATUSES);

/** Generate a valid webhook event that targets an existing shipment */
const webhookEventArb = fc
  .tuple(eventIdArb, eventTypeArb, shipmentIdArb, deliveryStatusArb, riderIdArb)
  .map(([eventId, eventType, shipmentId, deliveryStatus, riderId]) => {
    const event: WebhookEvent = {
      eventId,
      eventType,
      timestamp: new Date().toISOString(),
      payload: {
        shipmentId,
        ...(eventType === "shipment_status"
          ? { deliveryStatus }
          : { riderId }),
      },
    };
    return { event, shipmentId };
  });

/** Number of times to re-process (1 to 5) */
const repeatCountArb = fc.integer({ min: 1, max: 5 });

// ============================================================================
// Property Tests
// ============================================================================

describe("Property 6: Webhook Idempotency", () => {
  it("processing an event N times produces the same state as processing once", () => {
    fc.assert(
      fc.property(
        webhookEventArb,
        repeatCountArb,
        ({ event, shipmentId }, repeatCount) => {
          // Setup: create a store with the target shipment
          const initialShipment: ShipmentRecord = {
            shipmentId,
            deliveryStatus: "pending",
            assignedRiderId: null,
          };

          // Process once and snapshot
          const storeOnce = createStore([initialShipment]);
          const firstResult = processWebhookEvent(storeOnce, event);
          expect(firstResult.status).toBe("processed");
          const snapshotAfterOnce = snapshotStore(storeOnce);

          // Process N times in a fresh store
          const storeN = createStore([initialShipment]);
          for (let i = 0; i < repeatCount; i++) {
            processWebhookEvent(storeN, event);
          }
          const snapshotAfterN = snapshotStore(storeN);

          // Assert: shipment state is identical
          expect(snapshotAfterN.shipments).toEqual(snapshotAfterOnce.shipments);

          // Assert: exactly one ShipmentEvent per eventId
          expect(snapshotAfterN.shipmentEventCount).toBe(1);
          expect(snapshotAfterN.shipmentEventIds).toEqual([event.eventId]);

          // Assert: exactly one deduplication entry per eventId
          expect(snapshotAfterN.deduplicationCount).toBe(1);
          expect(snapshotAfterN.deduplicationKeys).toEqual([
            `${event.eventId}:runsheet`,
          ]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("duplicate processing returns 'already_processed' on subsequent calls", () => {
    fc.assert(
      fc.property(webhookEventArb, ({ event, shipmentId }) => {
        const store = createStore([
          { shipmentId, deliveryStatus: "pending", assignedRiderId: null },
        ]);

        const first = processWebhookEvent(store, event);
        expect(first.status).toBe("processed");

        const second = processWebhookEvent(store, event);
        expect(second.status).toBe("already_processed");

        const third = processWebhookEvent(store, event);
        expect(third.status).toBe("already_processed");
      }),
      { numRuns: 100 }
    );
  });

  it("distinct eventIds each produce their own ShipmentEvent and dedup entry", () => {
    fc.assert(
      fc.property(
        fc.array(webhookEventArb, { minLength: 1, maxLength: 5 }),
        (eventSpecs) => {
          // Use a single shipment for all events
          const shipmentId = eventSpecs[0].shipmentId;
          const store = createStore([
            { shipmentId, deliveryStatus: "pending", assignedRiderId: null },
          ]);

          // Ensure unique eventIds by deduplicating the generated set
          const uniqueEvents = new Map<string, WebhookEvent>();
          for (const { event } of eventSpecs) {
            // Retarget all events to the same shipment
            const retargeted: WebhookEvent = {
              ...event,
              payload: { ...event.payload, shipmentId },
            };
            uniqueEvents.set(retargeted.eventId, retargeted);
          }

          const events = [...uniqueEvents.values()];

          // Process each event twice
          for (const event of events) {
            processWebhookEvent(store, event);
            processWebhookEvent(store, event); // duplicate
          }

          const snapshot = snapshotStore(store);

          // Exactly one ShipmentEvent per unique eventId
          expect(snapshot.shipmentEventCount).toBe(events.length);

          // Exactly one dedup entry per unique eventId
          expect(snapshot.deduplicationCount).toBe(events.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
