import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../convex/_generated/api";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    orderId?: string;
    restaurantId?: string;
    deliveryStatus?: "pending" | "preparing" | "dispatched" | "delivered" | "failed" | "cancelled";
    deliveryPartner?: string;
  };

  if (!body.orderId || !body.restaurantId || !body.deliveryStatus) {
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

  const convexClient = new ConvexHttpClient(convexUrl);
  await convexClient.mutation(api.orders.updateOrderDeliveryByOrderId, {
    orderId: body.orderId,
    restaurantId: body.restaurantId,
    deliveryStatus: body.deliveryStatus,
    deliveryPartner: body.deliveryPartner,
  });

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
