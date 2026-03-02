
import { api } from "../../../../../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { validateInternalApiKey } from "@/lib/internal-auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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