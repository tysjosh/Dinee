"use client";

import React, { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import ConfirmationModal from "@/components/ui/ConfirmationModal";

interface PhoneNumberManagementProps {
  branchId: string;
  restaurantId: string;
}

/** Format E.164 number for display */
function formatPhoneNumber(e164: string): string {
  if (e164.startsWith("+1") && e164.length === 12) {
    const area = e164.slice(2, 5);
    const prefix = e164.slice(5, 8);
    const line = e164.slice(8, 12);
    return `(${area}) ${prefix}-${line}`;
  }
  if (e164.startsWith("+234") && e164.length >= 13) {
    return `+234 ${e164.slice(4, 7)} ${e164.slice(7, 10)} ${e164.slice(10)}`;
  }
  return e164;
}

/**
 * Dashboard settings card for managing a branch's phone number.
 *
 * - Displays assigned number, provider, status, health, monthly cost
 * - Health warning badges for degraded / unreachable
 * - "Request Replacement" with confirmation dialog
 * - Shared-number fallback with "Request Dedicated Number" button
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 11.4, 11.5
 */
const PhoneNumberManagement: React.FC<PhoneNumberManagementProps> = ({
  branchId,
  restaurantId,
}) => {
  const SHARED_NUMBER =
    process.env.NEXT_PUBLIC_VIRTUAL_NUMBER || "(555) 123-4567";

  const phoneNumber = useQuery(
    api.phoneProvisioning.queries.getPhoneNumberByBranch,
    { branchId }
  );
  const requestReplacement = useMutation(
    api.phoneProvisioning.mutations.requestReplacement
  );
  const initiateProvisioning = useMutation(
    api.phoneProvisioning.mutations.initiateProvisioning
  );

  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const hasDedicatedNumber =
    phoneNumber != null && phoneNumber.status === "assigned";

  const handleRequestReplacement = async () => {
    setReplacing(true);
    setMessage(null);
    try {
      const result = await requestReplacement({ branchId });
      if (result.success) {
        setMessage({
          type: "success",
          text: result.newPhoneNumber
            ? `New number assigned: ${formatPhoneNumber(result.newPhoneNumber)}`
            : "Replacement requested. A new number will be assigned shortly.",
        });
      } else {
        setMessage({
          type: "error",
          text: result.message ?? "Failed to request replacement.",
        });
      }
    } catch {
      setMessage({
        type: "error",
        text: "Failed to request replacement. Please try again.",
      });
    } finally {
      setReplacing(false);
      setShowReplaceModal(false);
    }
  };

  const handleRequestDedicated = async () => {
    setProvisioning(true);
    setMessage(null);
    try {
      const result = await initiateProvisioning({
        branchId,
        region: "default",
        countryCode: "US",
      });
      if (result.success) {
        setMessage({
          type: "success",
          text: result.phoneNumber
            ? `Dedicated number assigned: ${formatPhoneNumber(result.phoneNumber)}`
            : "Provisioning started. A dedicated number will be assigned shortly.",
        });
      } else {
        setMessage({
          type: "error",
          text: result.message ?? "Failed to request dedicated number.",
        });
      }
    } catch {
      setMessage({
        type: "error",
        text: "Failed to request dedicated number. Please try again.",
      });
    } finally {
      setProvisioning(false);
    }
  };

  // Loading state while query resolves
  if (phoneNumber === undefined) {
    return (
      <div className="card-minimal rounded-xl">
        <div className="bg-white/5 border-b border-white/10 px-4 sm:px-6 py-4">
          <h2 className="text-base font-semibold text-white">Phone Number</h2>
          <p className="text-sm text-white/70 mt-1">
            Manage your branch&apos;s phone number.
          </p>
        </div>
        <div className="px-4 sm:px-6 py-4 sm:py-6 flex items-center justify-center">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-white/20 border-t-emerald-500" />
          <span className="ml-3 text-sm text-white/60">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card-minimal rounded-xl">
      <div className="bg-white/5 border-b border-white/10 px-4 sm:px-6 py-4">
        <h2 className="text-base font-semibold text-white">Phone Number</h2>
        <p className="text-sm text-white/70 mt-1">
          {hasDedicatedNumber
            ? "Your branch's dedicated phone number."
            : "Phone number configuration for your branch."}
        </p>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        {/* Feedback message */}
        {message && (
          <div
            className={`px-4 py-3 rounded-lg text-sm ${
              message.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                : "bg-red-500/10 border border-red-500/20 text-red-400"
            }`}
            role="status"
            aria-live="polite"
          >
            {message.text}
          </div>
        )}

        {hasDedicatedNumber ? (
          /* ── Dedicated number view ── */
          <>
            {/* Number display */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs text-white/50 mb-1">Assigned Number</p>
                <p className="text-lg font-mono text-white">
                  {formatPhoneNumber(phoneNumber.phoneNumber)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {/* Status badge */}
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {phoneNumber.status}
                </span>

                {/* Health badge — Req 10.2 */}
                {phoneNumber.healthStatus === "healthy" && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Healthy
                  </span>
                )}
                {phoneNumber.healthStatus === "degraded" && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                    Degraded
                  </span>
                )}
                {phoneNumber.healthStatus === "unreachable" && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                    Unreachable
                  </span>
                )}
              </div>
            </div>

            {/* Health warning descriptions — Req 10.2 */}
            {phoneNumber.healthStatus === "degraded" && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-3 text-sm text-yellow-300">
                This number has a webhook misconfiguration but is still active. Calls may not route correctly.
              </div>
            )}
            {phoneNumber.healthStatus === "unreachable" && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-300">
                This number is unreachable at the provider. Customers may not be able to reach you. Consider requesting a replacement.
              </div>
            )}

            {/* Details grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div>
                <p className="text-xs text-white/50 mb-1">Provider</p>
                <p className="text-sm text-white capitalize">
                  {phoneNumber.provider}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/50 mb-1">Monthly Cost</p>
                <p className="text-sm text-white">
                  {phoneNumber.monthlyCost != null
                    ? `${phoneNumber.monthlyCost.toFixed(2)} ${phoneNumber.currency ?? "USD"}`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/50 mb-1">Region</p>
                <p className="text-sm text-white capitalize">
                  {phoneNumber.region}
                </p>
              </div>
            </div>

            {/* Request Replacement — Req 10.3 */}
            <div className="pt-2">
              <button
                onClick={() => setShowReplaceModal(true)}
                disabled={replacing}
                className="btn-minimal text-sm px-4 py-2 rounded-lg text-white/70 hover:text-white border border-white/10 hover:border-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Request Replacement
              </button>
            </div>
          </>
        ) : (
          /* ── Shared number fallback — Req 10.5, 11.5 ── */
          <>
            <div className="text-center py-4 space-y-3">
              <div className="w-10 h-10 mx-auto bg-white/5 rounded-full flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-white/40"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
              </div>
              <p className="text-sm text-white/60">
                No dedicated number assigned. Using shared number.
              </p>
              <div>
                <p className="text-xs text-white/50 mb-1">Shared Number</p>
                <p className="text-lg font-mono text-white">{SHARED_NUMBER}</p>
              </div>
              <p className="text-xs text-white/50">
                Customers call this number and provide Business ID:{" "}
                <span className="font-mono text-emerald-400">
                  {restaurantId}
                </span>
              </p>
            </div>

            {/* Request Dedicated Number — Req 10.5 */}
            <div className="text-center pt-2">
              <button
                onClick={handleRequestDedicated}
                disabled={provisioning}
                className="btn-minimal btn-primary-minimal text-sm px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {provisioning ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-emerald-500/30 border-t-emerald-500" />
                    Requesting...
                  </span>
                ) : (
                  "Request Dedicated Number"
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Replacement confirmation dialog — Req 10.4 */}
      <ConfirmationModal
        isOpen={showReplaceModal}
        onClose={() => setShowReplaceModal(false)}
        onConfirm={handleRequestReplacement}
        title="Replace Phone Number"
        message="Your current number will enter a 30-day quarantine period. During quarantine, customers calling the old number will hear a disconnection message. A new number will be provisioned for your branch."
        confirmText="Replace Number"
        cancelText="Keep Current"
        variant="warning"
        loading={replacing}
      />
    </div>
  );
};

export default PhoneNumberManagement;
