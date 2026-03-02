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

  let body: Doc<"calls">;
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

  const { callId, status } = body;

  // Validate the request body
  if (!callId?.trim()) {
    return new Response(JSON.stringify({
      success: false,
      error: "`callId` is a required field."
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Validate the status value
  if (status?.trim() && status !== "completed" && status !== "active") {
    return new Response(JSON.stringify({
      success: false,
      error: "`status` must be either `completed` or `active`."
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const convexClient = new ConvexHttpClient(convexUrl);
    const convexResponse = await convexClient.mutation(api.internal.upsertCallData, { data: body });
    
    return new Response(JSON.stringify(convexResponse), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: "Failed to upsert call data"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}