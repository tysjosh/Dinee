
import { api } from "../../../../../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { NextRequest } from "next/server";

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  
  if (!id?.trim()) {
    return new Response(JSON.stringify({
      success: false,
      error: "Restaurant ID is required"
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const convexClient = new ConvexHttpClient(convexUrl);
    const convexResponse = await convexClient.query(api.internal.getRestaurantAndMenuDetailsUsingId, { restaurantId: id });
    
    return new Response(JSON.stringify(convexResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: "Failed to fetch restaurant data"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}