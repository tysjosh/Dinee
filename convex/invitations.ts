import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { generateSecureToken, sha256Hex } from "./tokenHash";

/**
 * Invitation CRUD mutations and queries.
 *
 * Handles team member invitations with role assignment, token generation,
 * expiry enforcement, and authorization checks.
 *
 * SECURITY: invite tokens are stored ONLY as their SHA-256 hash (the
 * `inviteToken` field holds the hash). The raw token is returned to the caller
 * once — for the invite link — and never persisted, so a DB read cannot yield a
 * usable token. Lookups hash the incoming raw token and match on the hash.
 *
 * Requirements: 9.1, 9.3, 9.7, 9.8
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Role validator for invitations — only branch_manager and supervisor allowed. */
const invitationRoleValidator = v.union(
  v.literal("branch_manager"),
  v.literal("supervisor")
);

/**
 * Create a new team invitation.
 *
 * Generates a unique invite token, sets status to "pending" with a 7-day expiry.
 * Enforces that the caller (invitedBy) has the `restaurant_owner` role.
 *
 * Requirements: 9.3, 9.7, 9.8
 */
export const createInvitation = mutation({
  args: {
    email: v.string(),
    role: invitationRoleValidator,
    tenantId: v.string(),
    invitedBy: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify the caller has restaurant_owner role
    const caller = await ctx.db
      .query("users")
      .withIndex("by_user_id", (q) => q.eq("userId", args.invitedBy))
      .first();

    if (!caller) {
      throw new Error("Inviting user not found");
    }

    if (caller.role !== "restaurant_owner") {
      throw new Error("Only restaurant owners can create invitations");
    }

    const now = Date.now();
    // Mint a CSPRNG token; store only its hash, return the raw value once.
    const rawToken = generateSecureToken();
    const tokenHash = await sha256Hex(rawToken);

    const docId = await ctx.db.insert("invitations", {
      email: args.email.toLowerCase().trim(),
      role: args.role,
      tenantId: args.tenantId,
      invitedBy: args.invitedBy,
      inviteToken: tokenHash,
      status: "pending",
      createdAt: now,
      expiresAt: now + SEVEN_DAYS_MS,
    });

    return { docId, inviteToken: rawToken };
  },
});


/**
 * Look up an invitation by its unique token.
 * Checks expiry and status — returns the invitation with a validity flag.
 *
 * Requirements: 9.5, 9.6
 */
export const getInvitationByToken = query({
  args: { inviteToken: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.inviteToken);
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", tokenHash))
      .first();

    if (!invitation) {
      return null;
    }

    const now = Date.now();
    const isExpired = invitation.expiresAt < now;
    const isValid = invitation.status === "pending" && !isExpired;

    return { ...invitation, isExpired, isValid };
  },
});

/**
 * Accept an invitation — marks it as "accepted" and sets acceptedAt.
 *
 * Requirements: 9.5
 */
export const acceptInvitation = mutation({
  args: { inviteToken: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.inviteToken);
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", tokenHash))
      .first();

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    if (invitation.status !== "pending") {
      throw new Error(`Invitation has already been ${invitation.status}`);
    }

    if (invitation.expiresAt < Date.now()) {
      throw new Error("Invitation has expired");
    }

    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Revoke a pending invitation — sets status to "revoked".
 *
 * Requirements: 9.7
 */
export const revokeInvitation = mutation({
  args: { inviteToken: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.inviteToken);
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", tokenHash))
      .first();

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    if (invitation.status !== "pending") {
      throw new Error(`Cannot revoke an invitation that is ${invitation.status}`);
    }

    await ctx.db.patch(invitation._id, { status: "revoked" });

    return { success: true };
  },
});

/**
 * List all invitations for a given tenant.
 *
 * Requirements: 9.2
 */
export const getInvitationsByTenant = query({
  args: { tenantId: v.string() },
  handler: async (ctx, args) => {
    const invitations = await ctx.db
      .query("invitations")
      .withIndex("by_tenant_id", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    return invitations;
  },
});

/**
 * Resend a pending invitation — resets expiresAt to 7 days from now.
 *
 * Requirements: 9.8
 */
export const resendInvitation = mutation({
  args: { inviteToken: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.inviteToken);
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", tokenHash))
      .first();

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    if (invitation.status !== "pending") {
      throw new Error(`Cannot resend an invitation that is ${invitation.status}`);
    }

    // Rotate the token on resend: the old raw token is unrecoverable (only its
    // hash is stored), so issue a fresh one, persist its hash, extend expiry,
    // and return the new raw token for the resent invite link.
    const newRawToken = generateSecureToken();
    const newTokenHash = await sha256Hex(newRawToken);
    const newExpiresAt = Date.now() + SEVEN_DAYS_MS;
    await ctx.db.patch(invitation._id, {
      inviteToken: newTokenHash,
      expiresAt: newExpiresAt,
    });

    return { success: true, newExpiresAt, inviteToken: newRawToken };
  },
});
