export type CallPhase =
  | "await_restaurant_id"
  | "restaurant_verified"
  | "order_open"
  | "order_finalized";

const ALLOWED_TOOLS: Record<CallPhase, Set<string>> = {
  await_restaurant_id: new Set(["get_restaurant_details"]),
  restaurant_verified: new Set([
    "upsert_call_data",
    "add_transcript_dialogue",
    "generate_order_id",
  ]),
  order_open: new Set([
    "upsert_order",
    "add_transcript_dialogue",
    "generate_order_id",
  ]),
  order_finalized: new Set(["add_transcript_dialogue"]),
};

export function isToolAllowed(phase: CallPhase, toolName: string): boolean {
  return ALLOWED_TOOLS[phase]?.has(toolName) ?? false;
}

export function nextPhase(current: CallPhase, event: string): CallPhase {
  switch (current) {
    case "await_restaurant_id":
      if (event === "restaurant_verified") return "restaurant_verified";
      break;
    case "restaurant_verified":
      if (event === "order_id_generated") return "order_open";
      break;
    case "order_open":
      if (event === "order_finalized") return "order_finalized";
      break;
  }
  return current; // No transition
}
