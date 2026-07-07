"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useTenant } from "@/contexts/TenantContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Team invitation management component.
 * Allows restaurant owners to invite team members, view invitation status,
 * and manage pending invitations (resend/revoke).
 *
 * Requirements: 9.2, 9.4
 */
const TeamInvitations: React.FC = () => {
  const { state, actions } = useTenant();
  const { user } = useCurrentUser();
  const isOwner = actions.hasPermission("restaurant", "update");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"branch_manager" | "supervisor">("supervisor");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const tenantId = state.restaurant?.restaurantId ?? "";

  const invitations = useQuery(
    api.invitations.getInvitationsByTenant,
    tenantId ? { tenantId } : "skip"
  );

  const createInvitation = useMutation(api.invitations.createInvitation);
  const revokeInvitation = useMutation(api.invitations.revokeInvitation);
  const resendInvitation = useMutation(api.invitations.resendInvitation);

  if (!isOwner) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Please enter an email address.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!user?.userId || !tenantId) {
      setError("Unable to send invitation. Please try again.");
      return;
    }

    setIsSubmitting(true);
    try {
      await createInvitation({
        email: trimmedEmail,
        role,
        tenantId,
      });
      setEmail("");
      setRole("supervisor");
      setSuccessMessage(`Invitation sent to ${trimmedEmail}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to send invitation.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async (invitationId: Id<"invitations">) => {
    setActionLoading(invitationId);
    try {
      await revokeInvitation({ invitationId });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to revoke invitation.";
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleResend = async (invitationId: Id<"invitations">) => {
    setActionLoading(invitationId);
    try {
      await resendInvitation({ invitationId });
      setSuccessMessage("Invitation resent successfully.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to resend invitation.";
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: string, expiresAt: number) => {
    const isExpired = status === "pending" && expiresAt < Date.now();
    const effectiveStatus = isExpired ? "expired" : status;

    const styles: Record<string, string> = {
      pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      accepted: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      expired: "bg-red-500/10 text-red-400 border-red-500/20",
      revoked: "bg-gray-500/10 text-gray-400 border-gray-500/20",
    };

    const labels: Record<string, string> = {
      pending: "Pending",
      accepted: "Accepted",
      expired: "Expired",
      revoked: "Revoked",
    };

    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${styles[effectiveStatus] ?? styles.revoked}`}
      >
        {labels[effectiveStatus] ?? effectiveStatus}
      </span>
    );
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatRole = (r: string) => {
    return r
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  return (
    <div className="card-minimal rounded-xl">
      <div className="bg-white/5 border-b border-white/10 px-4 sm:px-6 py-4">
        <h2 className="text-base font-semibold text-white">Team Members</h2>
        <p className="text-sm text-white/70 mt-1">
          Invite team members and manage their access.
        </p>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Invite Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                  if (successMessage) setSuccessMessage(null);
                }}
                placeholder="team@example.com"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
                disabled={isSubmitting}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "branch_manager" | "supervisor")}
                className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent cursor-pointer transition-all duration-200"
                disabled={isSubmitting}
              >
                <option value="supervisor" className="bg-black text-white">
                  Supervisor
                </option>
                <option value="branch_manager" className="bg-black text-white">
                  Branch Manager
                </option>
              </select>
            </div>
            <div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors duration-200 cursor-pointer"
              >
                {isSubmitting ? "Sending..." : "Send Invite"}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-sm text-emerald-400">{successMessage}</p>
            </div>
          )}
        </form>

        {/* Invitations List */}
        <div>
          <h3 className="text-sm font-medium text-white/70 mb-3">
            Invitations
          </h3>

          {invitations === undefined ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-700 border-t-emerald-500" />
            </div>
          ) : invitations.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-white/50">
                No invitations yet. Send one above to get started.
              </p>
            </div>
          ) : (
            <div className="border border-white/10 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/10">
                      <th className="text-left px-4 py-3 text-white/60 font-medium">
                        Email
                      </th>
                      <th className="text-left px-4 py-3 text-white/60 font-medium">
                        Role
                      </th>
                      <th className="text-left px-4 py-3 text-white/60 font-medium">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 text-white/60 font-medium">
                        Created
                      </th>
                      <th className="text-left px-4 py-3 text-white/60 font-medium">
                        Expires
                      </th>
                      <th className="text-right px-4 py-3 text-white/60 font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {invitations.map((inv: Doc<"invitations">) => {
                      const isPending =
                        inv.status === "pending" && inv.expiresAt >= Date.now();
                      const isActionLoading = actionLoading === inv._id;

                      return (
                        <tr
                          key={inv._id}
                          className="hover:bg-white/5 transition-colors"
                        >
                          <td className="px-4 py-3 text-white">
                            {inv.email}
                          </td>
                          <td className="px-4 py-3 text-white/70">
                            {formatRole(inv.role)}
                          </td>
                          <td className="px-4 py-3">
                            {getStatusBadge(inv.status, inv.expiresAt)}
                          </td>
                          <td className="px-4 py-3 text-white/50">
                            {formatDate(inv.createdAt)}
                          </td>
                          <td className="px-4 py-3 text-white/50">
                            {formatDate(inv.expiresAt)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {isPending && (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleResend(inv._id)}
                                  disabled={isActionLoading}
                                  className="px-2.5 py-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-md transition-colors duration-200 disabled:opacity-50 cursor-pointer"
                                >
                                  Resend
                                </button>
                                <button
                                  onClick={() => handleRevoke(inv._id)}
                                  disabled={isActionLoading}
                                  className="px-2.5 py-1 text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-md transition-colors duration-200 disabled:opacity-50 cursor-pointer"
                                >
                                  Revoke
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeamInvitations;
