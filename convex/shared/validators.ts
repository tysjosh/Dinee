import { v } from "convex/values";

// Vertical discriminator
export const verticalValidator = v.union(v.literal("restaurant"), v.literal("logistics"));

// Delivery status enum
export const deliveryStatusValidator = v.union(
  v.literal("created"),
  v.literal("assigned"),
  v.literal("picked_up"),
  v.literal("in_transit"),
  v.literal("delivered"),
  v.literal("failed"),
  v.literal("cancelled")
);

// Service type enum
export const serviceTypeValidator = v.union(
  v.literal("same_day"),
  v.literal("next_day"),
  v.literal("express"),
  v.literal("scheduled")
);

// Rider status enum
export const riderStatusValidator = v.union(
  v.literal("offline"),
  v.literal("available"),
  v.literal("busy")
);

// Payment method (logistics-specific, adds "wallet")
export const logisticsPaymentMethodValidator = v.union(
  v.literal("paystack"),
  v.literal("flutterwave"),
  v.literal("cod"),
  v.literal("wallet")
);

// Payment status
export const paymentStatusValidator = v.union(
  v.literal("pending"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("refunded")
);

// Actor type for shipment events
export const actorTypeValidator = v.union(
  v.literal("system"),
  v.literal("agent"),
  v.literal("rider"),
  v.literal("merchant")
);

// Address object (sender/recipient)
export const addressValidator = v.object({
  name: v.string(),
  phone: v.string(),
  address: v.string(),
  city: v.string(),
  state: v.string(),
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
});

// Parcel object
export const parcelValidator = v.object({
  type: v.string(),
  weightKg: v.optional(v.number()),
  dimensions: v.optional(v.string()),
  declaredValue: v.optional(v.number()),
  notes: v.optional(v.string()),
});

// Conversation type for voice agent call routing
// Requirements: 11.1, 11.2
export const conversationTypeValidator = v.union(
  // Restaurant conversation types
  v.literal("restaurant_inbound_order"),
  v.literal("restaurant_followup"),
  v.literal("restaurant_cancellation"),
  // Logistics conversation types
  v.literal("logistics_booking"),
  v.literal("logistics_followup"),
  v.literal("logistics_failure_notice")
);

// Proof of delivery
export const proofOfDeliveryValidator = v.object({
  photoUrl: v.optional(v.string()),
  signatureUrl: v.optional(v.string()),
  recipientName: v.optional(v.string()),
  deliveredAt: v.number(),
});
