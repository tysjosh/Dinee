/**
 * PII masking utilities for logistics public-facing responses.
 * Uses field REMOVAL (constructing a new object with only allowed fields)
 * rather than field masking/redaction, eliminating any risk of partial exposure.
 * Requirements: 12.1, 12.2, 12.6, 12.7, 12.8, 12.9
 */

import { Doc } from "convex/_generated/dataModel";

export type ShipmentDoc = Doc<"shipments">;

export interface PublicTrackingResponse {
  trackingCode: string;
  deliveryStatus: string;
  serviceType: string;
  etaMinutes?: number;
  lastEventTimestamp?: number;
}

/**
 * Strips all PII and internal fields from a shipment document.
 * REMOVES (not masks): sender.phone, sender.address, recipient.phone,
 * recipient.address, organizationId, assignedRiderId, paymentMethod,
 * paymentStatus, customerId.
 * RETAINS: trackingCode, deliveryStatus, serviceType, etaMinutes,
 * lastEventTimestamp.
 */
export function maskShipmentForPublic(
  shipment: ShipmentDoc,
  lastEventTimestamp?: number
): PublicTrackingResponse {
  return {
    trackingCode: shipment.trackingCode,
    deliveryStatus: shipment.deliveryStatus,
    serviceType: shipment.serviceType,
    ...(shipment.etaMinutes != null && { etaMinutes: shipment.etaMinutes }),
    ...(lastEventTimestamp != null && { lastEventTimestamp }),
  };
}
