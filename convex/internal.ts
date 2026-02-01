/**
 * Utilites are used by the AI to perform tasks.
 * */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Doc } from "./_generated/dataModel";


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
        return {
          success: true,
          message: "Data upserts successfully"
        }
      }

      // Update the existing call data
      const { _id: tableCallId } = callDataResponse
      await ctx.db.patch(tableCallId, args.data)
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
        .withIndex("by_order_and_restaurant_id", (q) => q.eq("orderId", orderId))
        .unique()

      if (!orderResponse) {
        await ctx.db.insert("orders", { ...args.data, orderPlacementTime: Date.now() })
        return {
          success: true,
          message: "Order upserted successfully"
        }
      }
      // Gets the order id
      const { _id: tableOrderId } = orderResponse
      await ctx.db.patch(tableOrderId, { ...args.data })
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