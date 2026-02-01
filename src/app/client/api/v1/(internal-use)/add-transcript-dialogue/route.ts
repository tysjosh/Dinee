import { Doc } from "convex/_generated/dataModel";
import { api } from "../../../../../../../convex/_generated/api";
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

  let body: Doc<"transcripts">;
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

  const { callId, dialogue, speaker } = body;

  // Validate the request body
  if (!callId?.trim() || !dialogue?.trim() || !speaker?.trim()) {
    return new Response(JSON.stringify({
      success: false,
      error: "`callId`, `dialogue`, and `speaker` are required fields."
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Validate the speaker
  if (speaker !== "ai" && speaker !== "human") {
    return new Response(JSON.stringify({
      success: false,
      error: "Invalid `speaker` field. Must be either `ai` or `human`"
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const convexClient = new ConvexHttpClient(convexUrl);
    const convexResponse = await convexClient.mutation(api.internal.addTranscript, { data: body });
    
    return new Response(JSON.stringify(convexResponse), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: "Failed to add transcript dialogue"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}