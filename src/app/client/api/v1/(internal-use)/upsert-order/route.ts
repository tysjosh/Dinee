import { NextRequest } from "next/server";
import { Doc } from "convex/_generated/dataModel";
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

  let body: Doc<"orders">;
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

  const { customerName, items, orderId, restaurantId, status } = body;

  if (!customerName || !items || !orderId || !restaurantId || !status) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Missing required fields: customerName, items, orderId, restaurantId, and status are required" 
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (status !== "completed" && status !== "active" && status !== "cancelled") {
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Invalid status. Status must be `completed`, `active`, or `cancelled`" 
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const convexClient = new ConvexHttpClient(convexUrl);
    const convexResponse = await convexClient.mutation(api.internal.upsertOrders, {
      data: body
    });
    
    return new Response(JSON.stringify(convexResponse), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: "Failed to upsert order data"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}