/**
 * Utilites are used by the AI to perform tasks.
 * */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { conversationTypeValidator } from "./shared/validators";

/** Generate a simple unique billing event ID */
function generateBillingEventId(prefix: string): string {
  return `be_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}


export const getRestaurantAndMenuDetailsUsingId = query({
  args: { restaurantId: v.string() },
  handler: async (ctx, args) => {
    try {
      console.log("🏃 Getting restaurant details")
      const restaurantDetails = await ctx.db
        .query("restaurants")
        .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
        .collect();

      // When no details are present in the Convex DB
      if (!restaurantDetails.length) {
        return {
          success: true,
          data: {
            restaurantDetails: null,
            menuDetails: null,
          }
        }
      }

      // Gets the menu details using the restaurant id
      const menuDetails = await ctx.db
        .query("menuItems")
        .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
        .collect();

      // The restaurant details do not exist if the menu details are absent
      if (!menuDetails.length) {
        return {
          success: true,
          data: {
            restaurantDetails: null,
            menuDetails: null,
          }
        }
      }

      // transform restaurant and menu details
      // extra restaurant keys
      const EXTRA_RESTAURANT_KEYS: (keyof (Doc<"restaurants">))[] = ["_id", "_creationTime", "createdAt", "restaurantId"]
      // extra menu keys
      const EXTRA_MENU_KEYS: (keyof (Doc<"menuItems">))[] = ["_id", "_creationTime", "restaurantId"]

      EXTRA_RESTAURANT_KEYS.forEach((key) => {
        delete restaurantDetails[0][key]
      })
      menuDetails.forEach((menu) => {
        EXTRA_MENU_KEYS.forEach((key) => {
          delete menu[key]
        })
      })

      return {
        success: true,
        data: {
          restaurantDetails: restaurantDetails[0],
          menuDetails
        }
      }
    } catch (error) {
      console.log("😵 Error in `getRestaurantAndMenuDetailsUsingId`", error)
      return {
        success: false,
        data: {}
      }
    }
  },
})



export const upsertCallData = mutation({
  args: {
    data: v.object({
      callId: v.string(),
      restaurantId: v.optional(v.string()),
      phoneNumber: v.optional(v.string()),
      status: v.optional(v.union(v.literal("active"), v.literal("completed"))),
      orderId: v.optional(v.optional(v.string())),
      // Req 11.3: Conversation type for call routing
      conversationType: v.optional(conversationTypeValidator),
      // Req 17.7: Voice session correlation ID for end-to-end tracing
      correlationId: v.optional(v.string()),
      // REQ-4.4: Attribution fields
      source_platform: v.optional(v.string()),
      source_tenant: v.optional(v.string()),
      external_reference_id: v.optional(v.string()),
    })
  },
  handler: async (ctx, args) => {
    try {
      const {
        callId
      } = args.data
      console.log("📞 Upserting data")
      console.log(args.data)
      const callDataResponse = await ctx.db.query("calls")
        .withIndex("by_call_and_order_id", (q) => q.eq("callId", callId))
        .unique()

      // Add new query when the callid is being added for the first time
      if (!callDataResponse) {
        await ctx.db.insert("calls", { ...args.data, callStartTime: Date.now() })

        // Dispatch webhook: call.started
        if (args.data.restaurantId) {
          await ctx.scheduler.runAfter(0, internal.webhookDeliveries.dispatchWebhookEvent, {
            eventType: args.data.status === "completed" ? "call.completed" : "call.started",
            businessId: args.data.restaurantId,
            payload: JSON.stringify({ callId: args.data.callId, restaurantId: args.data.restaurantId, status: args.data.status }),
          });
        }

        // Emit billing event if inserted with status "completed"
        if (args.data.status === "completed" && args.data.restaurantId) {
          const restaurant = await ctx.db
            .query("restaurants")
            .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.data.restaurantId!))
            .first();
          const vertical = restaurant?.vertical ?? "restaurant";
          await ctx.db.insert("billingEvents", {
            eventId: generateBillingEventId("call"),
            businessId: args.data.restaurantId,
            vertical: vertical as "restaurant" | "logistics" | "healthcare" | "legal" | "hospitality" | "general_services",
            eventType: "call_completed",
            durationSeconds: 0,
            sourcePlatform: args.data.source_platform,
            createdAt: Date.now(),
          });
        }

        return {
          success: true,
          message: "Data upserts successfully"
        }
      }

      // Update the existing call data
      const { _id: tableCallId } = callDataResponse
      const previousStatus = callDataResponse.status;
      await ctx.db.patch(tableCallId, args.data)

      // Dispatch webhook: call.completed when status changes to completed
      if (args.data.status === "completed" && previousStatus !== "completed" && args.data.restaurantId) {
        await ctx.scheduler.runAfter(0, internal.webhookDeliveries.dispatchWebhookEvent, {
          eventType: "call.completed",
          businessId: args.data.restaurantId,
          payload: JSON.stringify({ callId: args.data.callId, restaurantId: args.data.restaurantId, status: "completed" }),
        });
      }

      // Emit billing event when status changes to "completed"
      if (args.data.status === "completed" && previousStatus !== "completed" && args.data.restaurantId) {
        const restaurant = await ctx.db
          .query("restaurants")
          .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.data.restaurantId!))
          .first();
        const vertical = restaurant?.vertical ?? "restaurant";
        const durationSeconds = callDataResponse.callStartTime
          ? Math.round((Date.now() - callDataResponse.callStartTime) / 1000)
          : 0;
        await ctx.db.insert("billingEvents", {
          eventId: generateBillingEventId("call"),
          businessId: args.data.restaurantId,
          vertical: vertical as "restaurant" | "logistics" | "healthcare" | "legal" | "hospitality" | "general_services",
          eventType: "call_completed",
          durationSeconds,
          sourcePlatform: args.data.source_platform,
          createdAt: Date.now(),
        });
      }

      return {
        success: true,
        message: "Data upserts successfully"
      }
    } catch (error) {
      console.log("😵 Error in `upsertCallData`", (error as Error).message)
      return {
        success: false,
        message: "Something went wrong while upserting the data"
      }
    }
  }
})



// Adds dialogues to the `transcript` table
export const addTranscript = mutation({
  args: {
    data: v.object({
      callId: v.string(),
      dialogue: v.string(),
      speaker: v.union(v.literal("human"), v.literal("ai")),
      // Req 17.9: Voice session correlation ID for end-to-end tracing
      correlationId: v.optional(v.string()),
    })
  },
  handler: async (ctx, args) => {
    try {
      await ctx.db.insert("transcripts", { ...args.data })
      return { success: true, message: "Dialogue added" }
    } catch (error) {
      console.log("😵 Error in `addTranscript`", (error as Error).message)
      return {
        success: false,
        message: "Something went wrong while adding the dialogue"
      }
    }
  }
})


export const upsertOrders = mutation({
  args: {
    data: v.object({
      orderId: v.string(),
      publicOrderCode: v.optional(v.string()),
      restaurantId: v.string(),
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
        v.literal("preparing"),
        v.literal("ready"),
        v.literal("completed"),
        v.literal("cancelled")
      ),
      cancellationReason: v.optional(v.string()),
      // REQ-4.4: Attribution fields
      source_platform: v.optional(v.string()),
      source_tenant: v.optional(v.string()),
      external_reference_id: v.optional(v.string()),
    })
  },
  handler: async (ctx, args) => {
    try {
      const {
        orderId
      } = args.data
      console.log("💬 Args.data")
      console.log(args.data)
      // checks for the existing order id
      const orderResponse = await ctx.db.query("orders")
        .withIndex("by_order_and_restaurant_id", (q) => q.eq("orderId", orderId).eq("restaurantId", args.data.restaurantId))
        .unique()

      if (!orderResponse) {
        await ctx.db.insert("orders", { ...args.data, orderPlacementTime: Date.now() })

        // Dispatch webhook: order.created
        await ctx.scheduler.runAfter(0, internal.webhookDeliveries.dispatchWebhookEvent, {
          eventType: "order.created",
          businessId: args.data.restaurantId,
          payload: JSON.stringify({ orderId: args.data.orderId, restaurantId: args.data.restaurantId, status: args.data.status }),
        });

        // Emit billing event for new order
        const restaurant = await ctx.db
          .query("restaurants")
          .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.data.restaurantId))
          .first();
        const vertical = restaurant?.vertical ?? "restaurant";
        await ctx.db.insert("billingEvents", {
          eventId: generateBillingEventId("order"),
          businessId: args.data.restaurantId,
          vertical: vertical as "restaurant" | "logistics" | "healthcare" | "legal" | "hospitality" | "general_services",
          eventType: "order_placed",
          outcome: "order_placed",
          sourcePlatform: args.data.source_platform,
          createdAt: Date.now(),
        });

        return {
          success: true,
          message: "Order upserted successfully"
        }
      }
      // Gets the order id
      const { _id: tableOrderId } = orderResponse
      await ctx.db.patch(tableOrderId, { ...args.data })

      // Dispatch webhook: order.updated
      await ctx.scheduler.runAfter(0, internal.webhookDeliveries.dispatchWebhookEvent, {
        eventType: "order.updated",
        businessId: args.data.restaurantId,
        payload: JSON.stringify({ orderId: args.data.orderId, restaurantId: args.data.restaurantId, status: args.data.status }),
      });

      return {
        success: true,
        message: "Order upserted successfully"
      }
    } catch (error) {
      console.log("😵 Error in `upsertOrders`", (error as Error).message)
      return {
        success: false, message: "Something went wrong while upserting the order"
      }
    }
  }
})