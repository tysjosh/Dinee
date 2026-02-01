import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Trigger condition type
type TriggerCondition = "order_total_below" | "item_category" | "time_of_day" | "customer_history";

// Order context for prompt matching
interface OrderContext {
  orderTotal?: number;
  itemCategories?: string[];
  currentHour?: number; // 0-23
  customerOrderCount?: number;
}

// Generate a unique prompt ID (10-character alphanumeric)
function generatePromptId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "PR"; // Prefix for prompt IDs
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create a new upsell/cross-sell prompt
 * Requirements: 24.1, 24.2
 */
export const createPrompt = mutation({
  args: {
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    triggerCondition: v.union(
      v.literal("order_total_below"),
      v.literal("item_category"),
      v.literal("time_of_day"),
      v.literal("customer_history")
    ),
    triggerValue: v.string(),
    promptText: v.string(),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Generate unique prompt ID
    let promptId: string;
    let existingPrompt;

    do {
      promptId = generatePromptId();
      existingPrompt = await ctx.db
        .query("prompts")
        .withIndex("by_prompt_id", (q) => q.eq("promptId", promptId))
        .first();
    } while (existingPrompt);

    const isActive = args.isActive ?? true;

    const docId = await ctx.db.insert("prompts", {
      promptId,
      restaurantId: args.restaurantId,
      branchId: args.branchId,
      triggerCondition: args.triggerCondition,
      triggerValue: args.triggerValue,
      promptText: args.promptText,
      isActive,
      createdAt: Date.now(),
    });

    return { promptId, docId };
  },
});

/**
 * Get a prompt by promptId
 */
export const getPrompt = query({
  args: { promptId: v.string() },
  handler: async (ctx, args) => {
    const prompt = await ctx.db
      .query("prompts")
      .withIndex("by_prompt_id", (q) => q.eq("promptId", args.promptId))
      .first();

    return prompt;
  },
});

/**
 * Get all prompts for a specific restaurant
 */
export const getPromptsByRestaurant = query({
  args: { restaurantId: v.string() },
  handler: async (ctx, args) => {
    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    return prompts;
  },
});

/**
 * Get all prompts for a specific branch
 */
export const getPromptsByBranch = query({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .collect();

    return prompts;
  },
});

/**
 * Get all active prompts for a restaurant (including branch-specific)
 */
export const getActivePrompts = query({
  args: { 
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get restaurant-level active prompts
    const restaurantPrompts = await ctx.db
      .query("prompts")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // Filter to include:
    // 1. Restaurant-wide prompts (no branchId)
    // 2. Branch-specific prompts if branchId is provided
    const activePrompts = restaurantPrompts.filter((prompt) => {
      // Include restaurant-wide prompts (no branchId)
      if (!prompt.branchId) {
        return true;
      }
      // Include branch-specific prompts only if they match the requested branch
      if (args.branchId && prompt.branchId === args.branchId) {
        return true;
      }
      return false;
    });

    return activePrompts;
  },
});

/**
 * Update a prompt
 */
export const updatePrompt = mutation({
  args: {
    promptId: v.string(),
    triggerCondition: v.optional(v.union(
      v.literal("order_total_below"),
      v.literal("item_category"),
      v.literal("time_of_day"),
      v.literal("customer_history")
    )),
    triggerValue: v.optional(v.string()),
    promptText: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const prompt = await ctx.db
      .query("prompts")
      .withIndex("by_prompt_id", (q) => q.eq("promptId", args.promptId))
      .first();

    if (!prompt) {
      throw new Error("Prompt not found");
    }

    // Build updates object with only provided fields
    const updates: {
      triggerCondition?: TriggerCondition;
      triggerValue?: string;
      promptText?: string;
      isActive?: boolean;
    } = {};

    if (args.triggerCondition !== undefined) {
      updates.triggerCondition = args.triggerCondition;
    }
    if (args.triggerValue !== undefined) {
      updates.triggerValue = args.triggerValue;
    }
    if (args.promptText !== undefined) {
      updates.promptText = args.promptText;
    }
    if (args.isActive !== undefined) {
      updates.isActive = args.isActive;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(prompt._id, updates);
    }

    return prompt._id;
  },
});

/**
 * Activate a prompt
 */
export const activatePrompt = mutation({
  args: { promptId: v.string() },
  handler: async (ctx, args) => {
    const prompt = await ctx.db
      .query("prompts")
      .withIndex("by_prompt_id", (q) => q.eq("promptId", args.promptId))
      .first();

    if (!prompt) {
      throw new Error("Prompt not found");
    }

    await ctx.db.patch(prompt._id, { isActive: true });

    return prompt._id;
  },
});

/**
 * Deactivate a prompt
 */
export const deactivatePrompt = mutation({
  args: { promptId: v.string() },
  handler: async (ctx, args) => {
    const prompt = await ctx.db
      .query("prompts")
      .withIndex("by_prompt_id", (q) => q.eq("promptId", args.promptId))
      .first();

    if (!prompt) {
      throw new Error("Prompt not found");
    }

    await ctx.db.patch(prompt._id, { isActive: false });

    return prompt._id;
  },
});

/**
 * Delete a prompt
 */
export const deletePrompt = mutation({
  args: { promptId: v.string() },
  handler: async (ctx, args) => {
    const prompt = await ctx.db
      .query("prompts")
      .withIndex("by_prompt_id", (q) => q.eq("promptId", args.promptId))
      .first();

    if (!prompt) {
      throw new Error("Prompt not found");
    }

    await ctx.db.delete(prompt._id);

    return { success: true, promptId: args.promptId };
  },
});

/**
 * Match prompts based on order context
 * Returns all active prompts that match the given order context
 * Requirements: 24.2, 24.3
 * 
 * Trigger conditions:
 * - order_total_below: triggerValue is the threshold amount (e.g., "5000" for ₦5000)
 * - item_category: triggerValue is a comma-separated list of categories (e.g., "drinks,desserts")
 * - time_of_day: triggerValue is a time range in format "HH-HH" (e.g., "12-14" for lunch)
 * - customer_history: triggerValue is the minimum order count (e.g., "5" for returning customers)
 */
export const matchPrompts = query({
  args: {
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    orderTotal: v.optional(v.number()),
    itemCategories: v.optional(v.array(v.string())),
    currentHour: v.optional(v.number()),
    customerOrderCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get all active prompts for the restaurant/branch
    const restaurantPrompts = await ctx.db
      .query("prompts")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // Filter to include restaurant-wide and branch-specific prompts
    const activePrompts = restaurantPrompts.filter((prompt) => {
      if (!prompt.branchId) {
        return true;
      }
      if (args.branchId && prompt.branchId === args.branchId) {
        return true;
      }
      return false;
    });

    // Build order context
    const orderContext: OrderContext = {
      orderTotal: args.orderTotal,
      itemCategories: args.itemCategories,
      currentHour: args.currentHour,
      customerOrderCount: args.customerOrderCount,
    };

    // Filter prompts that match the order context
    const matchingPrompts = activePrompts.filter((prompt) => {
      return evaluateTriggerCondition(
        prompt.triggerCondition,
        prompt.triggerValue,
        orderContext
      );
    });

    return matchingPrompts;
  },
});

/**
 * Evaluate if a trigger condition is met based on order context
 * This is a pure function for prompt matching logic
 */
function evaluateTriggerCondition(
  triggerCondition: TriggerCondition,
  triggerValue: string,
  orderContext: OrderContext
): boolean {
  switch (triggerCondition) {
    case "order_total_below": {
      // triggerValue is the threshold amount (e.g., "5000")
      if (orderContext.orderTotal === undefined) {
        return false;
      }
      const threshold = parseFloat(triggerValue);
      if (isNaN(threshold)) {
        return false;
      }
      return orderContext.orderTotal < threshold;
    }

    case "item_category": {
      // triggerValue is comma-separated categories (e.g., "drinks,desserts")
      if (!orderContext.itemCategories || orderContext.itemCategories.length === 0) {
        return false;
      }
      const triggerCategories = triggerValue
        .toLowerCase()
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      
      if (triggerCategories.length === 0) {
        return false;
      }

      // Check if any order item category matches any trigger category
      const orderCategoriesLower = orderContext.itemCategories.map((c) => c.toLowerCase());
      return triggerCategories.some((tc) => orderCategoriesLower.includes(tc));
    }

    case "time_of_day": {
      // triggerValue is time range in format "HH-HH" (e.g., "12-14")
      if (orderContext.currentHour === undefined) {
        return false;
      }
      const timeRange = triggerValue.split("-");
      if (timeRange.length !== 2) {
        return false;
      }
      const startHour = parseInt(timeRange[0], 10);
      const endHour = parseInt(timeRange[1], 10);
      if (isNaN(startHour) || isNaN(endHour)) {
        return false;
      }
      
      // Handle time ranges that wrap around midnight
      if (startHour <= endHour) {
        // Normal range (e.g., 12-14)
        return orderContext.currentHour >= startHour && orderContext.currentHour < endHour;
      } else {
        // Wrap-around range (e.g., 22-6 for late night)
        return orderContext.currentHour >= startHour || orderContext.currentHour < endHour;
      }
    }

    case "customer_history": {
      // triggerValue is minimum order count (e.g., "5")
      if (orderContext.customerOrderCount === undefined) {
        return false;
      }
      const minOrderCount = parseInt(triggerValue, 10);
      if (isNaN(minOrderCount)) {
        return false;
      }
      return orderContext.customerOrderCount >= minOrderCount;
    }

    default:
      return false;
  }
}

/**
 * Count prompts for a restaurant
 */
export const countPromptsByRestaurant = query({
  args: { restaurantId: v.string() },
  handler: async (ctx, args) => {
    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    return {
      total: prompts.length,
      active: prompts.filter((p) => p.isActive).length,
      inactive: prompts.filter((p) => !p.isActive).length,
    };
  },
});

/**
 * Get prompts by trigger condition for a restaurant
 */
export const getPromptsByTriggerCondition = query({
  args: {
    restaurantId: v.string(),
    triggerCondition: v.union(
      v.literal("order_total_below"),
      v.literal("item_category"),
      v.literal("time_of_day"),
      v.literal("customer_history")
    ),
  },
  handler: async (ctx, args) => {
    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .filter((q) => q.eq(q.field("triggerCondition"), args.triggerCondition))
      .collect();

    return prompts;
  },
});


// ============================================================================
// Prompt Delivery Tracking
// Requirements: 24.3, 24.6
// ============================================================================

// Generate a unique delivery ID (12-character alphanumeric)
function generateDeliveryId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "PD"; // Prefix for prompt delivery IDs
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Record a prompt delivery to track when prompts are delivered to customers
 * Requirements: 24.3, 24.6
 */
export const recordPromptDelivery = mutation({
  args: {
    promptId: v.string(),
    orderId: v.string(),
    callId: v.optional(v.string()),
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    triggerCondition: v.string(),
    triggerValue: v.string(),
    orderContext: v.object({
      orderTotal: v.optional(v.number()),
      itemCategories: v.optional(v.array(v.string())),
      currentHour: v.optional(v.number()),
      customerOrderCount: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    // Generate unique delivery ID
    let deliveryId: string;
    let existingDelivery;

    do {
      deliveryId = generateDeliveryId();
      existingDelivery = await ctx.db
        .query("promptDeliveries")
        .withIndex("by_delivery_id", (q) => q.eq("deliveryId", deliveryId))
        .first();
    } while (existingDelivery);

    const docId = await ctx.db.insert("promptDeliveries", {
      deliveryId,
      promptId: args.promptId,
      orderId: args.orderId,
      callId: args.callId,
      restaurantId: args.restaurantId,
      branchId: args.branchId,
      delivered: true,
      deliveredAt: Date.now(),
      triggerCondition: args.triggerCondition,
      triggerValue: args.triggerValue,
      orderContext: args.orderContext,
    });

    return { deliveryId, docId };
  },
});

/**
 * Record prompt acceptance when customer accepts an upsell suggestion
 * Requirements: 24.6
 */
export const recordPromptAcceptance = mutation({
  args: {
    deliveryId: v.string(),
    accepted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db
      .query("promptDeliveries")
      .withIndex("by_delivery_id", (q) => q.eq("deliveryId", args.deliveryId))
      .first();

    if (!delivery) {
      throw new Error("Prompt delivery not found");
    }

    await ctx.db.patch(delivery._id, {
      accepted: args.accepted,
      acceptedAt: Date.now(),
    });

    return { success: true, deliveryId: args.deliveryId };
  },
});

/**
 * Get prompt delivery statistics for a restaurant
 * Requirements: 24.6
 */
export const getPromptDeliveryStats = query({
  args: {
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let deliveries = await ctx.db
      .query("promptDeliveries")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    // Filter by branch if specified
    if (args.branchId) {
      deliveries = deliveries.filter((d) => d.branchId === args.branchId);
    }

    // Filter by date range if specified
    if (args.startDate) {
      deliveries = deliveries.filter((d) => d.deliveredAt >= args.startDate!);
    }
    if (args.endDate) {
      deliveries = deliveries.filter((d) => d.deliveredAt <= args.endDate!);
    }

    const totalDelivered = deliveries.length;
    const totalAccepted = deliveries.filter((d) => d.accepted === true).length;
    const totalDeclined = deliveries.filter((d) => d.accepted === false).length;
    const pendingResponse = deliveries.filter((d) => d.accepted === undefined).length;

    const acceptanceRate = totalDelivered > 0 
      ? (totalAccepted / totalDelivered) * 100 
      : 0;

    // Group by prompt for per-prompt stats
    const promptStats: Record<string, { delivered: number; accepted: number; declined: number }> = {};
    for (const delivery of deliveries) {
      if (!promptStats[delivery.promptId]) {
        promptStats[delivery.promptId] = { delivered: 0, accepted: 0, declined: 0 };
      }
      promptStats[delivery.promptId].delivered++;
      if (delivery.accepted === true) {
        promptStats[delivery.promptId].accepted++;
      } else if (delivery.accepted === false) {
        promptStats[delivery.promptId].declined++;
      }
    }

    return {
      totalDelivered,
      totalAccepted,
      totalDeclined,
      pendingResponse,
      acceptanceRate: Math.round(acceptanceRate * 100) / 100,
      promptStats,
    };
  },
});

/**
 * Get deliveries for a specific order
 */
export const getDeliveriesByOrder = query({
  args: { orderId: v.string() },
  handler: async (ctx, args) => {
    const deliveries = await ctx.db
      .query("promptDeliveries")
      .withIndex("by_order_id", (q) => q.eq("orderId", args.orderId))
      .collect();

    return deliveries;
  },
});

/**
 * Get deliveries for a specific call
 */
export const getDeliveriesByCall = query({
  args: { callId: v.string() },
  handler: async (ctx, args) => {
    const deliveries = await ctx.db
      .query("promptDeliveries")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .collect();

    return deliveries;
  },
});

/**
 * Match prompts and record deliveries in one operation
 * This is the main function the AI agent should use
 * Requirements: 24.3, 24.6
 */
export const matchAndDeliverPrompts = mutation({
  args: {
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    orderId: v.string(),
    callId: v.optional(v.string()),
    orderTotal: v.optional(v.number()),
    itemCategories: v.optional(v.array(v.string())),
    currentHour: v.optional(v.number()),
    customerOrderCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get all active prompts for the restaurant/branch
    const restaurantPrompts = await ctx.db
      .query("prompts")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // Filter to include restaurant-wide and branch-specific prompts
    const activePrompts = restaurantPrompts.filter((prompt) => {
      if (!prompt.branchId) {
        return true;
      }
      if (args.branchId && prompt.branchId === args.branchId) {
        return true;
      }
      return false;
    });

    // Build order context
    const orderContext = {
      orderTotal: args.orderTotal,
      itemCategories: args.itemCategories,
      currentHour: args.currentHour,
      customerOrderCount: args.customerOrderCount,
    };

    // Filter prompts that match the order context
    const matchingPrompts = activePrompts.filter((prompt) => {
      return evaluateTriggerConditionInternal(
        prompt.triggerCondition,
        prompt.triggerValue,
        orderContext
      );
    });

    // Record deliveries for all matching prompts
    const deliveries = [];
    for (const prompt of matchingPrompts) {
      // Generate unique delivery ID
      let deliveryId: string;
      let existingDelivery;

      do {
        deliveryId = generateDeliveryId();
        existingDelivery = await ctx.db
          .query("promptDeliveries")
          .withIndex("by_delivery_id", (q) => q.eq("deliveryId", deliveryId))
          .first();
      } while (existingDelivery);

      await ctx.db.insert("promptDeliveries", {
        deliveryId,
        promptId: prompt.promptId,
        orderId: args.orderId,
        callId: args.callId,
        restaurantId: args.restaurantId,
        branchId: args.branchId,
        delivered: true,
        deliveredAt: Date.now(),
        triggerCondition: prompt.triggerCondition,
        triggerValue: prompt.triggerValue,
        orderContext,
      });

      deliveries.push({
        deliveryId,
        promptId: prompt.promptId,
        promptText: prompt.promptText,
        triggerCondition: prompt.triggerCondition,
      });
    }

    return {
      matchedCount: matchingPrompts.length,
      prompts: matchingPrompts.map((p) => ({
        promptId: p.promptId,
        promptText: p.promptText,
        triggerCondition: p.triggerCondition,
        triggerValue: p.triggerValue,
      })),
      deliveries,
    };
  },
});

/**
 * Internal helper function for evaluating trigger conditions
 * Duplicated here to avoid circular dependencies in mutations
 */
function evaluateTriggerConditionInternal(
  triggerCondition: TriggerCondition,
  triggerValue: string,
  orderContext: OrderContext
): boolean {
  switch (triggerCondition) {
    case "order_total_below": {
      if (orderContext.orderTotal === undefined) {
        return false;
      }
      const threshold = parseFloat(triggerValue);
      if (isNaN(threshold)) {
        return false;
      }
      return orderContext.orderTotal < threshold;
    }

    case "item_category": {
      if (!orderContext.itemCategories || orderContext.itemCategories.length === 0) {
        return false;
      }
      const triggerCategories = triggerValue
        .toLowerCase()
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      
      if (triggerCategories.length === 0) {
        return false;
      }

      const orderCategoriesLower = orderContext.itemCategories.map((c) => c.toLowerCase());
      return triggerCategories.some((tc) => orderCategoriesLower.includes(tc));
    }

    case "time_of_day": {
      if (orderContext.currentHour === undefined) {
        return false;
      }
      const timeRange = triggerValue.split("-");
      if (timeRange.length !== 2) {
        return false;
      }
      const startHour = parseInt(timeRange[0], 10);
      const endHour = parseInt(timeRange[1], 10);
      if (isNaN(startHour) || isNaN(endHour)) {
        return false;
      }
      
      if (startHour <= endHour) {
        return orderContext.currentHour >= startHour && orderContext.currentHour < endHour;
      } else {
        return orderContext.currentHour >= startHour || orderContext.currentHour < endHour;
      }
    }

    case "customer_history": {
      if (orderContext.customerOrderCount === undefined) {
        return false;
      }
      const minOrderCount = parseInt(triggerValue, 10);
      if (isNaN(minOrderCount)) {
        return false;
      }
      return orderContext.customerOrderCount >= minOrderCount;
    }

    default:
      return false;
  }
}


// ============================================================================
// Upsell Analytics
// Requirements: 24.7, 24.8
// ============================================================================

/**
 * Get comprehensive prompt analytics for a restaurant
 * Includes delivery/acceptance rates per prompt for A/B testing
 * Requirements: 24.7, 24.8
 */
export const getPromptAnalytics = query({
  args: {
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get all prompts for the restaurant
    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    // Filter by branch if specified
    const filteredPrompts = args.branchId
      ? prompts.filter((p) => !p.branchId || p.branchId === args.branchId)
      : prompts;

    // Get all deliveries for the restaurant
    let deliveries = await ctx.db
      .query("promptDeliveries")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    // Filter by branch if specified
    if (args.branchId) {
      deliveries = deliveries.filter((d) => d.branchId === args.branchId);
    }

    // Filter by date range if specified
    if (args.startDate) {
      deliveries = deliveries.filter((d) => d.deliveredAt >= args.startDate!);
    }
    if (args.endDate) {
      deliveries = deliveries.filter((d) => d.deliveredAt <= args.endDate!);
    }

    // Calculate per-prompt analytics
    const promptAnalytics = filteredPrompts.map((prompt) => {
      const promptDeliveries = deliveries.filter((d) => d.promptId === prompt.promptId);
      const delivered = promptDeliveries.length;
      const accepted = promptDeliveries.filter((d) => d.accepted === true).length;
      const declined = promptDeliveries.filter((d) => d.accepted === false).length;
      const pending = promptDeliveries.filter((d) => d.accepted === undefined).length;
      
      const acceptanceRate = delivered > 0 ? (accepted / delivered) * 100 : 0;
      const declineRate = delivered > 0 ? (declined / delivered) * 100 : 0;

      return {
        promptId: prompt.promptId,
        promptText: prompt.promptText,
        triggerCondition: prompt.triggerCondition,
        triggerValue: prompt.triggerValue,
        isActive: prompt.isActive,
        branchId: prompt.branchId,
        metrics: {
          delivered,
          accepted,
          declined,
          pending,
          acceptanceRate: Math.round(acceptanceRate * 100) / 100,
          declineRate: Math.round(declineRate * 100) / 100,
        },
      };
    });

    // Calculate overall metrics
    const totalDelivered = deliveries.length;
    const totalAccepted = deliveries.filter((d) => d.accepted === true).length;
    const totalDeclined = deliveries.filter((d) => d.accepted === false).length;
    const overallAcceptanceRate = totalDelivered > 0 
      ? (totalAccepted / totalDelivered) * 100 
      : 0;

    // Group by trigger condition for breakdown
    const byTriggerCondition: Record<string, { delivered: number; accepted: number; declined: number; acceptanceRate: number }> = {};
    for (const delivery of deliveries) {
      const condition = delivery.triggerCondition;
      if (!byTriggerCondition[condition]) {
        byTriggerCondition[condition] = { delivered: 0, accepted: 0, declined: 0, acceptanceRate: 0 };
      }
      byTriggerCondition[condition].delivered++;
      if (delivery.accepted === true) {
        byTriggerCondition[condition].accepted++;
      } else if (delivery.accepted === false) {
        byTriggerCondition[condition].declined++;
      }
    }

    // Calculate acceptance rates for each trigger condition
    for (const condition of Object.keys(byTriggerCondition)) {
      const stats = byTriggerCondition[condition];
      stats.acceptanceRate = stats.delivered > 0 
        ? Math.round((stats.accepted / stats.delivered) * 100 * 100) / 100 
        : 0;
    }

    return {
      summary: {
        totalPrompts: filteredPrompts.length,
        activePrompts: filteredPrompts.filter((p) => p.isActive).length,
        totalDelivered,
        totalAccepted,
        totalDeclined,
        overallAcceptanceRate: Math.round(overallAcceptanceRate * 100) / 100,
      },
      promptAnalytics,
      byTriggerCondition,
    };
  },
});

/**
 * Get upsell revenue attribution for a restaurant
 * Calculates revenue from orders where upsell prompts were accepted
 * Requirements: 24.7
 */
export const getUpsellRevenueAttribution = query({
  args: {
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get all deliveries for the restaurant
    let deliveries = await ctx.db
      .query("promptDeliveries")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    // Filter by branch if specified
    if (args.branchId) {
      deliveries = deliveries.filter((d) => d.branchId === args.branchId);
    }

    // Filter by date range if specified
    if (args.startDate) {
      deliveries = deliveries.filter((d) => d.deliveredAt >= args.startDate!);
    }
    if (args.endDate) {
      deliveries = deliveries.filter((d) => d.deliveredAt <= args.endDate!);
    }

    // Get accepted deliveries
    const acceptedDeliveries = deliveries.filter((d) => d.accepted === true);

    // Get unique order IDs from accepted deliveries
    const acceptedOrderIds = [...new Set(acceptedDeliveries.map((d) => d.orderId))];

    // Get orders for revenue calculation
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    // Filter orders that had accepted upsells
    const ordersWithAcceptedUpsells = orders.filter((o) => acceptedOrderIds.includes(o.orderId));

    // Calculate total revenue from orders with accepted upsells
    const upsellRevenue = ordersWithAcceptedUpsells.reduce((sum, order) => {
      return sum + (order.totalAmount || 0);
    }, 0);

    // Calculate total revenue from all orders in the period
    let allOrdersInPeriod = orders;
    if (args.startDate) {
      allOrdersInPeriod = allOrdersInPeriod.filter((o) => 
        o.orderPlacementTime && o.orderPlacementTime >= args.startDate!
      );
    }
    if (args.endDate) {
      allOrdersInPeriod = allOrdersInPeriod.filter((o) => 
        o.orderPlacementTime && o.orderPlacementTime <= args.endDate!
      );
    }

    const totalRevenue = allOrdersInPeriod.reduce((sum, order) => {
      return sum + (order.totalAmount || 0);
    }, 0);

    // Calculate average order value for orders with and without upsells
    const avgOrderValueWithUpsell = ordersWithAcceptedUpsells.length > 0
      ? upsellRevenue / ordersWithAcceptedUpsells.length
      : 0;

    const ordersWithoutUpsells = allOrdersInPeriod.filter(
      (o) => !acceptedOrderIds.includes(o.orderId)
    );
    const revenueWithoutUpsells = ordersWithoutUpsells.reduce((sum, order) => {
      return sum + (order.totalAmount || 0);
    }, 0);
    const avgOrderValueWithoutUpsell = ordersWithoutUpsells.length > 0
      ? revenueWithoutUpsells / ordersWithoutUpsells.length
      : 0;

    // Calculate upsell impact (difference in average order value)
    const upsellImpact = avgOrderValueWithUpsell - avgOrderValueWithoutUpsell;
    const upsellImpactPercentage = avgOrderValueWithoutUpsell > 0
      ? (upsellImpact / avgOrderValueWithoutUpsell) * 100
      : 0;

    // Revenue attribution by prompt
    const revenueByPrompt: Record<string, { 
      promptId: string; 
      acceptedCount: number; 
      totalRevenue: number; 
      avgOrderValue: number;
    }> = {};

    for (const delivery of acceptedDeliveries) {
      const order = orders.find((o) => o.orderId === delivery.orderId);
      if (!order) continue;

      if (!revenueByPrompt[delivery.promptId]) {
        revenueByPrompt[delivery.promptId] = {
          promptId: delivery.promptId,
          acceptedCount: 0,
          totalRevenue: 0,
          avgOrderValue: 0,
        };
      }
      revenueByPrompt[delivery.promptId].acceptedCount++;
      revenueByPrompt[delivery.promptId].totalRevenue += order.totalAmount || 0;
    }

    // Calculate average order value per prompt
    for (const promptId of Object.keys(revenueByPrompt)) {
      const stats = revenueByPrompt[promptId];
      stats.avgOrderValue = stats.acceptedCount > 0
        ? Math.round((stats.totalRevenue / stats.acceptedCount) * 100) / 100
        : 0;
      stats.totalRevenue = Math.round(stats.totalRevenue * 100) / 100;
    }

    // Revenue attribution by trigger condition
    const revenueByTrigger: Record<string, {
      triggerCondition: string;
      acceptedCount: number;
      totalRevenue: number;
      avgOrderValue: number;
    }> = {};

    for (const delivery of acceptedDeliveries) {
      const order = orders.find((o) => o.orderId === delivery.orderId);
      if (!order) continue;

      const condition = delivery.triggerCondition;
      if (!revenueByTrigger[condition]) {
        revenueByTrigger[condition] = {
          triggerCondition: condition,
          acceptedCount: 0,
          totalRevenue: 0,
          avgOrderValue: 0,
        };
      }
      revenueByTrigger[condition].acceptedCount++;
      revenueByTrigger[condition].totalRevenue += order.totalAmount || 0;
    }

    // Calculate average order value per trigger condition
    for (const condition of Object.keys(revenueByTrigger)) {
      const stats = revenueByTrigger[condition];
      stats.avgOrderValue = stats.acceptedCount > 0
        ? Math.round((stats.totalRevenue / stats.acceptedCount) * 100) / 100
        : 0;
      stats.totalRevenue = Math.round(stats.totalRevenue * 100) / 100;
    }

    return {
      summary: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        upsellRevenue: Math.round(upsellRevenue * 100) / 100,
        upsellRevenuePercentage: totalRevenue > 0 
          ? Math.round((upsellRevenue / totalRevenue) * 100 * 100) / 100 
          : 0,
        ordersWithUpsells: ordersWithAcceptedUpsells.length,
        totalOrders: allOrdersInPeriod.length,
        avgOrderValueWithUpsell: Math.round(avgOrderValueWithUpsell * 100) / 100,
        avgOrderValueWithoutUpsell: Math.round(avgOrderValueWithoutUpsell * 100) / 100,
        upsellImpact: Math.round(upsellImpact * 100) / 100,
        upsellImpactPercentage: Math.round(upsellImpactPercentage * 100) / 100,
      },
      revenueByPrompt: Object.values(revenueByPrompt),
      revenueByTrigger: Object.values(revenueByTrigger),
    };
  },
});

/**
 * Get A/B testing comparison data for prompt variations
 * Compares performance of prompts with similar trigger conditions
 * Requirements: 24.8
 */
export const getPromptABTestComparison = query({
  args: {
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    triggerCondition: v.optional(v.union(
      v.literal("order_total_below"),
      v.literal("item_category"),
      v.literal("time_of_day"),
      v.literal("customer_history")
    )),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get all prompts for the restaurant
    let prompts = await ctx.db
      .query("prompts")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    // Filter by branch if specified
    if (args.branchId) {
      prompts = prompts.filter((p) => !p.branchId || p.branchId === args.branchId);
    }

    // Filter by trigger condition if specified
    if (args.triggerCondition) {
      prompts = prompts.filter((p) => p.triggerCondition === args.triggerCondition);
    }

    // Get all deliveries for the restaurant
    let deliveries = await ctx.db
      .query("promptDeliveries")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    // Filter by branch if specified
    if (args.branchId) {
      deliveries = deliveries.filter((d) => d.branchId === args.branchId);
    }

    // Filter by date range if specified
    if (args.startDate) {
      deliveries = deliveries.filter((d) => d.deliveredAt >= args.startDate!);
    }
    if (args.endDate) {
      deliveries = deliveries.filter((d) => d.deliveredAt <= args.endDate!);
    }

    // Get orders for revenue calculation
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .collect();

    // Build comparison data for each prompt
    const comparisons = prompts.map((prompt) => {
      const promptDeliveries = deliveries.filter((d) => d.promptId === prompt.promptId);
      const delivered = promptDeliveries.length;
      const accepted = promptDeliveries.filter((d) => d.accepted === true).length;
      const declined = promptDeliveries.filter((d) => d.accepted === false).length;
      
      const acceptanceRate = delivered > 0 ? (accepted / delivered) * 100 : 0;

      // Calculate revenue for accepted deliveries
      const acceptedOrderIds = promptDeliveries
        .filter((d) => d.accepted === true)
        .map((d) => d.orderId);
      
      const acceptedOrders = orders.filter((o) => acceptedOrderIds.includes(o.orderId));
      const totalRevenue = acceptedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      const avgOrderValue = acceptedOrders.length > 0 
        ? totalRevenue / acceptedOrders.length 
        : 0;

      // Calculate statistical significance indicator (simplified)
      // Using a basic threshold: need at least 30 deliveries for meaningful comparison
      const isStatisticallySignificant = delivered >= 30;

      return {
        promptId: prompt.promptId,
        promptText: prompt.promptText,
        triggerCondition: prompt.triggerCondition,
        triggerValue: prompt.triggerValue,
        isActive: prompt.isActive,
        metrics: {
          delivered,
          accepted,
          declined,
          acceptanceRate: Math.round(acceptanceRate * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        },
        isStatisticallySignificant,
      };
    });

    // Sort by acceptance rate (descending) for easy comparison
    comparisons.sort((a, b) => b.metrics.acceptanceRate - a.metrics.acceptanceRate);

    // Identify the best performing prompt
    const bestPerformer = comparisons.length > 0 && comparisons[0].metrics.delivered > 0
      ? comparisons[0]
      : null;

    // Group comparisons by trigger condition for easier analysis
    const byTriggerCondition: Record<string, typeof comparisons> = {};
    for (const comparison of comparisons) {
      const condition = comparison.triggerCondition;
      if (!byTriggerCondition[condition]) {
        byTriggerCondition[condition] = [];
      }
      byTriggerCondition[condition].push(comparison);
    }

    return {
      comparisons,
      bestPerformer,
      byTriggerCondition,
      totalPrompts: prompts.length,
      totalDeliveries: deliveries.length,
    };
  },
});
