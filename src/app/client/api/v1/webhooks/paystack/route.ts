import crypto from "crypto";
import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";

const PAYSTACK_SIGNATURE_HEADER = "x-paystack-signature";

const mapPaystackStatus = (status?: string) => {
  if (!status) return "pending" as const;
  if (status === "success") return "paid" as const;
  if (status === "failed") return "failed" as const;
  return "pending" as const;
};

const mapPaystackChannel = (channel?: string) => {
  if (!channel) return undefined;
  if (channel === "card") return "card" as const;
  if (channel === "bank") return "bank" as const;
  if (channel === "ussd") return "ussd" as const;
  if (channel === "bank_transfer") return "transfer" as const;
  return undefined;
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET ?? process.env.PAYSTACK_SECRET_KEY;
  const signature = request.headers.get(PAYSTACK_SIGNATURE_HEADER);

  if (secret && signature) {
    const digest = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
    if (digest !== signature) {
      return new Response(JSON.stringify({ success: false, message: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    console.warn("Paystack webhook signature verification skipped (missing secret or signature).");
  }

  const payload = JSON.parse(rawBody) as {
    data?: { reference?: string; status?: string; channel?: string };
  };

  const reference = payload.data?.reference;
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
    paymentStatus: mapPaystackStatus(payload.data?.status),
    paymentProvider: "paystack",
    paymentMethod: mapPaystackChannel(payload.data?.channel),
    paymentVerifiedAt: Date.now(),
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
