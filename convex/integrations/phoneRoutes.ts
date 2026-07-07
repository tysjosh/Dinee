import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { isConversationTypeAllowed } from "../runsheet/numberAssignments";
import { authorizeIntegrationConfigAccess } from "./authorization";

/**
 * Generic multi-platform phone-number -> route store (Dinee-owned).
 *
 * Supersedes the Runsheet-specific `runsheetNumberAssignments` store as the
 * config-driven, multi-platform routing mapping. A route maps an inbound "To"
 * number to a `(platformId, tenantId, conversationType)` triple. Dinee owns
 * only this routing mapping; it is NOT order-of-record data (that lives in the
 * external platform backend).
 *
 * A route save is accepted only when the requested conversation type is in the
 * tenant's `allowedConversationTypes` for the platform (stored on the
 * `integrations` record keyed by `(platformId, tenantId)`). A disallowed
 * conversation type is rejected with a disallowed-conversation-type error
 * naming the offending type, and existing routes are left unchanged.
 *
 * This mirrors the patterns of `convex/runsheet/numberAssignments.ts` and
 * reuses the pure `isConversationTypeAllowed` predicate as the single source of
 * truth for the allow decision.
 *
 * Requirements: 4.1, 4.3 (multi-platform-voice-integrations)
 */

/**
 * Save (upsert) a phone route mapping `(phoneNumber -> platformId, tenantId,
 * conversationType)`.
 *
 * Validates BEFORE any write (validate-before-mutate): the tenant's integration
 * config for `(platformId, tenantId)` must exist and the requested
 * `conversationType` must be in its `allowedConversationTypes`. On rejection no
 * route is created or modified, so existing routes remain unchanged (Req 4.3).
 *
 * If a route already exists for the same `phoneNumber`, it is updated in place
 * rather than duplicated (a phone number resolves to exactly one route).
 *
 * Requirements: 4.1, 4.3
 */
export const savePhoneRoute = mutation({
  args: {
    phoneNumber: v.string(),
    platformId: v.string(),
    tenantId: v.string(),
    conversationType: v.string(),
  },
  handler: async (ctx, args) => {
    // Authorize FIRST — routing an inbound number binds it to a tenant's
    // integration, so only a platform admin, the owner of args.tenantId, or a
    // partner whose scope includes the pair may save a route. Fails closed
    // before any read/write so existing routes are left unchanged on denial.
    await authorizeIntegrationConfigAccess(ctx, args.platformId, args.tenantId);

    // Resolve the tenant's integration config for this platform to read its
    // allowed conversation types.
    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_platform_tenant", (q) =>
        q.eq("platformId", args.platformId).eq("tenantId", args.tenantId)
      )
      .first();

    if (!integration) {
      throw new Error(
        `Integration config not found for platform "${args.platformId}" ` +
          `and tenant "${args.tenantId}"`
      );
    }

    // Req 4.3: reject a conversation type that is not in the tenant's allowed
    // set for the platform, naming the offending type. Validate before write so
    // existing routes are left unchanged on rejection. Reuse the pure predicate.
    if (
      !isConversationTypeAllowed(
        integration.allowedConversationTypes,
        args.conversationType
      )
    ) {
      throw new Error(
        `Conversation type "${args.conversationType}" is not in the tenant's ` +
          `allowed conversation types [${integration.allowedConversationTypes.join(
            ", "
          )}] for platform "${args.platformId}"`
      );
    }

    const now = Date.now();

    // Upsert per phone number so an accepted number resolves to exactly one
    // route rather than a duplicate (Req 4.1).
    const existing = await ctx.db
      .query("phoneRoutes")
      .withIndex("by_phone_number", (q) =>
        q.eq("phoneNumber", args.phoneNumber)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        platformId: args.platformId,
        tenantId: args.tenantId,
        conversationType: args.conversationType,
      });
      return { routeId: existing._id, updated: true };
    }

    const routeId = await ctx.db.insert("phoneRoutes", {
      phoneNumber: args.phoneNumber,
      platformId: args.platformId,
      tenantId: args.tenantId,
      conversationType: args.conversationType,
      createdAt: now,
    });

    return { routeId, updated: false };
  },
});

/**
 * Resolve an inbound phone number to its stored route.
 *
 * Returns the mapped `(platformId, tenantId, conversationType)` for the number,
 * or null when the number has no stored route (so callers can fall through to
 * the existing branch/location resolution paths).
 *
 * Requirements: 4.1, 4.2
 */
export const resolveRoute = query({
  args: {
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const route = await ctx.db
      .query("phoneRoutes")
      .withIndex("by_phone_number", (q) =>
        q.eq("phoneNumber", args.phoneNumber)
      )
      .first();

    if (!route) {
      return null;
    }

    return {
      phoneNumber: route.phoneNumber,
      platformId: route.platformId,
      tenantId: route.tenantId,
      conversationType: route.conversationType,
    };
  },
});
