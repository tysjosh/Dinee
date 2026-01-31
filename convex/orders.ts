import { mutation, query } from "./_generated/server";
import { v } from "convex/values";


// Get all orders for a restaurant
export const getOrdersByRestaurant = query({
  args: { restaurantId: v.string() },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .order("desc")
      .collect();

    return orders;
  },
});

// Get active orders for a restaurant
export const getActiveOrdersByRestaurant = query({
  args: { restaurantId: v.string() },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("desc")
      .collect();

    return orders;
  },
});

// Get past orders (completed or cancelled) for a restaurant
export const getPastOrdersByRestaurant = query({
  args: { restaurantId: v.string() },
  handler: async (ctx, args) => {
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .filter((q) => q.or(
        q.eq(q.field("status"), "completed"),
        q.eq(q.field("status"), "cancelled")
      ))
      .order("desc")
      .collect();

    return orders;
  },
});

// Update an order
export const updateOrder = mutation({
  args: {
    orderId: v.id("orders"),
    callId: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    customerName: v.optional(v.string()),
    items: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      quantity: v.number(),
      price: v.number(),
      specialInstructions: v.optional(v.string()),
    }))),
    totalAmount: v.optional(v.number()),
    specialInstructions: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("cancelled")
    )),
    cancellationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orderId, ...updates } = args;

    // Only update fields that are provided
    const fieldsToUpdate: any = {};
    if (updates.callId !== undefined) fieldsToUpdate.callId = updates.callId;
    if (updates.phoneNumber !== undefined) fieldsToUpdate.phoneNumber = updates.phoneNumber;
    if (updates.customerName !== undefined) fieldsToUpdate.customerName = updates.customerName;
    if (updates.items !== undefined) fieldsToUpdate.items = updates.items;
    if (updates.totalAmount !== undefined) fieldsToUpdate.totalAmount = updates.totalAmount;
    if (updates.specialInstructions !== undefined) fieldsToUpdate.specialInstructions = updates.specialInstructions;
    if (updates.status !== undefined) fieldsToUpdate.status = updates.status;
    if (updates.cancellationReason !== undefined) fieldsToUpdate.cancellationReason = updates.cancellationReason;

    await ctx.db.patch(orderId, fieldsToUpdate);
    return orderId;
  },
});

// Delete an order
export const deleteOrder = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.orderId);
    return args.orderId;
  },
});

// Complete an order
export const completeOrder = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.orderId, {
      status: "completed",
    });
    return args.orderId;
  },
});

// Cancel an order
export const cancelOrder = mutation({
  args: {
    orderId: v.id("orders"),
    cancellationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.orderId, {
      status: "cancelled",
      cancellationReason: args.cancellationReason,
    });
    return args.orderId;
  },
});

export const updateOrderPaymentByReference = mutation({
  args: {
    paymentReference: v.string(),
    paymentStatus: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("refunded"),
      v.literal("cod_pending")
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
    paymentVerifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_payment_reference", (q) => q.eq("paymentReference", args.paymentReference))
      .first();

    if (!order) {
      throw new Error("Order not found for payment reference");
    }

    await ctx.db.patch(order._id, {
      paymentStatus: args.paymentStatus,
      paymentProvider: args.paymentProvider ?? order.paymentProvider,
      paymentMethod: args.paymentMethod ?? order.paymentMethod,
      paymentVerifiedAt: args.paymentVerifiedAt ?? Date.now(),
    });

    return order._id;
  },
});

export const updateOrderDeliveryStatus = mutation({
  args: {
    orderId: v.id("orders"),
    deliveryStatus: v.union(
      v.literal("pending"),
      v.literal("preparing"),
      v.literal("dispatched"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    deliveryPartner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.orderId, {
      deliveryStatus: args.deliveryStatus,
      deliveryPartner: args.deliveryPartner,
      deliveryUpdatedAt: Date.now(),
    });

    return args.orderId;
  },
});

export const updateOrderWhatsappStatus = mutation({
  args: {
    orderId: v.id("orders"),
    whatsappStatus: v.union(
      v.literal("opted_in"),
      v.literal("opted_out"),
      v.literal("pending")
    ),
    whatsappPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.orderId, {
      whatsappStatus: args.whatsappStatus,
      whatsappPhone: args.whatsappPhone,
      whatsappLastMessageAt: Date.now(),
    });

    return args.orderId;
  },
});

export const updateOrderPaymentStatus = mutation({
  args: {
    orderId: v.id("orders"),
    paymentStatus: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("refunded"),
      v.literal("cod_pending")
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
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.orderId, {
      paymentStatus: args.paymentStatus,
      paymentProvider: args.paymentProvider,
      paymentMethod: args.paymentMethod,
      paymentVerifiedAt: Date.now(),
    });

    return args.orderId;
  },
});

export const updateOrderPaymentByOrderId = mutation({
  args: {
    orderId: v.string(),
    restaurantId: v.string(),
    paymentStatus: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("refunded"),
      v.literal("cod_pending")
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
  },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_order_and_restaurant_id", (q) =>
        q.eq("orderId", args.orderId).eq("restaurantId", args.restaurantId)
      )
      .first();

    if (!order) {
      throw new Error("Order not found");
    }

    await ctx.db.patch(order._id, {
      paymentStatus: args.paymentStatus,
      paymentProvider: args.paymentProvider,
      paymentMethod: args.paymentMethod,
      paymentVerifiedAt: Date.now(),
    });

    return order._id;
  },
});

export const updateOrderWhatsappByOrderId = mutation({
  args: {
    orderId: v.string(),
    restaurantId: v.string(),
    whatsappStatus: v.union(
      v.literal("opted_in"),
      v.literal("opted_out"),
      v.literal("pending")
    ),
    whatsappPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_order_and_restaurant_id", (q) =>
        q.eq("orderId", args.orderId).eq("restaurantId", args.restaurantId)
      )
      .first();

    if (!order) {
      throw new Error("Order not found");
    }

    await ctx.db.patch(order._id, {
      whatsappStatus: args.whatsappStatus,
      whatsappPhone: args.whatsappPhone,
      whatsappLastMessageAt: Date.now(),
    });

    return order._id;
  },
});

export const updateOrderDeliveryByOrderId = mutation({
  args: {
    orderId: v.string(),
    restaurantId: v.string(),
    deliveryStatus: v.union(
      v.literal("pending"),
      v.literal("preparing"),
      v.literal("dispatched"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
    deliveryPartner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_order_and_restaurant_id", (q) =>
        q.eq("orderId", args.orderId).eq("restaurantId", args.restaurantId)
      )
      .first();

    if (!order) {
      throw new Error("Order not found");
    }

    await ctx.db.patch(order._id, {
      deliveryStatus: args.deliveryStatus,
      deliveryPartner: args.deliveryPartner,
      deliveryUpdatedAt: Date.now(),
    });

    return order._id;
  },
});
