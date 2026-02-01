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

interface RecordAcceptanceRequest {
  deliveryId: string;
  accepted: boolean;
}

/**
 * POST /api/v1/record-prompt-acceptance
 * 
 * Records whether a customer accepted or declined an upsell prompt.
 * This endpoint is used by the AI agent after delivering a prompt to track acceptance.
 * 
 * Requirements: 24.6
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

  let body: RecordAcceptanceRequest;
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

  const { deliveryId, accepted } = body;

  if (!deliveryId || typeof accepted !== "boolean") {
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Missing required fields: deliveryId and accepted (boolean) are required" 
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const convexClient = new ConvexHttpClient(convexUrl);
    
    const result = await convexClient.mutation(api.prompts.recordPromptAcceptance, {
      deliveryId,
      accepted,
    });
    
    return new Response(JSON.stringify({
      success: true,
      ...result
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error recording prompt acceptance:", error);
    return new Response(JSON.stringify({
      success: false,
      error: "Failed to record prompt acceptance"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
