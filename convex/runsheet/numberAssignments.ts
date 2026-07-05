import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Runsheet phone-number -> conversation-type assignment (Dinee-owned).
 *
 * Dinee owns only the phone-number -> conversation-type routing mapping; it is
 * NOT order-of-record data (that lives in the Runsheet backend). An assignment
 * is accepted only when the requested conversation type is in the tenant's
 * `allowedConversationTypes` (stored on the tenant's `runsheetIntegrations`
 * record). A disallowed conversation type is rejected with an error naming the
 * offending type, and the existing number assignments are left unchanged.
 *
 * Requirements: 9.1, 9.5, 9.6 (dinee-voice-platform)
 */

/**
 * Pure decision predicate for number-to-conversation-type assignment (Req 9.5,
 * 9.6): an assignment is accepted if and only if the requested conversation
 * type is a member of the tenant's allowed conversation types. Kept pure (no
 * Convex, no I/O) so it is the single source of truth shared by the mutation
 * guard below and by property tests.
 *
 * Requirements: 9.5, 9.6, 4.5
 */
export function isConversationTypeAllowed(
  allowedConversationTypes: readonly string[],
  conversationType: string
): boolean {
  return allowedConversationTypes.includes(conversationType);
}

/**
 * Assign a Dinee-managed phone number to a Runsheet conversation type.
 *
 * Accepts the assignment if and only if `conversationType` is in the tenant's
 * allowed conversation types. If a mapping already exists for the given phone
 * number (within the tenant), it is updated to the new conversation type;
 * otherwise a new mapping is inserted. On rejection, no assignment is created
 * or modified, so existing number assignments remain unchanged (Req 9.6).
 *
 * Requirements: 9.1, 9.5, 9.6
 */
export const assignNumber = mutation({
  args: {
    tenantId: v.string(),
    phoneNumber: v.string(),
    conversationType: v.string(),
  },
  handler: async (ctx, args) => {
    // Resolve the tenant's integration to read its allowed conversation types.
    const integration = await ctx.db
      .query("runsheetIntegrations")
      .withIndex("by_tenant_id", (q) => q.eq("tenantId", args.tenantId))
      .first();

    if (!integration) {
      throw new Error(
        `Runsheet integration not found for tenant ${args.tenantId}`
      );
    }

    // Req 9.5, 9.6: an assignment is accepted only when the conversation type
    // is in the tenant's allowed set. Reject otherwise, naming the disallowed
    // type, and leave existing number assignments unchanged.
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
          )}]`
      );
    }

    const now = Date.now();

    // Upsert per phone number within the tenant so an accepted number resolves
    // to exactly one mapped conversation type (Req 9.5).
    const existing = await ctx.db
      .query("runsheetNumberAssignments")
      .withIndex("by_phone_number", (q) =>
        q.eq("phoneNumber", args.phoneNumber)
      )
      .filter((q) => q.eq(q.field("tenantId"), args.tenantId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        conversationType: args.conversationType,
      });
      return { assignmentId: existing._id, updated: true };
    }

    const assignmentId = await ctx.db.insert("runsheetNumberAssignments", {
      tenantId: args.tenantId,
      phoneNumber: args.phoneNumber,
      conversationType: args.conversationType,
      createdAt: now,
    });

    return { assignmentId, updated: false };
  },
});

/**
 * Resolve an accepted Dinee-managed phone number to its mapped conversation
 * type. Returns the single mapped conversation type for the number, or null
 * when the number has no assignment (Req 9.5).
 *
 * Requirements: 9.5
 */
export const resolveNumber = query({
  args: {
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const assignment = await ctx.db
      .query("runsheetNumberAssignments")
      .withIndex("by_phone_number", (q) =>
        q.eq("phoneNumber", args.phoneNumber)
      )
      .first();

    if (!assignment) {
      return null;
    }

    return {
      tenantId: assignment.tenantId,
      phoneNumber: assignment.phoneNumber,
      conversationType: assignment.conversationType,
    };
  },
});
