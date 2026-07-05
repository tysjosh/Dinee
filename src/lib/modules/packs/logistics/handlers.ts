/**
 * Logistics pack — tool handler registration (extracted from the runtime).
 *
 * Binds each logistics {@link VoiceToolDefinition.handler} key to an
 * implementation in the tool-executor registry (`registerToolHandler`). These
 * handlers delegate to the logistics wrapper functions (retry logic, backend
 * calls, error normalization) in `./wrappers`, which were moved out of the
 * removed legacy `src/app/ws-server/logistics-tools.ts` module in the
 * legacy-removal step (task 4.8).
 *
 * The handlers adapt the executor's `(args, ctx)` calling convention to each
 * wrapper's positional signature and thread the per-call `callSid` through as
 * the correlation id so downstream audit/event correlation is preserved.
 *
 * Requirements: 1.4, 1.6, 2.9
 */

import {
  registerToolHandler,
  type ToolExecContext,
  type ToolHandler,
} from "@/app/ws-server/runtime/toolExecutor";
import {
  wrapperCreateShipment,
  wrapperUpdateShipment,
  wrapperAssignRider,
  wrapperAddShipmentEvent,
  wrapperQuoteDelivery,
  wrapperGetOrganizationDetails,
} from "@/lib/modules/packs/logistics/wrappers";

/** Arguments for `get_organization_details` (matches the runtime tool schema). */
interface GetOrganizationDetailsArgs {
  organization_id: string;
}

/** Arguments for `update_shipment` (matches the runtime tool schema). */
interface UpdateShipmentArgs {
  shipmentId: string;
  newStatus: string;
  failureReason?: string;
}

/** Arguments for `assign_rider` (matches the runtime tool schema). */
interface AssignRiderArgs {
  shipmentId: string;
  riderId: string;
}

/** Arguments for `add_shipment_event` (matches the runtime tool schema). */
interface AddShipmentEventArgs {
  shipmentId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}

/** Arguments for `quote_delivery` (matches the runtime tool schema). */
interface QuoteDeliveryArgs {
  sender: Parameters<typeof wrapperQuoteDelivery>[0];
  recipient: Parameters<typeof wrapperQuoteDelivery>[1];
  serviceType: Parameters<typeof wrapperQuoteDelivery>[2];
}

const getOrganizationDetailsHandler: ToolHandler = async (
  args: unknown,
  ctx: ToolExecContext
) => {
  const { organization_id } = args as GetOrganizationDetailsArgs;
  return wrapperGetOrganizationDetails(organization_id, ctx.callSid);
};

const createShipmentHandler: ToolHandler = async (
  args: unknown,
  ctx: ToolExecContext
) => {
  return wrapperCreateShipment(
    args as Parameters<typeof wrapperCreateShipment>[0],
    ctx.callSid
  );
};

const quoteDeliveryHandler: ToolHandler = async (args: unknown) => {
  const { sender, recipient, serviceType } = args as QuoteDeliveryArgs;
  return wrapperQuoteDelivery(sender, recipient, serviceType);
};

const updateShipmentHandler: ToolHandler = async (
  args: unknown,
  ctx: ToolExecContext
) => {
  const { shipmentId, newStatus, failureReason } = args as UpdateShipmentArgs;
  return wrapperUpdateShipment(
    shipmentId,
    { newStatus, failureReason },
    ctx.callSid
  );
};

const assignRiderHandler: ToolHandler = async (
  args: unknown,
  ctx: ToolExecContext
) => {
  const { shipmentId, riderId } = args as AssignRiderArgs;
  return wrapperAssignRider(shipmentId, riderId, ctx.callSid);
};

const addShipmentEventHandler: ToolHandler = async (
  args: unknown,
  ctx: ToolExecContext
) => {
  const { shipmentId, eventType, payload } = args as AddShipmentEventArgs;
  return wrapperAddShipmentEvent(shipmentId, eventType, payload ?? {}, ctx.callSid);
};

/**
 * Registers every logistics tool handler with the tool-executor registry. Safe
 * to call more than once — `registerToolHandler` replaces any existing entry
 * for a key, so repeated registration is idempotent.
 */
export function registerLogisticsHandlers(): void {
  registerToolHandler("get_organization_details", getOrganizationDetailsHandler);
  registerToolHandler("create_shipment", createShipmentHandler);
  registerToolHandler("quote_delivery", quoteDeliveryHandler);
  registerToolHandler("update_shipment", updateShipmentHandler);
  registerToolHandler("assign_rider", assignRiderHandler);
  registerToolHandler("add_shipment_event", addShipmentEventHandler);
}
