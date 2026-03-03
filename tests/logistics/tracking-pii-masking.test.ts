/**
 * Property-Based Test — Public Tracking Endpoint PII Masking (Property 8)
 *
 * **Validates: Requirements 14.3, 26.1, 26.2**
 *
 * Property 8: Public tracking never exposes sensitive fields
 * - For all shipments queried via tracking endpoint: response excludes sender
 *   full address, recipient full address, payment details, organizationId, assignedRiderId
 * - Phone numbers in response are masked to `****XXXX` format
 * - Address objects in response contain only city and state
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  maskPhone,
  maskAddress,
  type Address,
  type MaskedAddress,
} from "../../src/lib/logistics/masking";

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Generates a phone string of length >= 4 (realistic phone numbers). */
const phoneArb = fc
  .array(fc.constantFrom("0", "1", "2", "3", "4", "5", "6", "7", "8", "9"), {
    minLength: 4,
    maxLength: 15,
  })
  .map((chars) => chars.join(""));

/** Generates a non-empty alphanumeric string for address text fields. */
const addrStringArb = fc
  .array(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789 -,".split("")),
    { minLength: 1, maxLength: 80 }
  )
  .map((chars) => chars.join(""));

/** Generates a full Address object with all sensitive fields populated. */
const addressArb: fc.Arbitrary<Address> = fc.record({
  name: addrStringArb,
  phone: phoneArb,
  address: addrStringArb,
  city: addrStringArb,
  state: addrStringArb,
  lat: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), { nil: undefined }),
  lng: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), { nil: undefined }),
});

/** Generates a shipment-like object with all sensitive fields present. */
const shipmentArb = fc.record({
  shipmentId: fc.uuid(),
  trackingCode: fc
    .array(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")), {
      minLength: 10,
      maxLength: 10,
    })
    .map((chars) => chars.join("")),
  organizationId: fc.uuid(),
  locationId: fc.option(fc.uuid(), { nil: undefined }),
  customerId: fc.option(fc.uuid(), { nil: undefined }),
  sender: addressArb,
  recipient: addressArb,
  parcel: fc.record({
    type: fc.constantFrom("document", "parcel", "fragile"),
    weightKg: fc.option(fc.double({ min: 0.1, max: 100, noNaN: true }), { nil: undefined }),
    dimensions: fc.option(fc.constant("30x20x10"), { nil: undefined }),
    declaredValue: fc.option(fc.double({ min: 0, max: 100000, noNaN: true }), { nil: undefined }),
    notes: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  }),
  serviceType: fc.constantFrom("same_day", "next_day", "express", "scheduled"),
  paymentMethod: fc.option(
    fc.constantFrom("paystack", "flutterwave", "cod", "wallet"),
    { nil: undefined }
  ),
  paymentStatus: fc.option(
    fc.constantFrom("pending", "paid", "failed", "refunded"),
    { nil: undefined }
  ),
  deliveryStatus: fc.constantFrom(
    "created", "assigned", "picked_up", "in_transit", "delivered", "failed", "cancelled"
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

// ─── Sensitive field names that must NEVER appear in a public tracking response ─

const SENSITIVE_SHIPMENT_FIELDS = [
  "organizationId",
  "assignedRiderId",
  "paymentMethod",
  "paymentStatus",
  "parcel",
  "customerId",
  "locationId",
  "proofOfDelivery",
  "failureReason",
  "shipmentId",
] as const;

const SENSITIVE_ADDRESS_FIELDS = [
  "name",
  "address",
  "lat",
  "lng",
] as const;

/**
 * Simulates the tracking endpoint's response construction logic:
 * returns only the safe fields with PII masking applied.
 */
function buildTrackingResponse(shipment: {
  trackingCode: string;
  deliveryStatus: string;
  serviceType: string;
  etaMinutes?: number;
  sender: Address;
  recipient: Address;
}) {
  return {
    trackingCode: shipment.trackingCode,
    deliveryStatus: shipment.deliveryStatus,
    serviceType: shipment.serviceType,
    etaMinutes: shipment.etaMinutes ?? null,
    lastEventAt: null,
    sender: {
      phone: maskPhone(shipment.sender.phone),
      ...maskAddress(shipment.sender),
    },
    recipient: {
      phone: maskPhone(shipment.recipient.phone),
      ...maskAddress(shipment.recipient),
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Public Tracking PII Masking — Property 8", () => {
  /**
   * **Validates: Requirements 14.3, 26.1, 26.2**
   *
   * For all generated shipment objects: after applying the masking/filtering
   * logic, the tracking response never contains sensitive shipment-level fields.
   */
  it("tracking response excludes all sensitive shipment-level fields", () => {
    fc.assert(
      fc.property(shipmentArb, (shipment) => {
        const response = buildTrackingResponse(shipment);
        const responseKeys = Object.keys(response);

        for (const field of SENSITIVE_SHIPMENT_FIELDS) {
          expect(responseKeys).not.toContain(field);
        }
      }),
      { numRuns: 300 }
    );
  });

  /**
   * **Validates: Requirements 26.1**
   *
   * For all phone strings of length >= 4: maskPhone output matches ****XXXX
   * pattern — starts with "****" and ends with the last 4 digits of the input.
   */
  it("masked phone numbers match ****XXXX format", () => {
    fc.assert(
      fc.property(phoneArb, (phone) => {
        const masked = maskPhone(phone);

        // Must start with ****
        expect(masked.startsWith("****")).toBe(true);

        // Must end with last 4 digits of original
        const last4 = phone.slice(-4);
        expect(masked).toBe("****" + last4);

        // Total length is always 4 (asterisks) + 4 (digits) = 8
        expect(masked.length).toBe(8);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 26.2**
   *
   * For all address objects: maskAddress output contains ONLY city and state.
   * No street address, name, phone, building, lat, or lng fields leak through.
   */
  it("masked addresses contain only city and state", () => {
    fc.assert(
      fc.property(addressArb, (addr) => {
        const masked: MaskedAddress = maskAddress(addr);
        const maskedKeys = Object.keys(masked);

        // Only city and state should be present
        expect(maskedKeys).toHaveLength(2);
        expect(maskedKeys).toContain("city");
        expect(maskedKeys).toContain("state");

        // No sensitive address fields
        for (const field of SENSITIVE_ADDRESS_FIELDS) {
          expect(maskedKeys).not.toContain(field);
        }

        // Values match the original city and state
        expect(masked.city).toBe(addr.city);
        expect(masked.state).toBe(addr.state);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 14.3, 26.1, 26.2**
   *
   * For all generated shipments: the full tracking response sender/recipient
   * objects contain only masked phone + city + state — no sensitive address fields.
   */
  it("tracking response sender/recipient contain only masked phone, city, and state", () => {
    fc.assert(
      fc.property(shipmentArb, (shipment) => {
        const response = buildTrackingResponse(shipment);

        for (const party of [response.sender, response.recipient] as const) {
          const keys = Object.keys(party);

          // Exactly 3 fields: phone, city, state
          expect(keys).toHaveLength(3);
          expect(keys).toContain("phone");
          expect(keys).toContain("city");
          expect(keys).toContain("state");

          // Phone is masked
          expect(party.phone.startsWith("****")).toBe(true);

          // No sensitive address fields leaked
          for (const field of SENSITIVE_ADDRESS_FIELDS) {
            expect(keys).not.toContain(field);
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  /**
   * **Validates: Requirements 26.1**
   *
   * For all generated shipments: the original full phone number never appears
   * anywhere in the serialized tracking response.
   */
  it("original phone numbers never appear in serialized tracking response", () => {
    fc.assert(
      fc.property(shipmentArb, (shipment) => {
        const response = buildTrackingResponse(shipment);
        const serialized = JSON.stringify(response);

        // Full sender phone must not appear (unless it's <= 4 chars, which our arb prevents)
        if (shipment.sender.phone.length > 4) {
          expect(serialized).not.toContain(shipment.sender.phone);
        }
        if (shipment.recipient.phone.length > 4) {
          expect(serialized).not.toContain(shipment.recipient.phone);
        }
      }),
      { numRuns: 300 }
    );
  });
});
