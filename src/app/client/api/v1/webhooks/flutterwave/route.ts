import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";

const FLUTTERWAVE_SIGNATURE_HEADER = "verif-hash";

const mapFlutterwaveStatus = (status?: string) => {
  if (!status) return "pending" as const;
  if (status === "successful" || status === "success") return "paid" as const;
  if (status === "failed") return "failed" as const;
  return "pending" as const;
};

const mapFlutterwaveMethod = (paymentType?: string) => {
  if (!paymentType) return undefined;
  if (paymentType.includes("card")) return "card" as const;
  if (paymentType.includes("bank")) return "bank" as const;
  if (paymentType.includes("ussd")) return "ussd" as const;
  if (paymentType.includes("transfer")) return "transfer" as const;
  return undefined;
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get(FLUTTERWAVE_SIGNATURE_HEADER);
  const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET;

  if (secret && signature && signature !== secret) {
    return new Response(JSON.stringify({ success: false, message: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!secret) {
    console.warn("Flutterwave webhook signature verification skipped (missing secret).");
  }

  const payload = JSON.parse(rawBody) as {
    data?: { tx_ref?: string; status?: string; payment_type?: string };
  };

  const reference = payload.data?.tx_ref;
  if (!reference) {
    return new Response(JSON.stringify({ success: false, message: "Missing payment reference" }), {
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

  const convexClient = new ConvexHttpClient(convexUrl);
  await convexClient.mutation(api.orders.updateOrderPaymentByReference, {
    paymentReference: reference,
    paymentStatus: mapFlutterwaveStatus(payload.data?.status),
    paymentProvider: "flutterwave",
    paymentMethod: mapFlutterwaveMethod(payload.data?.payment_type),
    paymentVerifiedAt: Date.now(),
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
