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

    // Define proper type for order updates
    type OrderUpdate = {
      callId?: string;
      phoneNumber?: string;
      customerName?: string;
      items?: Array<{
        id: string;
        name: string;
        quantity: number;
        price: number;
        specialInstructions?: string;
      }>;
      totalAmount?: number;
      specialInstructions?: string;
      status?: "active" | "completed" | "cancelled";
      cancellationReason?: string;
    };

    // Only update fields that are provided
    const fieldsToUpdate: OrderUpdate = {};
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