import { Doc } from "convex/_generated/dataModel";
import { api } from "../../../../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
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