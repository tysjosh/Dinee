import { NextRequest } from "next/server";
import { api } from "../../../../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

// Simple API key validation for internal routes
function validateApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get("x-api-key");
  const expectedKey = process.env.INTERNAL_API_KEY;
  
  // If no API key is configured, allow requests (development mode)
  if (!expectedKey) {
    return true;
  }
  
  return apiKey === expectedKey;
}

interface MatchPromptsRequest {
  restaurantId: string;
  branchId?: string;
  orderId: string;
  callId?: string;
  orderTotal?: number;
  itemCategories?: string[];
  currentHour?: number;
  customerOrderCount?: number;
}

/**
 * POST /api/v1/match-prompts
 * 
 * Matches upsell/cross-sell prompts based on order context and records deliveries.
 * This endpoint is used by the AI agent during order building to get relevant upsell suggestions.
 * 
 * Requirements: 24.3, 24.6
 */
export async function POST(request: NextRequest) {
  // Validate API key for internal routes
  if (!validateApiKey(request)) {
    return new Response(JSON.stringify({
      success: false,
      error: "Unauthorized"
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return new Response(JSON.stringify({
      success: false,
      error: "Server configuration error"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  let body: MatchPromptsRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({
      success: false,
      error: "Invalid JSON body"
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { restaurantId, orderId } = body;

  if (!restaurantId || !orderId) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Missing required fields: restaurantId and orderId are required" 
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const convexClient = new ConvexHttpClient(convexUrl);
    
    // Use matchAndDeliverPrompts to both match prompts and record deliveries
    const result = await convexClient.mutation(api.prompts.matchAndDeliverPrompts, {
      restaurantId: body.restaurantId,
      branchId: body.branchId,
      orderId: body.orderId,
      callId: body.callId,
      orderTotal: body.orderTotal,
      itemCategories: body.itemCategories,
      currentHour: body.currentHour ?? new Date().getHours(),
      customerOrderCount: body.customerOrderCount,
    });
    
    return new Response(JSON.stringify({
      success: true,
      ...result
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error matching prompts:", error);
    return new Response(JSON.stringify({
      success: false,
      error: "Failed to match prompts"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
