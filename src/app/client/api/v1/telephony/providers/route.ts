import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const platformId = searchParams.get("platformId") ?? undefined;

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return new Response(JSON.stringify({ success: false, message: "Missing Convex URL" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new ConvexHttpClient(convexUrl);
  const providers = await client.query(api.telephonyProviders.listTelephonyProviders, {
    platformId,
  });

  return new Response(JSON.stringify({ success: true, data: providers }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
