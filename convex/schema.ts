import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Platforms
  platforms: defineTable({
    platformId: v.string(),
    name: v.string(),
    createdAt: v.number(),
  }).index("by_platform_id", ["platformId"]),

  // Branches
  branches: defineTable({
    branchId: v.string(),
    platformId: v.string(),
    restaurantId: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_branch_id", ["branchId"])
    .index("by_platform_id", ["platformId"])
    .index("by_restaurant_id", ["restaurantId"]),

  // Restaurant
  restaurants: defineTable({
    restaurantId: v.string(), // 5-digit numeric restaurant ID
    platformId: v.optional(v.string()),
    name: v.string(),
    agentName: v.string(),
    specialInstructions: v.string(),
    languagePreference: v.union(
      v.literal("english"),
      v.literal("spanish"),
      v.literal("french"),
      v.literal("pidgin")
    ),
    locale: v.optional(v.string()),
    fallbackChannel: v.optional(
      v.union(v.literal("whatsapp"), v.literal("sms"), v.literal("none"))
    ),
    createdAt: v.number(),
  })
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_platform_id", ["platformId"]),

  // Menu items
  menuItems: defineTable({
    restaurantId: v.string(),
    name: v.string(),
    price: v.string(),
    description: v.optional(v.string()),
    modifiers: v.optional(v.array(v.string())),
  }).index("by_restaurant_id", ["restaurantId"]),

  // Users
  users: defineTable({
    userId: v.string(),
    email: v.string(),
    role: v.union(
      v.literal("platform_admin"),
      v.literal("restaurant_owner"),
      v.literal("branch_manager"),
      v.literal("supervisor")
    ),
    platformId: v.optional(v.string()),
    restaurantId: v.optional(v.string()),
    branchId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user_id", ["userId"])
    .index("by_platform_id", ["platformId"]),

  // Calls
  calls: defineTable({
    callId: (v.string()), // callSid from Twilio
    orderId: v.optional(v.string()), // order id
    restaurantId: v.optional(v.string()),
    platformId: v.optional(v.string()),
    branchId: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    callStartTime: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("completed"))),
  })
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_platform_id", ["platformId"])
    .index("by_call_and_order_id", ["callId", "orderId"]),

  // Orders
  orders: defineTable({
    // This order id is given to the cx and used to track the order 
    orderId: v.string(),
    restaurantId: v.string(),
    platformId: v.optional(v.string()),
    branchId: v.optional(v.string()),
    callId: v.optional(v.string()), // callSid from Twilio
    customerName: v.string(),
    items: v.array(v.object({
      name: v.string(),
      quantity: v.number(),
      price: v.number(),
    })),
    specialInstructions: v.optional(v.string()),
    totalAmount: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    paymentStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("paid"),
        v.literal("failed"),
        v.literal("refunded"),
        v.literal("cod_pending")
      )
    ),
    paymentProvider: v.optional(
      v.union(
        v.literal("paystack"),
        v.literal("flutterwave"),
        v.literal("cash"),
        v.literal("other")
      )
    ),
    paymentMethod: v.optional(
      v.union(
        v.literal("card"),
        v.literal("transfer"),
        v.literal("cash"),
        v.literal("ussd"),
        v.literal("bank")
      )
    ),
    paymentReference: v.optional(v.string()),
    paymentVerifiedAt: v.optional(v.number()),
    whatsappStatus: v.optional(
      v.union(
        v.literal("opted_in"),
        v.literal("opted_out"),
        v.literal("pending")
      )
    ),
    whatsappPhone: v.optional(v.string()),
    whatsappLastMessageAt: v.optional(v.number()),
    deliveryStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("preparing"),
        v.literal("dispatched"),
        v.literal("delivered"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
    deliveryPartner: v.optional(v.string()),
    deliveryUpdatedAt: v.optional(v.number()),
    orderPlacementTime: v.optional(v.number()),
    cancellationReason: v.optional(v.string()),
  })
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_platform_id", ["platformId"])
    .index("by_order_and_restaurant_id", ["orderId", "restaurantId"])
    .index("by_payment_reference", ["paymentReference"])
  ,

  // Telephony providers
  telephonyProviders: defineTable({
    providerId: v.string(),
    platformId: v.optional(v.string()),
    name: v.string(),
    type: v.union(v.literal("twilio"), v.literal("local"), v.literal("other")),
    priority: v.number(),
    isActive: v.boolean(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_provider_id", ["providerId"])
    .index("by_platform_id", ["platformId"]),

  // Transcripts
  transcripts: defineTable({
    callId: v.string(),
    dialogue: v.string(),
    speaker: v.union(v.literal("human"), v.literal("ai"))
  })
    .index("by_call_id", ["callId"]),

  // Monitoring metrics
  serviceMetrics: defineTable({
    serviceName: v.string(),
    status: v.union(v.literal("ok"), v.literal("degraded"), v.literal("down")),
    latencyMs: v.number(),
    recordedAt: v.number(),
  })
    .index("by_service_name", ["serviceName"])
    .index("by_recorded_at", ["recordedAt"]),

  slaConfigs: defineTable({
    serviceName: v.string(),
    uptimeTarget: v.number(),
    latencyThresholdMs: v.number(),
    createdAt: v.number(),
  }).index("by_service_name", ["serviceName"]),
});
