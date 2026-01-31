export type WhatsappMessageType = "confirmation" | "status_update";

export function buildWhatsappMessage({
  messageType,
  orderId,
  deliveryStatus,
}: {
  messageType: WhatsappMessageType;
  orderId: string;
  deliveryStatus?: string;
}) {
  if (messageType === "confirmation") {
    return `Thanks for your order! Your order #${orderId} has been received and is being prepared.`;
  }
  return `Update for order #${orderId}: status is now ${deliveryStatus ?? "updated"}.`;
}
