export type LogisticsCallPhase =
  | "await_org_verification"
  | "org_verified"
  | "shipment_open"
  | "shipment_confirmed";

const ALLOWED_TOOLS: Record<LogisticsCallPhase, Set<string>> = {
  await_org_verification: new Set(["get_organization_details"]),
  org_verified: new Set(["create_shipment", "quote_delivery"]),
  shipment_open: new Set([
    "update_shipment",
    "assign_rider",
    "add_shipment_event",
  ]),
  shipment_confirmed: new Set(["add_shipment_event"]),
};

export function isLogisticsToolAllowed(
  phase: LogisticsCallPhase,
  toolName: string
): boolean {
  return ALLOWED_TOOLS[phase]?.has(toolName) ?? false;
}

export function nextLogisticsPhase(
  current: LogisticsCallPhase,
  event: string
): LogisticsCallPhase {
  switch (current) {
    case "await_org_verification":
      if (event === "org_verified") return "org_verified";
      break;
    case "org_verified":
      if (event === "shipment_created") return "shipment_open";
      break;
    case "shipment_open":
      if (event === "shipment_finalized") return "shipment_confirmed";
      break;
  }
  return current; // No transition
}
