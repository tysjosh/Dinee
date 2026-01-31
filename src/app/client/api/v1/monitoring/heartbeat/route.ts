import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    serviceName?: string;
    status?: "ok" | "degraded" | "down";
    latencyMs?: number;
  };

  if (!body.serviceName || !body.status || body.latencyMs === undefined) {
    return new Response(JSON.stringify({ success: false, message: "Missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return new Response(JSON.stringify({ success: false, message: "Missing Convex URL" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new ConvexHttpClient(convexUrl);
  await client.mutation(api.monitoring.recordServiceMetric, {
    serviceName: body.serviceName,
    status: body.status,
    latencyMs: body.latencyMs,
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
