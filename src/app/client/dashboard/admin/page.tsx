"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Doc } from "../../../../../convex/_generated/dataModel";
import { useTenant } from "@/contexts/TenantContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type Tab = "restaurants" | "users";

const ROLES = [
  "platform_admin",
  "restaurant_owner",
  "business_owner",
  "branch_manager",
  "supervisor",
] as const;

function formatDate(timestamp: number | undefined): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(timestamp: number | undefined): string {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPage() {
  const router = useRouter();
  const { state } = useTenant();
  const { user, isLoading: userLoading } = useCurrentUser();
  const [activeTab, setActiveTab] = useState<Tab>("restaurants");

  // Redirect non-admins
  const isAdmin = state.userRole === "platform_admin";

  // Queries — these are platform-wide admin reads (server-enforced to
  // platform_admin). Skip them entirely until we've confirmed the caller is an
  // admin, so a non-admin's browser never issues the privileged request (and
  // never hits the server-side authorization error) before being redirected.
  const canQuery = !userLoading && isAdmin;
  const restaurants = useQuery(
    api.restaurants.getAllRestaurants,
    canQuery ? {} : "skip"
  );
  const users = useQuery(api.users.getAllUsers, canQuery ? {} : "skip");
  const subscriptions = useQuery(
    api.subscriptions.getAllSubscriptions,
    canQuery ? {} : "skip"
  );

  // Mutations
  const updateUser = useMutation(api.users.updateUser);

  // Build subscription lookup map by restaurantId
  const subscriptionMap = React.useMemo(() => {
    const map = new Map<string, { status: string; planId: string }>();
    if (subscriptions) {
      for (const sub of subscriptions) {
        map.set(sub.restaurantId, { status: sub.status, planId: sub.planId });
      }
    }
    return map;
  }, [subscriptions]);

  // Handle role change
  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await updateUser({
        userId,
        role: newRole as typeof ROLES[number],
      });
    } catch (err) {
      console.error("Failed to update user role:", err);
    }
  };

  // Handle deactivation (delete user)
  const handleDeactivate = async (userId: string) => {
    try {
      await updateUser({
        userId,
        role: "supervisor",
        tenantId: "",
      });
    } catch (err) {
      console.error("Failed to deactivate user:", err);
    }
  };

  // Redirect non-admins after hooks are called
  React.useEffect(() => {
    if (!userLoading && !isAdmin) {
      router.replace("/client/dashboard");
    }
  }, [userLoading, isAdmin, router]);

  if (userLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-700 border-t-emerald-500 mx-auto" />
          <p className="text-gray-400 text-sm">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  const dataLoading = restaurants === undefined || users === undefined;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push("/client/dashboard")}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                aria-label="Back to dashboard"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <h1 className="text-lg font-semibold text-white">Platform Admin</h1>
                <p className="text-sm text-gray-400">Manage restaurants and users</p>
              </div>
            </div>
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <div className="w-2 h-2 bg-emerald-500 rounded-full" />
              <span className="text-sm font-medium text-emerald-500">Admin</span>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="sticky top-16 z-40 bg-black border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-6">
            <button
              onClick={() => setActiveTab("restaurants")}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "restaurants"
                  ? "border-emerald-500 text-emerald-500"
                  : "border-transparent text-gray-400 hover:text-white hover:border-gray-700"
              }`}
              role="tab"
              aria-selected={activeTab === "restaurants"}
            >
              Restaurants ({restaurants?.length ?? 0})
            </button>
            <button
              onClick={() => setActiveTab("users")}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === "users"
                  ? "border-emerald-500 text-emerald-500"
                  : "border-transparent text-gray-400 hover:text-white hover:border-gray-700"
              }`}
              role="tab"
              aria-selected={activeTab === "users"}
            >
              Users ({users?.length ?? 0})
            </button>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {dataLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-700 border-t-emerald-500 mx-auto" />
              <p className="text-gray-400 text-sm">Loading data...</p>
            </div>
          </div>
        ) : activeTab === "restaurants" ? (
          <RestaurantTable restaurants={restaurants ?? []} subscriptionMap={subscriptionMap} />
        ) : (
          <UserTable
            users={(users ?? []).map((u: Doc<"users">) => ({
              userId: u.userId ?? "",
              email: u.email ?? "",
              role: u.role ?? "",
              tenantType: u.tenantType ?? "",
              tenantId: u.tenantId ?? "",
              lastLoginAt: u.lastLoginAt,
              _id: u._id,
            }))}
            onRoleChange={handleRoleChange}
            onDeactivate={handleDeactivate}
          />
        )}
      </main>
    </div>
  );
}

// ============================================================================
// Restaurant Table
// ============================================================================

interface RestaurantTableProps {
  restaurants: Array<{
    restaurantId: string;
    name: string;
    createdAt: number;
    _id: string;
  }>;
  subscriptionMap: Map<string, { status: string; planId: string }>;
}

function SubscriptionBadge({ status }: { status: string | undefined }) {
  if (!status) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-800 text-gray-400">
        No subscription
      </span>
    );
  }

  const styles: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    trialing: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
    past_due: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    cancelled: "bg-red-500/10 text-red-400 border border-red-500/20",
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? "bg-gray-800 text-gray-400"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function RestaurantTable({ restaurants, subscriptionMap }: RestaurantTableProps) {
  if (restaurants.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400">No restaurants found.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-6 py-4 text-gray-400 font-medium">Name</th>
              <th className="text-left px-6 py-4 text-gray-400 font-medium">Restaurant ID</th>
              <th className="text-left px-6 py-4 text-gray-400 font-medium">Created</th>
              <th className="text-left px-6 py-4 text-gray-400 font-medium">Subscription</th>
              <th className="text-left px-6 py-4 text-gray-400 font-medium">Plan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {restaurants.map((restaurant) => {
              const sub = subscriptionMap.get(restaurant.restaurantId);
              return (
                <tr key={restaurant._id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-6 py-4 text-white font-medium">{restaurant.name}</td>
                  <td className="px-6 py-4 text-gray-300 font-mono text-xs">{restaurant.restaurantId}</td>
                  <td className="px-6 py-4 text-gray-400">{formatDate(restaurant.createdAt)}</td>
                  <td className="px-6 py-4">
                    <SubscriptionBadge status={sub?.status} />
                  </td>
                  <td className="px-6 py-4 text-gray-400">{sub?.planId ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// User Table
// ============================================================================

interface UserTableProps {
  users: Array<{
    userId: string;
    email: string;
    role: string;
    tenantType: string;
    tenantId: string;
    lastLoginAt?: number;
    _id: string;
  }>;
  onRoleChange: (userId: string, newRole: string) => Promise<void>;
  onDeactivate: (userId: string) => Promise<void>;
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    platform_admin: "bg-purple-500/10 text-purple-400 border border-purple-500/20",
    restaurant_owner: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    business_owner: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
    branch_manager: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    supervisor: "bg-gray-700/50 text-gray-300 border border-gray-600",
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[role] ?? "bg-gray-800 text-gray-400"}`}>
      {role.replace(/_/g, " ")}
    </span>
  );
}

function UserTable({ users, onRoleChange, onDeactivate }: UserTableProps) {
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const { user: currentUser } = useCurrentUser();

  const handleRoleChange = async (userId: string, newRole: string) => {
    setChangingRole(userId);
    try {
      await onRoleChange(userId, newRole);
    } finally {
      setChangingRole(null);
    }
  };

  const handleDeactivate = async (userId: string) => {
    if (!confirm("Are you sure you want to deactivate this user? This will reset their role and remove their tenant access.")) {
      return;
    }
    setDeactivating(userId);
    try {
      await onDeactivate(userId);
    } finally {
      setDeactivating(null);
    }
  };

  if (users.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400">No users found.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-6 py-4 text-gray-400 font-medium">Email</th>
              <th className="text-left px-6 py-4 text-gray-400 font-medium">Role</th>
              <th className="text-left px-6 py-4 text-gray-400 font-medium">Tenant Type</th>
              <th className="text-left px-6 py-4 text-gray-400 font-medium">Tenant ID</th>
              <th className="text-left px-6 py-4 text-gray-400 font-medium">Last Login</th>
              <th className="text-left px-6 py-4 text-gray-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {users.map((u) => {
              const isSelf = currentUser?.userId === u.userId;
              return (
                <tr key={u._id} className="hover:bg-gray-800/50 transition-colors">
                  <td className="px-6 py-4 text-white">
                    {u.email}
                    {isSelf && (
                      <span className="ml-2 text-xs text-gray-500">(you)</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-6 py-4 text-gray-400">{u.tenantType}</td>
                  <td className="px-6 py-4 text-gray-300 font-mono text-xs">
                    {u.tenantId || "—"}
                  </td>
                  <td className="px-6 py-4 text-gray-400">{formatDateTime(u.lastLoginAt)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                      {/* Role change dropdown */}
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.userId, e.target.value)}
                        disabled={isSelf || changingRole === u.userId}
                        className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-2 py-1.5 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={`Change role for ${u.email}`}
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>

                      {/* Deactivate button */}
                      <button
                        onClick={() => handleDeactivate(u.userId)}
                        disabled={isSelf || deactivating === u.userId}
                        className="px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={`Deactivate ${u.email}`}
                        title="Deactivate user"
                      >
                        {deactivating === u.userId ? (
                          <span className="inline-flex items-center">
                            <svg className="animate-spin -ml-0.5 mr-1.5 h-3 w-3" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            ...
                          </span>
                        ) : (
                          "Deactivate"
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
