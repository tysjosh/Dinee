/**
 * Unit Tests — maskShipmentForPublic
 *
 * **Validates: Requirements 12.1, 12.2, 12.6, 12.7, 12.8, 12.9**
 *
 * Verifies that maskShipmentForPublic constructs a new object with only
 * allowed fields (field removal, not masking/redaction).
 */
import { describe, it, expect } from 'vitest';
import { maskShipmentForPublic, type PublicTrackingResponse } from './masking';

/** Minimal shipment-like object matching the ShipmentDoc shape */
function makeShipment(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'test_id' as never,
    _creationTime: Date.now(),
    shipmentId: 'SHP-001',
    trackingCode: 'LG12345678',
    organizationId: 'org-001',
    customerId: 'cust-001',
    sender: { name: 'Alice', phone: '08012345678', address: '123 Main St', city: 'Lagos', state: 'Lagos' },
    recipient: { name: 'Bob', phone: '09087654321', address: '456 Oak Ave', city: 'Abuja', state: 'FCT' },
    parcel: { type: 'document' as const, weightKg: 2 },
    serviceType: 'same_day' as const,
    paymentMethod: 'paystack' as const,
    paymentStatus: 'paid' as const,
    deliveryStatus: 'in_transit' as const,
    assignedRiderId: 'rider-001',
    etaMinutes: 30,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as never;
}

describe('maskShipmentForPublic', () => {
  it('returns only allowed fields from a full shipment', () => {
    const shipment = makeShipment();
    const result: PublicTrackingResponse = maskShipmentForPublic(shipment);

    expect(result).toEqual({
      trackingCode: 'LG12345678',
      deliveryStatus: 'in_transit',
      serviceType: 'same_day',
      etaMinutes: 30,
    });
  });

  it('excludes all PII and internal fields', () => {
    const shipment = makeShipment();
    const result = maskShipmentForPublic(shipment);
    const keys = Object.keys(result);

    const forbiddenKeys = [
      'sender', 'recipient', 'organizationId', 'assignedRiderId',
      'paymentMethod', 'paymentStatus', 'customerId', 'shipmentId',
      'parcel', 'proofOfDelivery', 'failureReason', 'locationId',
      '_id', '_creationTime', 'createdAt', 'updatedAt',
    ];

    for (const key of forbiddenKeys) {
      expect(keys).not.toContain(key);
    }
  });

  it('omits etaMinutes when not present on shipment', () => {
    const shipment = makeShipment({ etaMinutes: undefined });
    const result = maskShipmentForPublic(shipment);

    expect(result).not.toHaveProperty('etaMinutes');
  });

  it('includes lastEventTimestamp when provided', () => {
    const shipment = makeShipment();
    const ts = 1700000000;
    const result = maskShipmentForPublic(shipment, ts);

    expect(result.lastEventTimestamp).toBe(ts);
  });

  it('omits lastEventTimestamp when not provided', () => {
    const shipment = makeShipment();
    const result = maskShipmentForPublic(shipment);

    expect(result).not.toHaveProperty('lastEventTimestamp');
  });

  it('omits lastEventTimestamp when explicitly undefined', () => {
    const shipment = makeShipment();
    const result = maskShipmentForPublic(shipment, undefined);

    expect(result).not.toHaveProperty('lastEventTimestamp');
  });
});
