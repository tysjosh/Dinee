import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";
import Twilio from "twilio";
import { buildWhatsappMessage, type WhatsappMessageType } from "@/lib/whatsappMessages";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    orderId?: string;
    restaurantId?: string;
    phoneNumber?: string;
    messageType?: WhatsappMessageType;
    deliveryStatus?: string;
  };

  if (!body.orderId || !body.restaurantId || !body.phoneNumber || !body.messageType) {
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

  const accountSid = process.env.NEXT_TWILIO_SID;
  const authToken = process.env.NEXT_TWILIO_AUTH_TOKEN;
  const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;

  if (!accountSid || !authToken || !whatsappNumber) {
    return new Response(JSON.stringify({ success: false, message: "Missing Twilio WhatsApp configuration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = Twilio(accountSid, authToken);
  const bodyText = buildWhatsappMessage({
    messageType: body.messageType,
    orderId: body.orderId,
    deliveryStatus: body.deliveryStatus,
  });

  await client.messages.create({
    from: `whatsapp:${whatsappNumber}`,
    to: `whatsapp:${body.phoneNumber}`,
    body: bodyText,
  });

  const convexClient = new ConvexHttpClient(convexUrl);
  await convexClient.mutation(api.orders.updateOrderWhatsappByOrderId, {
    orderId: body.orderId,
    restaurantId: body.restaurantId,
    whatsappStatus: "opted_in",
    whatsappPhone: body.phoneNumber,
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
