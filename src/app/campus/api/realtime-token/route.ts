/**
 * Campus Realtime Token API Route (dinee-campus — browser voice transport).
 *
 * Mints a SHORT-LIVED OpenAI Realtime "client secret" (ephemeral token) so the
 * browser can open a WebRTC voice session directly with OpenAI WITHOUT ever
 * seeing the platform's real API key (the key stays server-side here). The
 * ephemeral session is pre-configured with the Campus_Agent's selected voice
 * and assembled system prompt, so the model speaks in the agent's voice and
 * answers only from the agent's knowledge (Req 8.3, 8.4).
 *
 * Authorization model: the request carries the server-minted `callId` from
 * `campus.session.startBrowserCall`, which is a high-entropy capability only
 * handed to a Caller who already cleared the access + usage gates. The route
 * resolves the call-scoped realtime config via `getCallRealtimeConfig` (which
 * returns nothing for an unknown/ended/non-campus call), so a token is minted
 * only for a genuinely active call the Caller is authorized to be on.
 *
 * @module app/campus/api/realtime-token
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { createLogger } from "@/lib/logger";
import { buildRealtimeSessionConfig } from "../../../../../convex/campus/logic/realtime";

export const runtime = "nodejs";

const logger = createLogger("campus-realtime-token");

/** The OpenAI Realtime model used for browser voice sessions (overridable). */
const REALTIME_MODEL = process.env.CAMPUS_REALTIME_MODEL ?? "gpt-realtime";

/** OpenAI REST endpoint that mints an ephemeral Realtime client secret. */
const CLIENT_SECRETS_ENDPOINT =
  "https://api.openai.com/v1/realtime/client_secrets";

interface TokenRequestBody {
  callId?: unknown;
}

function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    logger.error("NEXT_PUBLIC_CONVEX_URL is not set");
    return null;
  }
  return new ConvexHttpClient(convexUrl);
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.NEXT_OPENAI_KEY;
  if (!apiKey) {
    // Voice transport not configured — the client degrades to its represented
    // state, so return a clear, non-fatal signal rather than a 500.
    return NextResponse.json(
      { error: "voice_unavailable" },
      { status: 503 }
    );
  }

  let body: TokenRequestBody;
  try {
    body = (await request.json()) as TokenRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const callId = typeof body.callId === "string" ? body.callId : "";
  if (!callId) {
    return NextResponse.json({ error: "missing_call_id" }, { status: 400 });
  }

  const convex = getConvexClient();
  if (!convex) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // Resolve the call-scoped realtime config. The callId capability gates this;
  // an unknown/ended/non-campus call yields `available: false`.
  let config: Awaited<
    ReturnType<typeof convex.query<typeof api.campus.session.getCallRealtimeConfig>>
  >;
  try {
    config = await convex.query(api.campus.session.getCallRealtimeConfig, {
      callId,
    });
  } catch (error) {
    logger.error("Failed to resolve call realtime config", { error: String(error) });
    return NextResponse.json({ error: "resolve_failed" }, { status: 500 });
  }

  if (!config.available) {
    // No active campus call matches this id — deny without detail.
    return NextResponse.json({ error: "call_not_available" }, { status: 403 });
  }

  // A stable, privacy-preserving safety identifier bound to the token by OpenAI.
  const safetyId = createHash("sha256")
    .update(`campus_call:${callId}`)
    .digest("hex")
    .slice(0, 40);

  const sessionConfig = buildRealtimeSessionConfig({
    model: REALTIME_MODEL,
    voiceId: config.voiceId,
    systemPrompt: config.systemPrompt,
  });

  let mintResponse: Response;
  try {
    mintResponse = await fetch(CLIENT_SECRETS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": safetyId,
      },
      body: JSON.stringify(sessionConfig),
    });
  } catch (error) {
    logger.error("OpenAI client-secret request failed", { error: String(error) });
    return NextResponse.json({ error: "mint_failed" }, { status: 502 });
  }

  if (!mintResponse.ok) {
    logger.error("OpenAI client-secret request returned an error", {
      status: mintResponse.status,
    });
    return NextResponse.json({ error: "mint_failed" }, { status: 502 });
  }

  let data: { value?: string };
  try {
    data = (await mintResponse.json()) as { value?: string };
  } catch {
    return NextResponse.json({ error: "mint_parse_failed" }, { status: 502 });
  }

  if (!data.value) {
    return NextResponse.json({ error: "mint_no_token" }, { status: 502 });
  }

  // Return only what the browser needs to open the WebRTC session: the
  // ephemeral token value and the model. The real API key never leaves here.
  return NextResponse.json({
    value: data.value,
    model: REALTIME_MODEL,
    agentName: config.agentName,
  });
}
