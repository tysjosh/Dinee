import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  requireTenantAccessOrInternal,
  requireBranchAccessOrInternal,
  requirePlatformAdmin,
  getCallerBranchRestriction,
} from "./shared/ownership";
import type { Doc } from "./_generated/dataModel";

/**
 * Restrict a tenant-scoped order list to the caller's assigned branches when
 * they are branch-scoped staff; owners/admins/internal callers see all. Applied
 * in memory to the already-fetched, tenant-scoped result so the query's index
 * usage is unchanged.
 */
async function restrictOrdersToCallerBranches(
  ctx: QueryCtx,
  orders: Doc<"orders">[],
  internalSecret: string | undefined
): Promise<Doc<"orders">[]> {
  const branchIds = await getCallerBranchRestriction(ctx, internalSecret);
  if (!branchIds) return orders;
  const allowed = new Set(branchIds);
  return orders.filter((o) => o.branchId && allowed.has(o.branchId));
}

// Orders are tenant-scoped. These functions serve the dashboard (session) and
// server routes (payment webhooks, messaging, rider API, partner API — all of
// which forward the internal secret). Order capture during a call goes through
// the secret-guarded internal.upsertOrders, not these functions.
//
// Branch-keyed readers use requireBranchAccessOrInternal so branch-scoped users
// (branch_manager / supervisor) with a populated assignedBranchIds are limited
// to their assigned branches; owners/admins and internal callers are not.

/** Resolve an orderId (business id, not doc id) to its owning restaurantId. */
async function orderRestaurantId(ctx: QueryCtx, orderId: string): Promise<string> {
  const order = await ctx.db
    .query("orders")
    .withIndex("by_order_id", (q) => q.eq("orderId", orderId))
    .unique();
  return order?.restaurantId ?? "";
}

// Get an order by orderId
export const getOrderByOrderId = query({
  args: { orderId: v.string(), restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const order = await ctx.db
      .query("orders")
      .withIndex("by_order_and_restaurant_id", (q) =>
        q.eq("orderId", args.orderId).eq("restaurantId", args.restaurantId)
      )
      .unique();
    return order || null;
  },
});
// Look up an order by orderId only (without restaurantId)
// Used by webhook handlers, rider API, and messaging routes that only have orderId
export const getOrderByOrderIdOnly = query({
  args: { orderId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("orders")
      .withIndex("by_order_id", (q) => q.eq("orderId", args.orderId))
      .unique();
    await requireTenantAccessOrInternal(ctx, order?.restaurantId ?? "", args.internalSecret);
    return order || null;
  },
});


// Update payment status for an order
export const updatePaymentStatus = mutation({
  args: {
    orderId: v.string(),
    restaurantId: v.string(),
    paymentStatus: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("refunded")
    ),
    paymentReference: v.optional(v.string()),
    paymentTimestamp: v.optional(v.number()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    // Find the order by orderId using index
    const order = await ctx.db
      .query("orders")
      .withIndex("by_order_and_restaurant_id", (q) =>
        q.eq("orderId", args.orderId).eq("restaurantId", args.restaurantId)
      )
      .unique();
    
    if (!order) {
      throw new Error(`Order not found: ${args.orderId}`);
    }

    // Build update object
    const updates: {
      paymentStatus: "pending" | "paid" | "failed" | "refunded";
      paymentReference?: string;
      paymentTimestamp?: number;
    } = {
      paymentStatus: args.paymentStatus,
    };

    if (args.paymentReference !== undefined) {
      updates.paymentReference = args.paymentReference;
    }
    if (args.paymentTimestamp !== undefined) {
      updates.paymentTimestamp = args.paymentTimestamp;
    }

    await ctx.db.patch(order._id, updates);
    return order._id;
  },
});

// Bounded default for "all orders" reads. These tables grow with every order
// ever placed, so an unbounded `.collect()` eventually hits Convex read limits
// and heavy payloads. We cap to the newest N (desc) by default; callers may
// request more up to MAX_ORDER_QUERY_LIMIT. Cursor-based pagination is the
// longer-term follow-up for true history browsing.
const DEFAULT_ORDER_QUERY_LIMIT = 500;
const MAX_ORDER_QUERY_LIMIT = 1000;

function clampOrderLimit(limit?: number): number {
  if (limit == null || Number.isNaN(limit) || limit <= 0) {
    return DEFAULT_ORDER_QUERY_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_ORDER_QUERY_LIMIT);
}

// Get orders for a restaurant (newest first, bounded).
//
// When `startDate`/`endDate` (ms epoch, matched against `orderPlacementTime`)
// are supplied, the read is scoped to that window via the
// `by_restaurant_and_placement` index BEFORE the limit is applied — so the cap
// bounds the requested date window rather than the global newest N. This is
// what lets date-filtered history reads (e.g. the partner API) page through
// older orders instead of silently missing anything outside the newest N.
// Orders without an `orderPlacementTime` are excluded from date-scoped reads
// (they cannot satisfy a date filter anyway).
export const getOrdersByRestaurant = query({
  args: {
    restaurantId: v.string(),
    limit: v.optional(v.number()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const { restaurantId, startDate, endDate } = args;
    const take = clampOrderLimit(args.limit);

    if (startDate !== undefined || endDate !== undefined) {
      return await ctx.db
        .query("orders")
        .withIndex("by_restaurant_and_placement", (q) => {
          const base = q.eq("restaurantId", restaurantId);
          if (startDate !== undefined && endDate !== undefined) {
            return base
              .gte("orderPlacementTime", startDate)
              .lte("orderPlacementTime", endDate);
          }
          if (startDate !== undefined) {
            return base.gte("orderPlacementTime", startDate);
          }
          return base.lte("orderPlacementTime", endDate!);
        })
        .order("desc")
        .take(take);
    }

    return await ctx.db
      .query("orders")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", restaurantId))
      .order("desc")
      .take(take);
  },
});

// Get orders for a branch (newest first, bounded).
export const getOrdersByBranch = query({
  args: { branchId: v.string(), limit: v.optional(v.number()), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireBranchAccessOrInternal(ctx, args.branchId, args.internalSecret);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .order("desc")
      .take(clampOrderLimit(args.limit));

    return orders;
  },
});

// Get active orders for a restaurant
export const getActiveOrdersByRestaurant = query({
  args: { restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("desc")
      .take(1000);

    return restrictOrdersToCallerBranches(ctx, orders, args.internalSecret);
  },
});

// Get active orders for a branch
export const getActiveOrdersByBranch = query({
  args: { branchId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireBranchAccessOrInternal(ctx, args.branchId, args.internalSecret);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .order("desc")
      .take(1000);

    return orders;
  },
});

// Get past orders (completed or cancelled) for a restaurant
export const getPastOrdersByRestaurant = query({
  args: { restaurantId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .filter((q) => q.or(
        q.eq(q.field("status"), "completed"),
        q.eq(q.field("status"), "cancelled")
      ))
      .order("desc")
      .take(1000);

    return restrictOrdersToCallerBranches(ctx, orders, args.internalSecret);
  },
});

// Get past orders (completed or cancelled) for a branch
export const getPastOrdersByBranch = query({
  args: { branchId: v.string(), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireBranchAccessOrInternal(ctx, args.branchId, args.internalSecret);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .filter((q) => q.or(
        q.eq(q.field("status"), "completed"),
        q.eq(q.field("status"), "cancelled")
      ))
      .order("desc")
      .take(1000);

    return orders;
  },
});

// Get orders by payment status (platform-wide, cross-tenant) — admins only.
export const getOrdersByPaymentStatus = query({
  args: { paymentStatus: v.union(
    v.literal("pending"),
    v.literal("paid"),
    v.literal("failed"),
    v.literal("refunded")
  ) },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_payment_status", (q) => q.eq("paymentStatus", args.paymentStatus))
      .order("desc")
      .take(1000);

    return orders;
  },
});

// Get orders by delivery status (platform-wide, cross-tenant) — admins only.
export const getOrdersByDeliveryStatus = query({
  args: { deliveryStatus: v.union(
    v.literal("pending"),
    v.literal("assigned"),
    v.literal("dispatched"),
    v.literal("in_transit"),
    v.literal("delivered"),
    v.literal("failed")
  ) },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_delivery_status", (q) => q.eq("deliveryStatus", args.deliveryStatus))
      .order("desc")
      .take(1000);

    return orders;
  },
});

// Update an order
export const updateOrder = mutation({
  args: {
    orderId: v.id("orders"),
    branchId: v.optional(v.string()),
    callId: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    customerName: v.optional(v.string()),
    customerPhone: v.optional(v.string()),
    items: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      quantity: v.number(),
      price: v.number(),
      specialInstructions: v.optional(v.string()),
      modifiers: v.optional(v.array(v.object({
        name: v.string(),
        price: v.number(),
      }))),
    }))),
    totalAmount: v.optional(v.number()),
    specialInstructions: v.optional(v.string()),
    status: v.optional(v.union(
      v.literal("active"),
      v.literal("preparing"),
      v.literal("ready"),
      v.literal("completed"),
      v.literal("cancelled")
    )),
    cancellationReason: v.optional(v.string()),
    // Payment fields
    paymentMethod: v.optional(v.union(
      v.literal("paystack"),
      v.literal("flutterwave"),
      v.literal("cod"),
      v.literal("stripe")
    )),
    paymentStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("refunded")
    )),
    paymentReference: v.optional(v.string()),
    paymentTimestamp: v.optional(v.number()),
    // Delivery fields
    deliveryStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("assigned"),
      v.literal("dispatched"),
      v.literal("in_transit"),
      v.literal("delivered"),
      v.literal("failed")
    )),
    riderId: v.optional(v.string()),
    riderName: v.optional(v.string()),
    dispatchedAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    deliveryFailureReason: v.optional(v.string()),
    // WhatsApp fields
    whatsappOptIn: v.optional(v.boolean()),
    whatsappMessageIds: v.optional(v.array(v.string())),
    // Messaging options
    sendStatusMessage: v.optional(v.boolean()),
    restaurantName: v.optional(v.string()),
    estimatedDeliveryMinutes: v.optional(v.number()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orderId, sendStatusMessage, restaurantName, estimatedDeliveryMinutes, internalSecret, ...updates } = args;

    // Get the current order to check for status changes
    const currentOrder = await ctx.db.get(orderId);
    if (!currentOrder) {
      throw new Error(`Order not found: ${orderId}`);
    }

    await requireTenantAccessOrInternal(ctx, currentOrder.restaurantId, internalSecret);

    // Define proper type for order updates
    type OrderUpdate = {
      branchId?: string;
      callId?: string;
      phoneNumber?: string;
      customerName?: string;
      customerPhone?: string;
      items?: Array<{
        id: string;
        name: string;
        quantity: number;
        price: number;
        specialInstructions?: string;
        modifiers?: Array<{
          name: string;
          price: number;
        }>;
      }>;
      totalAmount?: number;
      specialInstructions?: string;
      status?: "active" | "preparing" | "ready" | "completed" | "cancelled";
      cancellationReason?: string;
      // Payment fields
      paymentMethod?: "paystack" | "flutterwave" | "cod" | "stripe";
      paymentStatus?: "pending" | "paid" | "failed" | "refunded";
      paymentReference?: string;
      paymentTimestamp?: number;
      // Delivery fields
      deliveryStatus?: "pending" | "assigned" | "dispatched" | "in_transit" | "delivered" | "failed";
      riderId?: string;
      riderName?: string;
      dispatchedAt?: number;
      deliveredAt?: number;
      deliveryFailureReason?: string;
      // WhatsApp fields
      whatsappOptIn?: boolean;
      whatsappMessageIds?: string[];
    };

    // Only update fields that are provided
    const fieldsToUpdate: OrderUpdate = {};
    if (updates.branchId !== undefined) fieldsToUpdate.branchId = updates.branchId;
    if (updates.callId !== undefined) fieldsToUpdate.callId = updates.callId;
    if (updates.phoneNumber !== undefined) fieldsToUpdate.phoneNumber = updates.phoneNumber;
    if (updates.customerName !== undefined) fieldsToUpdate.customerName = updates.customerName;
    if (updates.customerPhone !== undefined) fieldsToUpdate.customerPhone = updates.customerPhone;
    if (updates.items !== undefined) fieldsToUpdate.items = updates.items;
    if (updates.totalAmount !== undefined) fieldsToUpdate.totalAmount = updates.totalAmount;
    if (updates.specialInstructions !== undefined) fieldsToUpdate.specialInstructions = updates.specialInstructions;
    if (updates.status !== undefined) fieldsToUpdate.status = updates.status;
    if (updates.cancellationReason !== undefined) fieldsToUpdate.cancellationReason = updates.cancellationReason;
    // Payment fields
    if (updates.paymentMethod !== undefined) fieldsToUpdate.paymentMethod = updates.paymentMethod;
    if (updates.paymentStatus !== undefined) fieldsToUpdate.paymentStatus = updates.paymentStatus;
    if (updates.paymentReference !== undefined) fieldsToUpdate.paymentReference = updates.paymentReference;
    if (updates.paymentTimestamp !== undefined) fieldsToUpdate.paymentTimestamp = updates.paymentTimestamp;
    // Delivery fields
    if (updates.deliveryStatus !== undefined) fieldsToUpdate.deliveryStatus = updates.deliveryStatus;
    if (updates.riderId !== undefined) fieldsToUpdate.riderId = updates.riderId;
    if (updates.riderName !== undefined) fieldsToUpdate.riderName = updates.riderName;
    if (updates.dispatchedAt !== undefined) fieldsToUpdate.dispatchedAt = updates.dispatchedAt;
    if (updates.deliveredAt !== undefined) fieldsToUpdate.deliveredAt = updates.deliveredAt;
    if (updates.deliveryFailureReason !== undefined) fieldsToUpdate.deliveryFailureReason = updates.deliveryFailureReason;
    // WhatsApp fields
    if (updates.whatsappOptIn !== undefined) fieldsToUpdate.whatsappOptIn = updates.whatsappOptIn;
    if (updates.whatsappMessageIds !== undefined) fieldsToUpdate.whatsappMessageIds = updates.whatsappMessageIds;

    await ctx.db.patch(orderId, fieldsToUpdate);

    // Check if we should send a status update message
    // Requirements 12.1, 12.2, 12.3, 12.4: Send WhatsApp messages on status changes
    const shouldSendMessage = sendStatusMessage !== false && 
                              currentOrder.whatsappOptIn && 
                              currentOrder.customerPhone;
    
    if (shouldSendMessage && updates.status && updates.status !== currentOrder.status) {
      const messageTriggerStatuses = ["preparing", "dispatched", "delivered", "cancelled"];
      
      if (messageTriggerStatuses.includes(updates.status)) {
        // Schedule the status update message to be sent asynchronously
        await ctx.scheduler.runAfter(0, internal.messaging.sendStatusUpdateInternal, {
          orderId: currentOrder.orderId,
          status: updates.status as "preparing" | "dispatched" | "delivered" | "cancelled",
          restaurantName: restaurantName,
          riderName: updates.riderName || currentOrder.riderName,
          estimatedDeliveryMinutes: estimatedDeliveryMinutes,
          cancellationReason: updates.cancellationReason || currentOrder.cancellationReason,
        });
      }
    }

    return orderId;
  },
});

// Delete an order
export const deleteOrder = mutation({
  args: { orderId: v.id("orders"), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.orderId);
    await requireTenantAccessOrInternal(ctx, existing?.restaurantId ?? "", args.internalSecret);
    await ctx.db.delete(args.orderId);
    return args.orderId;
  },
});

// Complete an order
export const completeOrder = mutation({
  args: { orderId: v.id("orders"), internalSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.orderId);
    await requireTenantAccessOrInternal(ctx, existing?.restaurantId ?? "", args.internalSecret);
    await ctx.db.patch(args.orderId, {
      status: "completed",
    });
    return args.orderId;
  },
});

// Cancel an order
// Implements requirement 12.4: Send WhatsApp message when order is cancelled with reason
export const cancelOrder = mutation({
  args: {
    orderId: v.id("orders"),
    cancellationReason: v.optional(v.string()),
    sendStatusMessage: v.optional(v.boolean()),
    restaurantName: v.optional(v.string()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get the current order to check opt-in status
    const currentOrder = await ctx.db.get(args.orderId);
    if (!currentOrder) {
      throw new Error(`Order not found: ${args.orderId}`);
    }

    await requireTenantAccessOrInternal(ctx, currentOrder.restaurantId, args.internalSecret);

    await ctx.db.patch(args.orderId, {
      status: "cancelled",
      cancellationReason: args.cancellationReason,
    });

    // Send cancellation message if customer has opted in
    // Requirement 12.4: Send WhatsApp message when order is cancelled with reason
    const shouldSendMessage = args.sendStatusMessage !== false && 
                              currentOrder.whatsappOptIn && 
                              currentOrder.customerPhone;
    
    if (shouldSendMessage) {
      await ctx.scheduler.runAfter(0, internal.messaging.sendStatusUpdateInternal, {
        orderId: currentOrder.orderId,
        status: "cancelled",
        restaurantName: args.restaurantName,
        cancellationReason: args.cancellationReason || "Order cancelled",
      });
    }

    return args.orderId;
  },
});

// Create an order with payment method
// Implements requirement 11.2: Send WhatsApp confirmation when order is placed
export const createOrderWithPayment = mutation({
  args: {
    orderId: v.string(),
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    callId: v.optional(v.string()),
    customerName: v.string(),
    customerPhone: v.optional(v.string()),
    items: v.array(v.object({
      name: v.string(),
      quantity: v.number(),
      price: v.number(),
      modifiers: v.optional(v.array(v.object({
        name: v.string(),
        price: v.number(),
      }))),
    })),
    specialInstructions: v.optional(v.string()),
    totalAmount: v.number(),
    paymentMethod: v.union(
      v.literal("paystack"),
      v.literal("flutterwave"),
      v.literal("cod"),
      v.literal("stripe")
    ),
    whatsappOptIn: v.optional(v.boolean()),
    restaurantName: v.optional(v.string()),
    estimatedDeliveryMinutes: v.optional(v.number()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    // Determine initial payment status based on payment method
    // COD orders start with "pending" status as per requirement 10.1
    const paymentStatus = "pending";
    
    const order = await ctx.db.insert("orders", {
      orderId: args.orderId,
      restaurantId: args.restaurantId,
      branchId: args.branchId,
      callId: args.callId,
      customerName: args.customerName,
      customerPhone: args.customerPhone,
      items: args.items,
      specialInstructions: args.specialInstructions,
      totalAmount: args.totalAmount,
      status: "active",
      paymentMethod: args.paymentMethod,
      paymentStatus: paymentStatus,
      orderPlacementTime: Date.now(),
      whatsappOptIn: args.whatsappOptIn,
      // Initialize delivery status for COD orders
      deliveryStatus: args.paymentMethod === "cod" ? "pending" : undefined,
    });

    // Schedule order confirmation message if customer has opted in
    // Requirement 11.2: Send WhatsApp confirmation when order is placed and customer has opted in
    if (args.whatsappOptIn && args.customerPhone) {
      // Schedule the message to be sent asynchronously
      // This allows the order creation to complete quickly while the message is sent in the background
      await ctx.scheduler.runAfter(0, internal.messaging.sendOrderConfirmationInternal, {
        orderId: args.orderId,
        restaurantName: args.restaurantName,
        estimatedDeliveryMinutes: args.estimatedDeliveryMinutes,
      });
    }
    
    return order;
  },
});

// Get COD orders for a branch (for reconciliation)
export const getCODOrdersByBranch = query({
  args: { 
    branchId: v.string(),
    date: v.optional(v.string()), // YYYY-MM-DD format
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireBranchAccessOrInternal(ctx, args.branchId, args.internalSecret);
    let orders = await ctx.db
      .query("orders")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .filter((q) => q.eq(q.field("paymentMethod"), "cod"))
      .order("desc")
      .take(1000);
    
    // Filter by date if provided
    if (args.date) {
      const startOfDay = new Date(args.date).setHours(0, 0, 0, 0);
      const endOfDay = new Date(args.date).setHours(23, 59, 59, 999);
      
      orders = orders.filter(order => {
        const orderTime = order.orderPlacementTime || 0;
        return orderTime >= startOfDay && orderTime <= endOfDay;
      });
    }
    
    return orders;
  },
});

// Record COD payment collection
export const recordCODPaymentCollection = mutation({
  args: {
    orderId: v.string(),
    restaurantId: v.string(),
    collectedBy: v.string(),
    notes: v.optional(v.string()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    // Find the order by orderId using index
    const order = await ctx.db
      .query("orders")
      .withIndex("by_order_and_restaurant_id", (q) =>
        q.eq("orderId", args.orderId).eq("restaurantId", args.restaurantId)
      )
      .unique();
    
    if (!order) {
      throw new Error(`Order not found: ${args.orderId}`);
    }
    
    // Verify this is a COD order
    if (order.paymentMethod !== "cod") {
      throw new Error(`Order ${args.orderId} is not a COD order`);
    }
    
    // Update payment status to paid
    await ctx.db.patch(order._id, {
      paymentStatus: "paid",
      paymentTimestamp: Date.now(),
      paymentReference: `COD_COLLECTED_${Date.now()}`,
    });
    
    return order._id;
  },
});

// Record COD payment failure
// Implements requirement 10.5: Allow marking as "payment_failed" with a reason
export const recordCODPaymentFailure = mutation({
  args: {
    orderId: v.string(),
    restaurantId: v.string(),
    failureReason: v.string(),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    // Find the order by orderId using index
    const order = await ctx.db
      .query("orders")
      .withIndex("by_order_and_restaurant_id", (q) =>
        q.eq("orderId", args.orderId).eq("restaurantId", args.restaurantId)
      )
      .unique();
    
    if (!order) {
      throw new Error(`Order not found: ${args.orderId}`);
    }
    
    // Verify this is a COD order
    if (order.paymentMethod !== "cod") {
      throw new Error(`Order ${args.orderId} is not a COD order`);
    }
    
    // Update payment status to failed with reason
    await ctx.db.patch(order._id, {
      paymentStatus: "failed",
      paymentTimestamp: Date.now(),
      paymentReference: `COD_FAILED_${Date.now()}_${args.failureReason.substring(0, 50)}`,
    });
    
    return order._id;
  },
});

// Get COD reconciliation summary for a branch
// Implements requirements 10.6 and 10.7:
// - 10.6: Track COD collection amounts for daily reconciliation
// - 10.7: Display daily COD collection summary in branch dashboard
export const getCODReconciliationSummary = query({
  args: {
    branchId: v.string(),
    date: v.optional(v.string()), // YYYY-MM-DD format, defaults to today
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireBranchAccessOrInternal(ctx, args.branchId, args.internalSecret);
    // Get the date to filter by (default to today)
    const targetDate = args.date || new Date().toISOString().split('T')[0];
    const startOfDay = new Date(targetDate).setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate).setHours(23, 59, 59, 999);

    // Get all COD orders for the branch
    const allOrders = await ctx.db
      .query("orders")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .filter((q) => q.eq(q.field("paymentMethod"), "cod"))
      .collect();

    // Filter orders by date
    const ordersForDate = allOrders.filter(order => {
      const orderTime = order.orderPlacementTime || 0;
      return orderTime >= startOfDay && orderTime <= endOfDay;
    });

    // Calculate totals
    const paidOrders = ordersForDate.filter(o => o.paymentStatus === "paid");
    const pendingOrders = ordersForDate.filter(o => o.paymentStatus === "pending");
    const failedOrders = ordersForDate.filter(o => o.paymentStatus === "failed");

    const totalCollected = paidOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const pendingAmount = pendingOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const failedAmount = failedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    // Build collections list with details
    const collections = paidOrders.map(order => ({
      orderId: order.orderId,
      amount: order.totalAmount || 0,
      collectedBy: order.paymentReference?.includes('COD_COLLECTED') 
        ? 'Staff' // Default collector name
        : 'Unknown',
      collectedAt: order.paymentTimestamp || 0,
      branchId: args.branchId,
      customerName: order.customerName,
    }));

    // Group collections by collector for summary
    const collectionsByCollector: Record<string, number> = {};
    collections.forEach(c => {
      collectionsByCollector[c.collectedBy] = (collectionsByCollector[c.collectedBy] || 0) + c.amount;
    });

    return {
      date: targetDate,
      branchId: args.branchId,
      totalOrders: ordersForDate.length,
      totalCollected,
      paidOrderCount: paidOrders.length,
      pendingOrders: pendingOrders.length,
      pendingAmount,
      failedOrders: failedOrders.length,
      failedAmount,
      collections,
      collectionsByCollector,
    };
  },
});


// Update order status with messaging support
// Implements requirements 12.1, 12.2, 12.3, 12.4: Send WhatsApp messages on status changes
export const updateOrderStatus = mutation({
  args: {
    orderId: v.string(),
    restaurantId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("preparing"),
      v.literal("ready"),
      v.literal("completed"),
      v.literal("cancelled")
    ),
    cancellationReason: v.optional(v.string()),
    riderName: v.optional(v.string()),
    riderId: v.optional(v.string()),
    sendStatusMessage: v.optional(v.boolean()),
    restaurantName: v.optional(v.string()),
    estimatedDeliveryMinutes: v.optional(v.number()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    // Find the order by orderId using index
    const order = await ctx.db
      .query("orders")
      .withIndex("by_order_and_restaurant_id", (q) =>
        q.eq("orderId", args.orderId).eq("restaurantId", args.restaurantId)
      )
      .unique();
    
    if (!order) {
      throw new Error(`Order not found: ${args.orderId}`);
    }

    // Build update object
    type StatusUpdate = {
      status: "active" | "preparing" | "ready" | "completed" | "cancelled";
      cancellationReason?: string;
      riderName?: string;
      riderId?: string;
      dispatchedAt?: number;
      deliveredAt?: number;
      deliveryStatus?: "pending" | "assigned" | "dispatched" | "in_transit" | "delivered" | "failed";
    };

    const updates: StatusUpdate = {
      status: args.status,
    };

    // Add cancellation reason if provided
    if (args.cancellationReason !== undefined) {
      updates.cancellationReason = args.cancellationReason;
    }

    // Add rider info if provided
    if (args.riderName !== undefined) {
      updates.riderName = args.riderName;
    }
    if (args.riderId !== undefined) {
      updates.riderId = args.riderId;
    }

    // Update delivery status based on order status
    if (args.status === "preparing") {
      updates.deliveryStatus = "pending";
    } else if (args.status === "completed") {
      updates.deliveryStatus = "delivered";
      updates.deliveredAt = Date.now();
    }

    await ctx.db.patch(order._id, updates);

    // Send status update message if customer has opted in
    // Requirements 12.1, 12.2, 12.3, 12.4: Send WhatsApp messages on status changes
    const shouldSendMessage = args.sendStatusMessage !== false && 
                              order.whatsappOptIn && 
                              order.customerPhone;
    
    const messageTriggerStatuses = ["preparing", "dispatched", "delivered", "cancelled"];
    
    if (shouldSendMessage && messageTriggerStatuses.includes(args.status)) {
      await ctx.scheduler.runAfter(0, internal.messaging.sendStatusUpdateInternal, {
        orderId: args.orderId,
        status: args.status as "preparing" | "dispatched" | "delivered" | "cancelled",
        restaurantName: args.restaurantName,
        riderName: args.riderName || order.riderName,
        estimatedDeliveryMinutes: args.estimatedDeliveryMinutes,
        cancellationReason: args.cancellationReason || order.cancellationReason,
      });
    }

    return order._id;
  },
});

// Update delivery status with messaging support
// Implements requirements 12.2, 12.3: Send WhatsApp messages on delivery status changes
export const updateDeliveryStatus = mutation({
  args: {
    orderId: v.string(),
    restaurantId: v.string(),
    deliveryStatus: v.union(
      v.literal("pending"),
      v.literal("assigned"),
      v.literal("dispatched"),
      v.literal("in_transit"),
      v.literal("delivered"),
      v.literal("failed")
    ),
    riderId: v.optional(v.string()),
    riderName: v.optional(v.string()),
    deliveryFailureReason: v.optional(v.string()),
    sendStatusMessage: v.optional(v.boolean()),
    restaurantName: v.optional(v.string()),
    estimatedDeliveryMinutes: v.optional(v.number()),
    internalSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenantAccessOrInternal(ctx, args.restaurantId, args.internalSecret);
    // Find the order by orderId using index
    const order = await ctx.db
      .query("orders")
      .withIndex("by_order_and_restaurant_id", (q) =>
        q.eq("orderId", args.orderId).eq("restaurantId", args.restaurantId)
      )
      .unique();
    
    if (!order) {
      throw new Error(`Order not found: ${args.orderId}`);
    }

    // Build update object
    type DeliveryUpdate = {
      deliveryStatus: "pending" | "assigned" | "dispatched" | "in_transit" | "delivered" | "failed";
      riderId?: string;
      riderName?: string;
      dispatchedAt?: number;
      deliveredAt?: number;
      deliveryFailureReason?: string;
      status?: "active" | "preparing" | "ready" | "completed" | "cancelled";
    };

    const updates: DeliveryUpdate = {
      deliveryStatus: args.deliveryStatus,
    };

    // Add rider info if provided
    if (args.riderId !== undefined) {
      updates.riderId = args.riderId;
    }
    if (args.riderName !== undefined) {
      updates.riderName = args.riderName;
    }

    // Add timestamps based on delivery status
    if (args.deliveryStatus === "dispatched") {
      updates.dispatchedAt = Date.now();
    } else if (args.deliveryStatus === "delivered") {
      updates.deliveredAt = Date.now();
      updates.status = "completed";
    } else if (args.deliveryStatus === "failed") {
      updates.deliveryFailureReason = args.deliveryFailureReason;
    }

    await ctx.db.patch(order._id, updates);

    // Send status update message if customer has opted in
    // Requirements 12.2, 12.3: Send WhatsApp messages on delivery status changes
    const shouldSendMessage = args.sendStatusMessage !== false && 
                              order.whatsappOptIn && 
                              order.customerPhone;
    
    // Map delivery status to message status
    const deliveryToMessageStatus: Record<string, "dispatched" | "delivered" | undefined> = {
      dispatched: "dispatched",
      delivered: "delivered",
    };
    
    const messageStatus = deliveryToMessageStatus[args.deliveryStatus];
    
    if (shouldSendMessage && messageStatus) {
      await ctx.scheduler.runAfter(0, internal.messaging.sendStatusUpdateInternal, {
        orderId: args.orderId,
        status: messageStatus,
        restaurantName: args.restaurantName,
        riderName: args.riderName || order.riderName,
        estimatedDeliveryMinutes: args.estimatedDeliveryMinutes,
      });
    }

    return order._id;
  },
});
