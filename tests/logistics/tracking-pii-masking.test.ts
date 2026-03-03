/**
 * Property-Based Test — Public Tracking PII Field Removal
 *
 * **Validates: Requirements 12.7, 12.8**
 *
 * Verifies that maskShipmentForPublic produces objects with only allowed
 * fields and no PII or internal fields leak through.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  maskShipmentForPublic,
  type PublicTrackingResponse,
} from "../../src/lib/logistics/masking";

// ─── Arbitraries ────────────────────────────────────────────────────────────

const addressArb = fc.record({
  name: fc.string({ minLength: 1 }),
  phone: fc.string({ minLength: 4, maxLength: 15 }),
  address: fc.string({ minLength: 1 }),
  city: fc.string({ minLength: 1 }),
  state: fc.string({ minLength: 1 }),
  lat: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), { nil: undefined }),
  lng: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), { nil: undefined }),
});

const shipmentArb = fc.record({
  _id: fc.constant("test_id" as never),
  _creationTime: fc.integer({ min: 1000000000, max: 2000000000 }),
  shipmentId: fc.uuid(),
  trackingCode: fc
    .array(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")), {
      minLength: 10,
      maxLength: 10,
    })
    .map((chars) => "LG" + chars.join("")),
  organizationId: fc.uuid(),
  locationId: fc.option(fc.uuid(), { nil: undefined }),
  customerId: fc.option(fc.uuid(), { nil: undefined }),
  sender: addressArb,
  recipient: addressArb,
  parcel: fc.record({
    type: fc.constantFrom("document" as const, "parcel" as const, "fragile" as const),
    weightKg: fc.double({ min: 0.1, max: 100, noNaN: true }),
  }),
  serviceType: fc.constantFrom("same_day" as const, "next_day" as const, "express" as const, "scheduled" as const),
  paymentMethod: fc.option(
    fc.constantFrom("paystack" as const, "flutterwave" as const, "cod" as const, "wallet" as const),
    { nil: undefined }
  ),
  paymentStatus: fc.option(
    fc.constantFrom("pending" as const, "paid" as const, "failed" as const, "refunded" as const),
    { nil: undefined }
  ),
  deliveryStatus: fc.constantFrom(
    "created" as const, "assigned" as const, "picked_up" as const, "in_transit" as const,
    "delivered" as const, "failed" as const, "cancelled" as const
  ),
  failureReason: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
  etaMinutes: fc.option(fc.integer({ min: 1, max: 1440 }), { nil: undefined }),
  assignedRiderId: fc.option(fc.uuid(), { nil: undefined }),
  proofOfDelivery: fc.option(
    fc.record({
      photoUrl: fc.option(fc.webUrl(), { nil: undefined }),
      signatureUrl: fc.option(fc.webUrl(), { nil: undefined }),
      recipientName: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
      deliveredAt: fc.integer({ min: 1000000000, max: 2000000000 }),
    }),
    { nil: undefined }
  ),
  createdAt: fc.integer({ min: 1000000000, max: 2000000000 }),
  updatedAt: fc.integer({ min: 1000000000, max: 2000000000 }),
});

const FORBIDDEN_KEYS = [
  "sender", "recipient", "organizationId", "assignedRiderId",
  "paymentMethod", "paymentStatus", "customerId", "shipmentId",
  "parcel", "proofOfDelivery", "failureReason", "locationId",
  "_id", "_creationTime", "createdAt", "updatedAt",
] as const;

const REQUIRED_KEYS = ["trackingCode", "deliveryStatus", "serviceType"] as const;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("maskShipmentForPublic — PII Field Removal (Property 6)", () => {
  /**
   * **Validates: Requirements 12.7**
   *
   * For all generated shipment objects: after applying maskShipmentForPublic,
   * no forbidden keys appear in the result.
   */
  it("result never contains forbidden PII or internal fields", () => {
    fc.assert(
      fc.property(shipmentArb, (shipment) => {
        const result = maskShipmentForPublic(shipment as never);
        const keys = Object.keys(result);

        for (const field of FORBIDDEN_KEYS) {
          expect(keys).not.toContain(field);
        }
      }),
      { numRuns: 300 }
    );
  });

  /**
   * **Validates: Requirements 12.8**
   *
   * For all generated shipment objects: the result always contains the
   * required retained fields with correct values.
   */
  it("result always contains required retained fields with correct values", () => {
    fc.assert(
      fc.property(shipmentArb, (shipment) => {
        const result = maskShipmentForPublic(shipment as never);

        for (const key of REQUIRED_KEYS) {
          expect(result).toHaveProperty(key);
        }

        expect(result.trackingCode).toBe(shipment.trackingCode);
        expect(result.deliveryStatus).toBe(shipment.deliveryStatus);
        expect(result.serviceType).toBe(shipment.serviceType);
      }),
      { numRuns: 300 }
    );
  });

  /**
   * **Validates: Requirements 12.8**
   *
   * etaMinutes is included when present on the shipment, omitted when absent.
   */
  it("etaMinutes is conditionally included based on shipment data", () => {
    fc.assert(
      fc.property(shipmentArb, (shipment) => {
        const result = maskShipmentForPublic(shipment as never);

        if (shipment.etaMinutes != null) {
          expect(result.etaMinutes).toBe(shipment.etaMinutes);
        } else {
          expect(result).not.toHaveProperty("etaMinutes");
        }
      }),
      { numRuns: 300 }
    );
  });

  /**
   * **Validates: Requirements 12.8**
   *
   * lastEventTimestamp is included when provided, omitted when not.
   */
  it("lastEventTimestamp is conditionally included based on parameter", () => {
    fc.assert(
      fc.property(
        shipmentArb,
        fc.option(fc.integer({ min: 1000000000, max: 2000000000 }), { nil: undefined }),
        (shipment, ts) => {
          const result = maskShipmentForPublic(shipment as never, ts);

          if (ts != null) {
            expect(result.lastEventTimestamp).toBe(ts);
          } else {
            expect(result).not.toHaveProperty("lastEventTimestamp");
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});
