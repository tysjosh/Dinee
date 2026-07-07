"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

/**
 * Owner-facing staff -> branch assignment.
 *
 * Lets an owner restrict each branch_manager / supervisor to specific branches.
 * This is what POPULATES `assignedBranchIds`; until an owner assigns branches a
 * staff member is unrestricted within the tenant (backward compatible), and the
 * branch-keyed order/call readers enforce the restriction only once it is set.
 *
 * Save path: `users.setUserAssignedBranches` (owner-only at the Convex layer;
 * validates the target user and every branch belong to the caller's tenant).
 * Rendered only inside the owner-gated Settings region.
 */
interface StaffBranchAssignmentProps {
  restaurantId: string;
}

interface StaffMember {
  userId: string | undefined;
  email: string | undefined;
  role: string | undefined;
  assignedBranchIds: string[];
}

interface BranchRow {
  branchId: string;
  name: string;
  isActive: boolean;
}

const formatRole = (r: string | undefined) =>
  (r ?? "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const StaffBranchAssignment: React.FC<StaffBranchAssignmentProps> = ({
  restaurantId,
}) => {
  const staff = useQuery(
    api.users.getStaffByTenant,
    restaurantId ? { tenantId: restaurantId } : "skip"
  ) as StaffMember[] | undefined;

  const branches = useQuery(
    api.branches.getBranchesByRestaurant,
    restaurantId ? { restaurantId } : "skip"
  ) as BranchRow[] | undefined;

  const setUserAssignedBranches = useMutation(
    api.users.setUserAssignedBranches
  );

  // Local draft of each staff member's selected branch ids, keyed by userId.
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Hydrate the draft from server data whenever staff data changes.
  useEffect(() => {
    if (!staff) return;
    const next: Record<string, Set<string>> = {};
    for (const s of staff) {
      if (s.userId) next[s.userId] = new Set(s.assignedBranchIds);
    }
    setDraft(next);
  }, [staff]);

  const branchList = useMemo(() => branches ?? [], [branches]);

  const toggle = (userId: string, branchId: string) => {
    setError(null);
    setSuccess(null);
    setDraft((prev) => {
      const current = new Set(prev[userId] ?? []);
      if (current.has(branchId)) current.delete(branchId);
      else current.add(branchId);
      return { ...prev, [userId]: current };
    });
  };

  const handleSave = async (userId: string) => {
    setError(null);
    setSuccess(null);
    setSavingUser(userId);
    try {
      await setUserAssignedBranches({
        userId,
        branchIds: Array.from(draft[userId] ?? []),
      });
      setSuccess("Branch access updated.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update branch access."
      );
    } finally {
      setSavingUser(null);
    }
  };

  return (
    <div className="card-minimal rounded-xl">
      <div className="bg-white/5 border-b border-white/10 px-4 sm:px-6 py-4">
        <h2 className="text-base font-semibold text-white">
          Staff branch access
        </h2>
        <p className="text-sm text-white/70 mt-1">
          Restrict managers and supervisors to specific branches. Leave all
          unchecked to allow access across every branch.
        </p>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-6">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
        {success && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-sm text-emerald-400">{success}</p>
          </div>
        )}

        {staff === undefined || branches === undefined ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-700 border-t-emerald-500" />
          </div>
        ) : staff.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-white/50">
              No managers or supervisors yet. Invite team members above, then
              assign their branches here once they join.
            </p>
          </div>
        ) : branchList.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-white/50">
              Add a branch first to assign staff to it.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {staff.map((member) => {
              if (!member.userId) return null;
              const uid = member.userId;
              const selected = draft[uid] ?? new Set<string>();
              const busy = savingUser === uid;
              return (
                <div
                  key={uid}
                  className="border border-white/10 rounded-lg px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {member.email ?? uid}
                      </p>
                      <p className="text-xs text-white/50">
                        {formatRole(member.role)}
                        {selected.size === 0
                          ? " · all branches"
                          : ` · ${selected.size} branch${selected.size === 1 ? "" : "es"}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleSave(uid)}
                      disabled={busy}
                      className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md transition-colors duration-200 cursor-pointer flex-shrink-0"
                    >
                      {busy ? "Saving..." : "Save"}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {branchList.map((branch) => {
                      const checked = selected.has(branch.branchId);
                      return (
                        <label
                          key={branch.branchId}
                          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md border text-xs cursor-pointer transition-colors ${
                            checked
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                              : "bg-white/5 border-white/15 text-white/70 hover:bg-white/10"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-white/30 bg-transparent text-emerald-500 focus:ring-emerald-500"
                            checked={checked}
                            onChange={() => toggle(uid, branch.branchId)}
                          />
                          {branch.name}
                          {!branch.isActive && (
                            <span className="text-white/40">(inactive)</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default StaffBranchAssignment;
