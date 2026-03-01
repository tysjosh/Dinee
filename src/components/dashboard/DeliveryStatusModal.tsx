import React, { useState } from "react";
import { Order } from "@/types/global";
import { cn } from "@/lib/utils";
import {
  X,
  Truck,
  User,
  MapPin,
  Clock,
  CheckCircle,
  XCircle,
  Package,
  Navigation,
} from "lucide-react";

export interface DeliveryStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onUpdateStatus: (
    orderId: string,
    status: "assigned" | "dispatched" | "in_transit" | "delivered" | "failed",
    riderName?: string,
    riderId?: string,
    failureReason?: string
  ) => Promise<void>;
}

type DeliveryStatus = "pending" | "assigned" | "dispatched" | "in_transit" | "delivered" | "failed";

const DELIVERY_STATUSES: { value: DeliveryStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "pending", label: "Pending", icon: <Clock className="w-4 h-4" />, color: "text-white/60" },
  { value: "assigned", label: "Rider Assigned", icon: <User className="w-4 h-4" />, color: "text-blue-400" },
  { value: "dispatched", label: "Dispatched", icon: <Package className="w-4 h-4" />, color: "text-amber-400" },
  { value: "in_transit", label: "In Transit", icon: <Navigation className="w-4 h-4" />, color: "text-purple-400" },
  { value: "delivered", label: "Delivered", icon: <CheckCircle className="w-4 h-4" />, color: "text-emerald-400" },
  { value: "failed", label: "Failed", icon: <XCircle className="w-4 h-4" />, color: "text-red-400" },
];

const DeliveryStatusModal: React.FC<DeliveryStatusModalProps> = ({
  isOpen,
  onClose,
  order,
  onUpdateStatus,
}) => {
  const [selectedStatus, setSelectedStatus] = useState<DeliveryStatus | null>(null);
  const [riderName, setRiderName] = useState("");
  const [riderId, setRiderId] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !order) return null;

  const currentStatus = (order.deliveryStatus as DeliveryStatus) || "pending";

  const handleStatusSelect = (status: DeliveryStatus) => {
    setSelectedStatus(status);
    setError(null);
    
    // Pre-fill rider info if already assigned
    if (status !== "assigned" && order.riderName) {
      setRiderName(order.riderName);
    }
    if (status !== "assigned" && order.riderId) {
      setRiderId(order.riderId);
    }
  };

  const handleSubmit = async () => {
    if (!selectedStatus) {
      setError("Please select a status");
      return;
    }

    // Validate rider info for assigned status
    if (selectedStatus === "assigned" && !riderName.trim()) {
      setError("Please enter rider name");
      return;
    }

    // Validate failure reason
    if (selectedStatus === "failed" && !failureReason.trim()) {
      setError("Please enter failure reason");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onUpdateStatus(
        order.id,
        selectedStatus as "assigned" | "dispatched" | "in_transit" | "delivered" | "failed",
        riderName.trim() || undefined,
        riderId.trim() || undefined,
        selectedStatus === "failed" ? failureReason.trim() : undefined
      );
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedStatus(null);
    setRiderName("");
    setRiderId("");
    setFailureReason("");
    setError(null);
    onClose();
  };

  const getStatusIndex = (status: DeliveryStatus) => {
    return DELIVERY_STATUSES.findIndex(s => s.value === status);
  };

  const canTransitionTo = (targetStatus: DeliveryStatus): boolean => {
    const currentIndex = getStatusIndex(currentStatus);
    const targetIndex = getStatusIndex(targetStatus);
    
    // Can always mark as failed
    if (targetStatus === "failed") return currentStatus !== "delivered" && currentStatus !== "failed";
    
    // Can only move forward in the flow (or stay same)
    return targetIndex > currentIndex;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      <div className="relative bg-black border border-white/10 rounded-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center border border-purple-500/30">
              <Truck className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Delivery Status</h2>
              <p className="text-sm text-white/60">Order #{order.id}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-white/60" />
          </button>
        </div>

        {/* Current Status */}
        <div className="p-6 border-b border-white/10">
          <div className="text-sm text-white/60 mb-2">Current Status</div>
          <div className="flex items-center space-x-3">
            {DELIVERY_STATUSES.find(s => s.value === currentStatus)?.icon}
            <span className={cn(
              "font-medium",
              DELIVERY_STATUSES.find(s => s.value === currentStatus)?.color
            )}>
              {DELIVERY_STATUSES.find(s => s.value === currentStatus)?.label}
            </span>
            {order.riderName && (
              <span className="text-white/60 text-sm">
                • Rider: {order.riderName}
              </span>
            )}
          </div>
        </div>

        {/* Status Selection */}
        <div className="p-6 space-y-4">
          <div className="text-sm text-white/60 mb-3">Update Status</div>
          
          <div className="grid grid-cols-2 gap-3">
            {DELIVERY_STATUSES.filter(s => s.value !== "pending").map((status) => {
              const isDisabled = !canTransitionTo(status.value);
              const isSelected = selectedStatus === status.value;
              
              return (
                <button
                  key={status.value}
                  onClick={() => !isDisabled && handleStatusSelect(status.value)}
                  disabled={isDisabled}
                  className={cn(
                    "p-4 rounded-lg border transition-all text-left",
                    isDisabled
                      ? "opacity-40 cursor-not-allowed bg-white/5 border-white/5"
                      : isSelected
                        ? "bg-white/10 border-white/30"
                        : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 cursor-pointer"
                  )}
                >
                  <div className={cn("flex items-center space-x-2 mb-1", status.color)}>
                    {status.icon}
                    <span className="font-medium text-sm">{status.label}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Rider Info (for assigned status) */}
          {selectedStatus === "assigned" && (
            <div className="space-y-3 pt-4 border-t border-white/10">
              <div>
                <label className="block text-sm text-white/60 mb-2">
                  Rider Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={riderName}
                  onChange={(e) => setRiderName(e.target.value)}
                  placeholder="Enter rider name"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="block text-sm text-white/60 mb-2">
                  Rider ID (optional)
                </label>
                <input
                  type="text"
                  value={riderId}
                  onChange={(e) => setRiderId(e.target.value)}
                  placeholder="Enter rider ID"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-white/30"
                />
              </div>
            </div>
          )}

          {/* Failure Reason (for failed status) */}
          {selectedStatus === "failed" && (
            <div className="pt-4 border-t border-white/10">
              <label className="block text-sm text-white/60 mb-2">
                Failure Reason <span className="text-red-400">*</span>
              </label>
              <textarea
                value={failureReason}
                onChange={(e) => setFailureReason(e.target.value)}
                placeholder="Enter reason for delivery failure"
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-white/30 resize-none"
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-white/10">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-white/5 border border-white/10 text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedStatus || isSubmitting}
            className={cn(
              "px-4 py-2 rounded-lg font-medium transition-colors",
              selectedStatus && !isSubmitting
                ? "bg-purple-500 text-white hover:bg-purple-600"
                : "bg-white/10 text-white/40 cursor-not-allowed"
            )}
          >
            {isSubmitting ? "Updating..." : "Update Status"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeliveryStatusModal;
