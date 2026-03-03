export type DeliveryStatus =
  | "created"
  | "assigned"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "failed"
  | "cancelled";

export const VALID_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  created: ["assigned", "cancelled"],
  assigned: ["picked_up", "cancelled"],
  picked_up: ["in_transit"],
  in_transit: ["delivered", "failed"],
  delivered: [],
  failed: ["created"], // re-attempt
  cancelled: [],
};

export function validateTransition(
  current: DeliveryStatus,
  next: DeliveryStatus
): boolean {
  return VALID_TRANSITIONS[current]?.includes(next) ?? false;
}
