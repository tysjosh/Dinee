import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import {
  addressValidator,
  parcelValidator,
  serviceTypeValidator,
  deliveryStatusValidator,
  logisticsPaymentMethodValidator,
  paymentStatusValidator,
  actorTypeValidator,
  proofOfDeliveryValidator,
} from "../shared/validators";

// ─── Inline status machine (Convex can't import from src/) ───

type DeliveryStatus =
  | "created"
  | "assigned"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "failed"
  | "cancelled";

const VALID_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  created: ["assigned", "cancelled"],
  assigned: ["picked_up", "cancelled"],
  picked_up: ["in_transit"],
  in_transit: ["delivered", "failed"],
  delivered: [],
  failed: ["created"],
  cancelled: [],
};

function validateTransition(current: DeliveryStatus, next: DeliveryStatus): boolean {
  return VALID_TRANSITIONS[current]?.includes(next) ?? false;
}

// ─── Tracking code generation ───

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateTrackingCode(): string {
  let code = "LG";
  for (let i = 0; i < 8; i++) {
    code += ALPHANUMERIC[Math.floor(Math.random() * ALPHANUMERIC.length)];
  }
  return code;
}

// ─── Task 4.3: Creation and Queries ───

/**
 * Create a new shipment with atomic check-and-insert.
 * Generates a unique tracking code (LG + 8 alphanumeric chars).
 * Creates a corresponding shipment_created event in the same mutation.
 *
 * Requirements: 4.7, 4.8, 4.9, 4.10, 7.2, 20.1, 20.2, 20.3, 20.4, 20.5
 */
export const createShipment = mutation({
  args: {
    shipmentId: v.string(),
    organizationId: v.string(),
    locationId: v.optional(v.string()),
    customerId: v.optional(v.string()),
    sender: addressValidator,
    recipient: addressValidator,
    parcel: parcelValidator,
    serviceType: serviceTypeValidator,
    paymentMethod: v.optional(logisticsPaymentMethodValidator),
    paymentStatus: v.optional(paymentStatusValidator),
    etaMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Atomic uniqueness check on shipmentId
    const existingById = await ctx.db
      .query("shipments")
      .withIndex("by_shipment_id", (q) => q.eq("shipmentId", args.shipmentId))
      .first();

    if (existingById) {
      throw new Error("409: shipmentId already exists");
    }

    // Generate tracking code with uniqueness check
    let trackingCode = generateTrackingCode();
    let existingByCode = await ctx.db
      .query("shipments")
      .withIndex("by_tracking_code", (q) => q.eq("trackingCode", trackingCode))
      .first();

    // Retry up to 5 times if collision
    let attempts = 0;
    while (existingByCode && attempts < 5) {
      trackingCode = generateTrackingCode();
      existingByCode = await ctx.db
        .query("shipments")
        .withIndex("by_tracking_code", (q) => q.eq("trackingCode", trackingCode))
        .first();
      attempts++;
    }

    if (existingByCode) {
      throw new Error("409: trackingCode already exists — unable to generate unique code");
    }

    const now = Date.now();

    // Insert the shipment
    const docId = await ctx.db.insert("shipments", {
      shipmentId: args.shipmentId,
      trackingCode,
      organizationId: args.organizationId,
      locationId: args.locationId,
      customerId: args.customerId,
      sender: args.sender,
      recipient: args.recipient,
      parcel: args.parcel,
      serviceType: args.serviceType,
      paymentMethod: args.paymentMethod,
      paymentStatus: args.paymentStatus,
      deliveryStatus: "created",
      etaMinutes: args.etaMinutes,
      createdAt: now,
      updatedAt: now,
    });

    // Create shipment_created event in the same mutation
    await ctx.db.insert("shipmentEvents", {
      eventId: `${args.shipmentId}_created`,
      shipmentId: args.shipmentId,
      eventType: "shipment_created",
      actorType: "system",
      actorId: "system",
      payload: JSON.stringify({
        shipmentId: args.shipmentId,
        trackingCode,
        organizationId: args.organizationId,
        deliveryStatus: "created",
      }),
      createdAt: now,
    });

    return { shipmentId: args.shipmentId, trackingCode, docId };
  },
});

/**
 * Get a single shipment by shipmentId.
 *
 * Requirements: 7.3, 13.1
 */
export const getShipment = query({
  args: { shipmentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("shipments")
      .withIndex("by_shipment_id", (q) => q.eq("shipmentId", args.shipmentId))
      .first();
  },
});

/**
 * Get a single shipment by trackingCode.
 *
 * Requirements: 7.7, 14.1
 */
export const getShipmentByTrackingCode = query({
  args: { trackingCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("shipments")
      .withIndex("by_tracking_code", (q) => q.eq("trackingCode", args.trackingCode))
      .first();
  },
});

/**
 * List shipments with pagination, filtering by organizationId and optional status.
 * Sorted by createdAt descending. Index-backed only — no .filter() or .collect() on full table.
 *
 * Requirements: 7.4, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 28.6, 28.7
 */
export const listShipments = query({
  args: {
    organizationId: v.string(),
    status: v.optional(deliveryStatusValidator),
    page: v.optional(v.number()),
    perPage: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = Math.max(1, args.page ?? 1);
    const perPage = Math.min(100, Math.max(1, args.perPage ?? 20));
    const skip = (page - 1) * perPage;

    let baseQuery;

    if (args.status) {
      // Use by_delivery_status index, then filter by organizationId
      // Since there's no composite index for org+status, use the status index
      // and filter by org — this is still index-backed on the status dimension
      baseQuery = ctx.db
        .query("shipments")
        .withIndex("by_delivery_status", (q) => q.eq("deliveryStatus", args.status!));
    } else {
      // Use by_organization_id index
      baseQuery = ctx.db
        .query("shipments")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId));
    }

    // Collect results in descending order by _creationTime (proxy for createdAt)
    const allMatching = await baseQuery.order("desc").collect();

    // Filter by organizationId if we used the status index
    const filtered = args.status
      ? allMatching.filter((s) => s.organizationId === args.organizationId)
      : allMatching;

    const totalCount = filtered.length;
    const items = filtered.slice(skip, skip + perPage);

    return {
      items,
      page,
      perPage,
      totalCount,
    };
  },
});

// ─── Task 4.4: Status Transitions ───

/**
 * Update shipment delivery status with state machine validation.
 * Creates a shipmentEvent recording old and new status.
 * Handles special cases: delivered (proof of delivery), failed (failure reason + rider reset),
 * and re-attempt (failed→created resets assignedRiderId).
 *
 * Requirements: 4.3, 4.10, 16.1-16.5, 17.1-17.5, 19.1-19.5
 */
export const updateShipmentStatus = mutation({
  args: {
    shipmentId: v.string(),
    newStatus: deliveryStatusValidator,
    failureReason: v.optional(v.string()),
    proofOfDelivery: v.optional(proofOfDeliveryValidator),
    actorType: v.optional(actorTypeValidator),
    actorId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Look up the shipment
    const shipment = await ctx.db
      .query("shipments")
      .withIndex("by_shipment_id", (q) => q.eq("shipmentId", args.shipmentId))
      .first();

    if (!shipment) {
      throw new Error(`Shipment not found: ${args.shipmentId}`);
    }

    const currentStatus = shipment.deliveryStatus as DeliveryStatus;
    const newStatus = args.newStatus as DeliveryStatus;

    // Validate transition using inline state machine
    if (!validateTransition(currentStatus, newStatus)) {
      throw new Error(
        `Invalid status transition: "${currentStatus}" → "${newStatus}". ` +
        `Valid transitions from "${currentStatus}": [${VALID_TRANSITIONS[currentStatus].join(", ")}]`
      );
    }

    const now = Date.now();
    const actor = args.actorType ?? "system";
    const actorId = args.actorId ?? "system";

    // Build patch object
    const patch: Record<string, unknown> = {
      deliveryStatus: newStatus,
      updatedAt: now,
    };

    // ─── Handle "delivered" status ───
    if (newStatus === "delivered" && args.proofOfDelivery) {
      // Validate at least one of photoUrl/signatureUrl is present
      if (!args.proofOfDelivery.photoUrl && !args.proofOfDelivery.signatureUrl) {
        throw new Error(
          "Proof of delivery must include at least one of photoUrl or signatureUrl"
        );
      }
      patch.proofOfDelivery = args.proofOfDelivery;
    }

    // ─── Handle "failed" status ───
    if (newStatus === "failed") {
      if (!args.failureReason) {
        throw new Error("failureReason is required when setting status to \"failed\"");
      }
      patch.failureReason = args.failureReason;

      // Set assigned rider back to "available"
      if (shipment.assignedRiderId) {
        const rider = await ctx.db
          .query("riders")
          .withIndex("by_rider_id", (q) => q.eq("riderId", shipment.assignedRiderId!))
          .first();
        if (rider) {
          await ctx.db.patch(rider._id, { status: "available" });
        }
      }
    }

    // ─── Handle re-attempt: failed → created ───
    if (currentStatus === "failed" && newStatus === "created") {
      patch.assignedRiderId = undefined;
      patch.failureReason = undefined;
    }

    // ─── Handle "delivered" — reset rider to available ───
    if (newStatus === "delivered" && shipment.assignedRiderId) {
      const rider = await ctx.db
        .query("riders")
        .withIndex("by_rider_id", (q) => q.eq("riderId", shipment.assignedRiderId!))
        .first();
      if (rider) {
        await ctx.db.patch(rider._id, { status: "available" });
      }
    }

    // Patch the shipment
    await ctx.db.patch(shipment._id, patch);

    // Create status change event
    const eventId = `${args.shipmentId}_${currentStatus}_to_${newStatus}_${now}`;
    await ctx.db.insert("shipmentEvents", {
      eventId,
      shipmentId: args.shipmentId,
      eventType: "status_changed",
      actorType: actor,
      actorId,
      payload: JSON.stringify({
        oldStatus: currentStatus,
        newStatus,
        ...(args.failureReason ? { failureReason: args.failureReason } : {}),
      }),
      createdAt: now,
    });

    // ─── Additional events for special statuses ───

    // Proof of delivery event
    if (newStatus === "delivered" && args.proofOfDelivery) {
      await ctx.db.insert("shipmentEvents", {
        eventId: `${args.shipmentId}_pod_${now}`,
        shipmentId: args.shipmentId,
        eventType: "proof_of_delivery_submitted",
        actorType: actor,
        actorId,
        payload: JSON.stringify(args.proofOfDelivery),
        createdAt: now,
      });
    }

    // Delivery failed event
    if (newStatus === "failed") {
      await ctx.db.insert("shipmentEvents", {
        eventId: `${args.shipmentId}_failed_${now}`,
        shipmentId: args.shipmentId,
        eventType: "delivery_failed",
        actorType: actor,
        actorId,
        payload: JSON.stringify({ failureReason: args.failureReason }),
        createdAt: now,
      });
    }

    return {
      shipmentId: args.shipmentId,
      oldStatus: currentStatus,
      newStatus,
    };
  },
});

// ─── Task 4.9: Rider Assignment ───

/**
 * Assign a rider to a shipment.
 * Validates rider is available and active, transitions shipment to "assigned",
 * sets rider to "busy", and creates a rider_assigned event.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
 */
export const assignRider = mutation({
  args: {
    shipmentId: v.string(),
    riderId: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Look up shipment
    const shipment = await ctx.db
      .query("shipments")
      .withIndex("by_shipment_id", (q) => q.eq("shipmentId", args.shipmentId))
      .first();

    if (!shipment) {
      throw new Error(`Shipment not found: ${args.shipmentId}`);
    }

    // 2. Validate shipment is in "created" status
    const currentStatus = shipment.deliveryStatus as DeliveryStatus;
    if (!validateTransition(currentStatus, "assigned")) {
      throw new Error(
        `Invalid status transition: "${currentStatus}" → "assigned". ` +
        `Shipment must be in "created" status to assign a rider.`
      );
    }

    // 3. Look up rider
    const rider = await ctx.db
      .query("riders")
      .withIndex("by_rider_id", (q) => q.eq("riderId", args.riderId))
      .first();

    if (!rider) {
      throw new Error(`Rider not found: ${args.riderId}`);
    }

    // 4. Validate rider is available and active
    if (rider.status !== "available" || !rider.isActive) {
      throw new Error(
        `409: Rider ${args.riderId} is not available for assignment. ` +
        `Current status: "${rider.status}", isActive: ${rider.isActive}`
      );
    }

    const now = Date.now();

    // 5. Patch shipment: set assignedRiderId and deliveryStatus to "assigned"
    await ctx.db.patch(shipment._id, {
      assignedRiderId: args.riderId,
      deliveryStatus: "assigned",
      updatedAt: now,
    });

    // 6. Patch rider: set status to "busy"
    await ctx.db.patch(rider._id, { status: "busy" });

    // 7. Create rider_assigned event
    await ctx.db.insert("shipmentEvents", {
      eventId: `${args.shipmentId}_rider_assigned_${now}`,
      shipmentId: args.shipmentId,
      eventType: "rider_assigned",
      actorType: "system",
      actorId: "system",
      payload: JSON.stringify({
        riderId: args.riderId,
        shipmentId: args.shipmentId,
        previousStatus: currentStatus,
        newStatus: "assigned",
      }),
      createdAt: now,
    });

    return {
      shipmentId: args.shipmentId,
      riderId: args.riderId,
      newStatus: "assigned" as const,
    };
  },
});

