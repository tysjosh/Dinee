import React, { useState } from "react";
import { Order } from "@/types/global";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { useOrders, useCalls } from "@/contexts";
import {
  Clock,
  Phone,
  User,
  DollarSign,
  ShoppingBag,
  CheckCircle,
  XCircle,
  MessageSquare,
  Calendar,
  History,
  Eye,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export interface PastOrdersProps {
  className?: string;
}

const PastOrders: React.FC<PastOrdersProps> = ({ className }) => {
  const {
    state: { pastOrders, loading, error },
  } = useOrders();
  const {
    state: { calls },
  } = useCalls();
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

  const toggleOrderExpansion = (orderId: string) => {
    const newExpanded = new Set(expandedOrders);
    if (newExpanded.has(orderId)) {
      newExpanded.delete(orderId);
    } else {
      newExpanded.add(orderId);
    }
    setExpandedOrders(newExpanded);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const formatOrderTime = (timestamp: Date) => {
    return timestamp.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatOrderDate = (timestamp: Date) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (timestamp.toDateString() === today.toDateString()) {
      return "Today";
    } else if (timestamp.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    } else {
      return timestamp.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year:
          timestamp.getFullYear() !== today.getFullYear()
            ? "numeric"
            : undefined,
      });
    }
  };

  const handleAnalyzeCall = (order: Order) => {
    if (order.callId) {
      // Navigate to calls section with the specific call ID
      // This will be handled by the parent dashboard component
      const event = new CustomEvent("navigateToCall", {
        detail: { callId: order.callId },
      });
      window.dispatchEvent(event);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="bg-black border border-white/10 rounded-lg p-6 text-center">
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/20 border-t-emerald-500"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <History className="w-3 h-3 text-emerald-500" />
              </div>
            </div>
            <p className="text-white/70 text-sm">Loading order history...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-black border border-red-500/20 rounded-lg p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-red-500/10 rounded-lg flex items-center justify-center border border-red-500/20">
          <XCircle className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-base font-semibold text-white mb-2">
          Error Loading Orders
        </h3>
        <p className="text-white/70 text-sm">
          Unable to load order history: {error}
        </p>
      </div>
    );
  }

  if (pastOrders.length === 0) {
    return (
      <div className="bg-black border border-white/10 rounded-xl p-12">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
            <History className="w-10 h-10 text-white/60" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">
            No Order History Yet
          </h3>
          <p className="text-white/70 max-w-md mx-auto mb-6 leading-relaxed text-sm">
            Completed and cancelled orders will appear here. This helps you
            track your business&apos;s performance and customer satisfaction.
          </p>
          <div className="inline-flex items-center space-x-3 bg-emerald-500/10 px-6 py-3 rounded-lg border border-emerald-500/20">
            <CheckCircle className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400">
              Ready to track orders
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {pastOrders.map((order) => {
        const isCompleted = order.status === "completed";
        const isCancelled = order.status === "cancelled";
        const isExpanded = expandedOrders.has(order.id);

        return (
          <div
            key={order.id}
            className="bg-black border border-white/10 hover:border-white/20 transition-all duration-200 rounded-xl overflow-hidden"
          >
            <div className="bg-white/5 border-b border-white/10 p-6">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-3">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center border",
                        isCompleted
                          ? "bg-emerald-500/20 border-emerald-500/30"
                          : "bg-red-500/20 border-red-500/30"
                      )}
                    >
                      {isCompleted ? (
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-400" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-white">
                        Order #{order.publicOrderCode || order.id}
                      </h3>
                      <div className="flex items-center space-x-2 mt-1">
                        <Badge
                          variant={isCompleted ? "success" : "error"}
                          className={cn(
                            "px-2.5 py-1 text-xs font-medium",
                            isCompleted
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : "bg-red-500/20 text-red-400 border-red-500/30"
                          )}
                        >
                          {isCompleted ? (
                            <>
                              <CheckCircle className="w-3 h-3 mr-1.5" />
                              COMPLETED
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3 mr-1.5" />
                              CANCELLED
                            </>
                          )}
                        </Badge>
                        <div className="flex items-center space-x-1.5 text-white/60 text-xs">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>
                            {formatOrderDate(order.timestamp)} at{" "}
                            {formatOrderTime(order.timestamp)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <div className="text-right">
                    <div className="text-sm font-medium text-white">
                      {formatCurrency(order.totalAmount)}
                    </div>
                    <div className="text-xs text-white/60">
                      {order.items.length} item
                      {order.items.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleOrderExpansion(order.id)}
                    className="p-2 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-white/60" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-white/60" />
                    )}
                  </button>
                </div>
              </div>

              {/* Basic Info - Always Visible */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div className="flex items-center space-x-2">
                  <User className="w-3.5 h-3.5 text-white/60" />
                  <span className="text-xs text-white/60">Customer:</span>
                  <span className="font-medium text-white text-xs">
                    {order.customerName}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <Phone className="w-3.5 h-3.5 text-white/60" />
                  <span className="text-xs text-white/60">Phone:</span>
                  <span className="font-medium text-white text-xs">
                    {order.phoneNumber && order.phoneNumber !== "Unknown"
                      ? order.phoneNumber
                      : "Not Available"}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <ShoppingBag className="w-3.5 h-3.5 text-white/60" />
                  <span className="text-xs text-white/60">Items:</span>
                  <span className="font-medium text-white text-xs">
                    {order.items
                      .slice(0, 2)
                      .map((item) => `${item.quantity}x ${item.name}`)
                      .join(", ")}
                    {order.items.length > 2 &&
                      ` +${order.items.length - 2} more`}
                  </span>
                </div>
              </div>
            </div>

            {isExpanded && (
              <div className="p-6">
                <div className="space-y-6">
                  {/* Cancellation Reason */}
                  {isCancelled && order.cancellationReason && (
                    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                      <div className="flex items-center space-x-2 mb-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                        <span className="font-medium text-red-400 text-xs">
                          Cancellation Reason
                        </span>
                      </div>
                      <p className="text-red-300 text-sm">
                        {order.cancellationReason}
                      </p>
                    </div>
                  )}

                  {/* Order Items */}
                  <div>
                    <div className="flex items-center space-x-2 mb-4">
                      <ShoppingBag className="w-4 h-4 text-white/60" />
                      <h4 className="text-sm font-medium text-white">
                        Order Items
                      </h4>
                    </div>
                    <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                      <div className="space-y-3">
                        {order.items.slice(0, 1).map((item, index) => (
                          <div
                            key={index}
                            className="flex justify-between items-center py-2"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-6 h-6 bg-white/10 rounded flex items-center justify-center border border-gray-600 font-medium text-xs text-white">
                                {item.quantity}
                              </div>
                              <div>
                                <p className="font-medium text-white text-sm">
                                  {item.name}
                                </p>
                                {item.specialInstructions && (
                                  <p className="text-xs text-white/60 mt-1">
                                    Note: {item.specialInstructions}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-medium text-white text-sm">
                                {formatCurrency(item.price * item.quantity)}
                              </p>
                              <p className="text-xs text-white/60">
                                {formatCurrency(item.price)} each
                              </p>
                            </div>
                          </div>
                        ))}
                        <div className="flex justify-between items-center pt-3 mt-3 border-t border-white/10">
                          <span className="text-sm font-medium text-white">
                            Total:
                          </span>
                          <span
                            className={cn(
                              "text-sm font-medium",
                              isCompleted ? "text-emerald-400" : "text-white/60"
                            )}
                          >
                            {formatCurrency(order.totalAmount)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Special Instructions */}
                  {order.specialInstructions && (
                    <div>
                      <div className="flex items-center space-x-2 mb-3">
                        <MessageSquare className="w-4 h-4 text-white/60" />
                        <h4 className="text-sm font-medium text-white">
                          Special Instructions
                        </h4>
                      </div>
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                        <p className="text-amber-300 font-medium text-sm">
                          {order.specialInstructions}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Action Button */}
                  {order.callId && (
                    <div className="pt-3 border-t border-gray-700">
                      <button
                        className="bg-white/5 border border-gray-600 text-white hover:bg-white/10 hover:border-gray-500 px-3 py-1.5 rounded-lg flex items-center justify-center space-x-1.5 text-xs font-medium transition-all duration-200 cursor-pointer"
                        onClick={() => handleAnalyzeCall(order)}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View Call Details</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PastOrders;
