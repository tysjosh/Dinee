import { NextRequest, NextResponse } from "next/server";
import { Doc } from "convex/_generated/dataModel";
import { api } from "../../../../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { validateInternalApiKey } from "@/lib/internal-auth";

export async function POST(request: NextRequest) {
  // Validate API key for internal routes
  const authResult = validateInternalApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json(
      { error: authResult.error },
      { status: authResult.statusCode }
    );
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

  if (status !== "completed" && status !== "active" && status !== "cancelled" && status !== "preparing" && status !== "ready") {
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Invalid status. Status must be `active`, `preparing`, `ready`, `completed`, or `cancelled`" 
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