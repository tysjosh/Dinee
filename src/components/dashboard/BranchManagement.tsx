"use client";

import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import ConfirmationModal from "@/components/ui/ConfirmationModal";

/**
 * Owner-facing branch management.
 *
 * Lets a restaurant/business owner add, activate/deactivate, and remove branches
 * for their tenant. Create/delete are owner-only at the Convex layer
 * (`requireRoleOrInternal` with owner roles); this surface simply drives those
 * entry points. Rendered only inside the owner-gated Settings region.
 */
interface BranchManagementProps {
  restaurantId: string;
}

interface BranchRow {
  _id: string;
  branchId: string;
  name: string;
  address: string;
  phoneNumber: string;
  isActive: boolean;
}

const BranchManagement: React.FC<BranchManagementProps> = ({ restaurantId }) => {
  const branches = useQuery(
    api.branches.getBranchesByRestaurant,
    restaurantId ? { restaurantId } : "skip"
  ) as BranchRow[] | undefined;

  const createBranch = useMutation(api.branches.createBranch);
  const activateBranch = useMutation(api.branches.activateBranch);
  const deactivateBranch = useMutation(api.branches.deactivateBranch);
  const deleteBranch = useMutation(api.branches.deleteBranch);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BranchRow | null>(null);

  const resetMessages = () => {
    setError(null);
    setSuccess(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!name.trim() || !address.trim() || !phoneNumber.trim()) {
      setError("Name, address, and phone number are required.");
      return;
    }
    setIsSubmitting(true);
    try {
      await createBranch({
        restaurantId,
        name: name.trim(),
        address: address.trim(),
        phoneNumber: phoneNumber.trim(),
      });
      setName("");
      setAddress("");
      setPhoneNumber("");
      setSuccess(`Branch "${name.trim()}" created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branch.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (branch: BranchRow) => {
    resetMessages();
    setActionLoading(branch.branchId);
    try {
      if (branch.isActive) {
        await deactivateBranch({ branchId: branch.branchId });
      } else {
        await activateBranch({ branchId: branch.branchId });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update branch.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const branch = pendingDelete;
    setPendingDelete(null);
    resetMessages();
    setActionLoading(branch.branchId);
    try {
      await deleteBranch({ branchId: branch.branchId });
      setSuccess(`Branch "${branch.name}" deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete branch.");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="card-minimal rounded-xl">
      <div className="bg-white/5 border-b border-white/10 px-4 sm:px-6 py-4">
        <h2 className="text-base font-semibold text-white">Branches</h2>
        <p className="text-sm text-white/70 mt-1">
          Add or remove physical locations for your business.
        </p>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Create form */}
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Branch name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Lekki Branch"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Address
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="12 Admiralty Way"
                className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Phone number
              </label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+234..."
                className="w-full px-3 py-2.5 bg-white/5 border border-white/20 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200"
                disabled={isSubmitting}
              />
            </div>
          </div>
          <div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors duration-200 cursor-pointer"
            >
              {isSubmitting ? "Adding..." : "Add branch"}
            </button>
          </div>

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
        </form>

        {/* Branch list */}
        <div>
          <h3 className="text-sm font-medium text-white/70 mb-3">
            Existing branches
          </h3>
          {branches === undefined ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-700 border-t-emerald-500" />
            </div>
          ) : branches.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-white/50">No branches yet.</p>
            </div>
          ) : (
            <div className="border border-white/10 rounded-lg divide-y divide-white/10">
              {branches.map((branch) => {
                const busy = actionLoading === branch.branchId;
                return (
                  <div
                    key={branch._id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">
                          {branch.name}
                        </p>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                            branch.isActive
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                          }`}
                        >
                          {branch.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className="text-xs text-white/50 truncate mt-0.5">
                        {branch.address} · {branch.phoneNumber}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleToggleActive(branch)}
                        disabled={busy}
                        className="px-2.5 py-1 text-xs font-medium text-white/80 hover:text-white bg-white/5 hover:bg-white/10 border border-white/20 rounded-md transition-colors duration-200 disabled:opacity-50 cursor-pointer"
                      >
                        {branch.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => setPendingDelete(branch)}
                        disabled={busy}
                        className="px-2.5 py-1 text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-md transition-colors duration-200 disabled:opacity-50 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={pendingDelete !== null}
        title="Delete branch"
        message={`Permanently delete "${pendingDelete?.name}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
};

export default BranchManagement;
