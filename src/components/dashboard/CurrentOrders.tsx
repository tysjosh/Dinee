import React, { useState, useEffect, useCallback } from "react";
import { Order } from "@/types/global";
import Badge from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import CallbackModal from "./CallbackModal";
import OrderCancellationModal from "./OrderCancellationModal";
import CODPaymentModal from "./CODPaymentModal";
import WhatsAppOptInModal from "./WhatsAppOptInModal";
import DeliveryStatusModal from "./DeliveryStatusModal";
import { useOrders } from "@/contexts";
import { useMutation, useConvex } from "convex/react";
import { api } from "../../../convex/_generated/api";
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
  ChefHat,
  ChevronDown,
  ChevronUp,
  Banknote,
  Bell,
  Truck,
  Package,
  Navigation,
} from "lucide-react";

export interface CurrentOrdersProps {
  className?: string;
}

const CurrentOrders: React.FC<CurrentOrdersProps> = ({ className }) => {
  const {
    state: { activeOrders: currentOrders, loading, error },
    actions,
  } = useOrders();
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [callbackModalOpen, setCallbackModalOpen] = useState(false);
  const [cancellationModalOpen, setCancellationModalOpen] = useState(false);
  const [codPaymentModalOpen, setCodPaymentModalOpen] = useState(false);
  const [whatsappOptInModalOpen, setWhatsappOptInModalOpen] = useState(false);
  const [deliveryStatusModalOpen, setDeliveryStatusModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  
  // Track which phone numbers we've already checked/prompted for opt-in
  const [checkedPhoneNumbers, setCheckedPhoneNumbers] = useState<Set<string>>(new Set());
  // Track orders that need opt-in prompt (first-time customers)
  const [ordersNeedingOptIn, setOrdersNeedingOptIn] = useState<Set<string>>(new Set());

  // Convex client for imperative queries
  const convex = useConvex();

  // Convex mutations for COD payment
  const recordCODPaymentMutation = useMutation(api.orders.recordCODPaymentCollection);
  const recordCODPaymentFailureMutation = useMutation(api.orders.recordCODPaymentFailure);
  
  // Convex mutation for customer preferences (WhatsApp opt-in)
  const upsertPreferencesMutation = useMutation(api.customerPreferences.upsertPreferences);

  // Convex mutation for delivery status updates
  const updateDeliveryStatusMutation = useMutation(api.orders.updateDeliveryStatus);

  /**
   * Check if customer has existing preferences when orders load
   * Requirement 13.2: Prompt for WhatsApp opt-in on first order
   */
  useEffect(() => {
    const checkCustomerPreferences = async () => {
      for (const order of currentOrders) {
        const phoneNumber = order.phoneNumber;
        
        // Skip if no valid phone number or already checked
        if (!phoneNumber || phoneNumber === "Unknown" || checkedPhoneNumbers.has(phoneNumber)) {
          continue;
        }

        // Skip if order already has whatsappOptIn set (preference already recorded)
        if (order.whatsappOptIn !== undefined) {
          setCheckedPhoneNumbers(prev => new Set(prev).add(phoneNumber));
          continue;
        }

        // Mark as checked to avoid duplicate API calls
        setCheckedPhoneNumbers(prev => new Set(prev).add(phoneNumber));

        try {
          // Check if customer has existing preferences in the database
          const preferences = await convex.query(api.customerPreferences.getByPhoneNumber, {
            phoneNumber,
          });

          // If no preferences exist, this is a first-time customer - show opt-in prompt
          if (preferences === null) {
            setOrdersNeedingOptIn(prev => new Set(prev).add(order.id));
          }
        } catch (error) {
          console.error("Error checking customer preferences:", error);
          // On error, still show the opt-in prompt to be safe
          setOrdersNeedingOptIn(prev => new Set(prev).add(order.id));
        }
      }
    };

    if (currentOrders.length > 0) {
      checkCustomerPreferences();
    }
  }, [currentOrders, checkedPhoneNumbers, convex]);

  /**
   * Handle WhatsApp opt-in prompt for an order
   * Shows the opt-in modal for first-time customers
   */
  const handleWhatsAppOptIn = (order: Order) => {
    setSelectedOrder(order);
    setWhatsappOptInModalOpen(true);
  };

  /**
   * Handle WhatsApp opt-in confirmation
   * Stores preference in customerPreferences table and updates order
   * Requirement 13.2: Store preference in customerPreferences table
   */
  const handleWhatsAppOptInConfirmed = async (orderId: string, phoneNumber: string, optIn: boolean) => {
    try {
      actions.setLoading(true);
      
      // Store preference in customerPreferences table
      await upsertPreferencesMutation({
        phoneNumber,
        whatsappOptIn: optIn,
        smsOptIn: false, // Default SMS opt-in to false
      });

      // Remove from orders needing opt-in
      setOrdersNeedingOptIn(prev => {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        return newSet;
      });

      // Update local order state to reflect the opt-in choice
      const updatedOrder = currentOrders.find(o => o.id === orderId);
      if (updatedOrder) {
        actions.updateOrder({
          ...updatedOrder,
          whatsappOptIn: optIn,
        });
      }

    } catch (error) {
      console.error("Failed to save WhatsApp preference:", error);
      actions.setError("Failed to save notification preference");
      throw error;
    } finally {
      actions.setLoading(false);
    }
  };

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
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
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

  const handleCallback = (order: Order) => {
    setSelectedOrder(order);
    setCallbackModalOpen(true);
  };

  const handleCancelOrder = (order: Order) => {
    setSelectedOrder(order);
    setCancellationModalOpen(true);
  };

  /**
   * Handle opening delivery status modal
   */
  const handleDeliveryStatus = (order: Order) => {
    setSelectedOrder(order);
    setDeliveryStatusModalOpen(true);
  };

  /**
   * Handle delivery status update
   * Updates the delivery status in the database
   */
  const handleDeliveryStatusUpdate = async (
    orderId: string,
    status: "assigned" | "dispatched" | "in_transit" | "delivered" | "failed",
    riderName?: string,
    riderId?: string,
    failureReason?: string
  ) => {
    try {
      actions.setLoading(true);
      
      // Find the order to get restaurantId
      const order = currentOrders.find(o => o.id === orderId);
      if (!order?.restaurantId) {
        throw new Error("Order or restaurantId not found");
      }

      await updateDeliveryStatusMutation({
        orderId,
        restaurantId: order.restaurantId,
        deliveryStatus: status,
        riderId,
        riderName,
        deliveryFailureReason: failureReason,
        sendStatusMessage: true,
      });

      // Update local state
      const updatedOrder = currentOrders.find(o => o.id === orderId);
      if (updatedOrder) {
        actions.updateOrder({
          ...updatedOrder,
          deliveryStatus: status,
          riderId,
          riderName,
        });
      }
    } catch (error) {
      console.error("Failed to update delivery status:", error);
      actions.setError("Failed to update delivery status");
      throw error;
    } finally {
      actions.setLoading(false);
    }
  };

  /**
   * Handle marking an order as complete
   * For COD orders, show the payment collection modal first (Requirement 10.3)
   * For non-COD orders, complete directly
   */
  const handleCompleteOrder = (order: Order) => {
    if (order.paymentMethod === "cod" && order.paymentStatus !== "paid") {
      // COD order - show payment collection modal
      setSelectedOrder(order);
      setCodPaymentModalOpen(true);
    } else {
      // Non-COD order or already paid - complete directly
      actions.completeOrder(order.id);
    }
  };

  /**
   * Handle COD payment confirmation (Requirement 10.4)
   * Updates paymentStatus to "paid" and completes the order
   */
  const handleCODPaymentConfirmed = async (orderId: string) => {
    try {
      actions.setLoading(true);
      // Find the order to get restaurantId
      const order = currentOrders.find(o => o.id === orderId);
      if (!order?.restaurantId) {
        throw new Error("Order or restaurantId not found");
      }
      // Record the COD payment collection
      await recordCODPaymentMutation({
        orderId,
        restaurantId: order.restaurantId,
        collectedBy: "staff", // In a real app, this would be the logged-in user
      });
      // Complete the order
      await actions.completeOrder(orderId);
    } catch (error) {
      console.error("Failed to record COD payment:", error);
      actions.setError("Failed to record payment collection");
    } finally {
      actions.setLoading(false);
    }
  };

  /**
   * Handle COD payment failure (Requirement 10.5)
   * Marks paymentStatus as "payment_failed" with a reason
   */
  const handleCODPaymentFailed = async (orderId: string, reason: string) => {
    try {
      actions.setLoading(true);
      // Find the order to get restaurantId
      const order = currentOrders.find(o => o.id === orderId);
      if (!order?.restaurantId) {
        throw new Error("Order or restaurantId not found");
      }
      // Record the payment failure
      await recordCODPaymentFailureMutation({
        orderId,
        restaurantId: order.restaurantId,
        failureReason: reason,
      });
      // Note: We don't complete the order when payment fails
      // The order remains active for follow-up
    } catch (error) {
      console.error("Failed to record payment failure:", error);
      actions.setError("Failed to record payment failure");
    } finally {
      actions.setLoading(false);
    }
  };

  const handleCallbackConfirm = async (orderId: string, reason: string) => {
    try {
      actions.setLoading(true);
      // In a real app, this would make an API call
      console.log("Callback confirmed for order:", orderId, "Reason:", reason);
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const displayOrder = selectedOrder?.publicOrderCode || orderId;
      alert(`Callback initiated for Order #${displayOrder}`);
    } catch (error) {
      actions.setError("Failed to initiate callback");
    } finally {
      actions.setLoading(false);
    }
  };

  const handleCancellationConfirm = async (
    orderId: string,
    shouldCallCustomer: boolean,
    reason?: string
  ) => {
    try {
      actions.setLoading(true);

      // Update the order status using the context
      if (reason) {
        actions.cancelOrder(orderId, reason);
      } else {
        actions.cancelOrder(orderId, "Order cancelled by restaurant");
      }

      if (shouldCallCustomer && reason) {
        const displayOrder = selectedOrder?.publicOrderCode || orderId;
        alert(
          `Order #${displayOrder} cancelled. Customer will be called with reason: ${reason}`
        );
      } else {
        const displayOrder = selectedOrder?.publicOrderCode || orderId;
        alert(`Order #${displayOrder} cancelled without customer notification.`);
      }
    } catch (error) {
      actions.setError("Failed to cancel order");
    } finally {
      actions.setLoading(false);
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
                <ShoppingBag className="w-3 h-3 text-emerald-500" />
              </div>
            </div>
            <p className="text-white/70 text-sm">Loading current orders...</p>
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
          Unable to load current orders: {error}
        </p>
      </div>
    );
  }

  if (currentOrders.length === 0) {
    return (
      <div className="bg-black border border-white/10 rounded-xl p-12">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
            <ShoppingBag className="w-10 h-10 text-white/60" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">
            No Active Orders
          </h3>
          <p className="text-white/70 max-w-md mx-auto mb-6 leading-relaxed text-sm">
            When customers place orders through calls, they&apos;ll appear here
            for you to manage and fulfill.
          </p>
          <div className="inline-flex items-center space-x-3 bg-emerald-500/10 px-6 py-3 rounded-lg border border-emerald-500/20">
            <ChefHat className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400">
              Ready to receive orders
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {currentOrders.map((order) => {
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
                    <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center border border-emerald-500/30">
                      <ShoppingBag className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-white">
                        Order #{order.publicOrderCode || order.id}
                      </h3>
                      <div className="flex items-center space-x-2 mt-1">
                        <Badge
                          variant="success"
                          className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 px-2.5 py-1 text-xs font-medium"
                        >
                          <CheckCircle className="w-3 h-3 mr-1.5" />
                          ACTIVE
                        </Badge>
                        {/* COD Badge Indicator - Requirement 10.2 */}
                        {order.paymentMethod === "cod" && (
                          <Badge
                            variant="warning"
                            className="bg-amber-500/20 text-amber-400 border-amber-500/30 px-2.5 py-1 text-xs font-medium"
                          >
                            <Banknote className="w-3 h-3 mr-1.5" />
                            COD
                            {order.paymentStatus === "paid" && " - PAID"}
                            {order.paymentStatus === "failed" && " - FAILED"}
                          </Badge>
                        )}
                        {/* Payment Status Badge for non-COD orders */}
                        {order.paymentMethod && order.paymentMethod !== "cod" && (
                          <Badge
                            variant={order.paymentStatus === "paid" ? "success" : "info"}
                            className={cn(
                              "px-2.5 py-1 text-xs font-medium",
                              order.paymentStatus === "paid"
                                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                            )}
                          >
                            {order.paymentMethod.toUpperCase()}
                            {order.paymentStatus === "paid" && " - PAID"}
                          </Badge>
                        )}
                        {/* Delivery Status Badge */}
                        {order.deliveryStatus && order.deliveryStatus !== "pending" && (
                          <Badge
                            variant={
                              order.deliveryStatus === "delivered" ? "success" :
                              order.deliveryStatus === "failed" ? "error" :
                              "info"
                            }
                            className={cn(
                              "px-2.5 py-1 text-xs font-medium",
                              order.deliveryStatus === "delivered"
                                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                : order.deliveryStatus === "failed"
                                  ? "bg-red-500/20 text-red-400 border-red-500/30"
                                  : order.deliveryStatus === "in_transit"
                                    ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                                    : order.deliveryStatus === "dispatched"
                                      ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                      : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                            )}
                          >
                            {order.deliveryStatus === "assigned" && <User className="w-3 h-3 mr-1.5" />}
                            {order.deliveryStatus === "dispatched" && <Package className="w-3 h-3 mr-1.5" />}
                            {order.deliveryStatus === "in_transit" && <Navigation className="w-3 h-3 mr-1.5" />}
                            {order.deliveryStatus === "delivered" && <CheckCircle className="w-3 h-3 mr-1.5" />}
                            {order.deliveryStatus === "failed" && <XCircle className="w-3 h-3 mr-1.5" />}
                            {order.deliveryStatus.replace("_", " ").toUpperCase()}
                            {order.riderName && ` - ${order.riderName}`}
                          </Badge>
                        )}
                        <div className="flex items-center space-x-1.5 text-white/60 text-xs">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{formatOrderTime(order.timestamp)}</span>
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                  <div className="flex items-center space-x-1.5 mb-1.5">
                    <User className="w-3.5 h-3.5 text-white/60" />
                    <span className="font-medium text-white/60 text-xs">
                      Customer
                    </span>
                  </div>
                  <div className="text-sm font-medium text-white">
                    {order.customerName}
                  </div>
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                  <div className="flex items-center space-x-1.5 mb-1.5">
                    <Phone className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-medium text-emerald-400 text-xs">
                      Phone
                    </span>
                  </div>
                  <div className="text-sm font-medium text-emerald-400">
                    {order.phoneNumber && order.phoneNumber !== "Unknown"
                      ? order.phoneNumber
                      : "Not Available"}
                  </div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                  <div className="flex items-center space-x-1.5 mb-1.5">
                    <ShoppingBag className="w-3.5 h-3.5 text-white/60" />
                    <span className="font-medium text-white/60 text-xs">
                      Items
                    </span>
                  </div>
                  <div className="text-sm font-medium text-white">
                    {order.items
                      .slice(0, 2)
                      .map((item) => `${item.quantity}x ${item.name}`)
                      .join(", ")}
                    {order.items.length > 2 &&
                      ` +${order.items.length - 2} more`}
                  </div>
                </div>
              </div>
            </div>

            {isExpanded && (
              <div className="p-6">
                <div className="space-y-6">
                  {/* Order Items */}
                  <div>
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="p-1.5 bg-white/5 rounded-lg border border-white/10">
                        <ShoppingBag className="w-3.5 h-3.5 text-white" />
                      </div>
                      <h4 className="text-sm font-medium text-white">
                        Order Items
                      </h4>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                      <div className="space-y-3">
                        {order.items.map((item, index) => (
                          <div
                            key={index}
                            className="flex justify-between items-center py-2"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-6 h-6 bg-white/10 rounded-md flex items-center justify-center border border-white/10 font-medium text-xs text-white">
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
                          <span className="text-sm font-medium text-emerald-400">
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
                        <div className="p-1.5 bg-white/5 rounded-lg border border-white/10">
                          <MessageSquare className="w-3.5 h-3.5 text-white" />
                        </div>
                        <h4 className="text-sm font-medium text-white">
                          Special Instructions
                        </h4>
                      </div>
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
                        <p className="text-emerald-400 font-medium text-sm">
                          {order.specialInstructions}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-white/10">
                    <button
                      className="bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg flex items-center justify-center space-x-1.5 text-xs font-medium transition-all duration-200 cursor-pointer"
                      onClick={() => handleCallback(order)}
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call Customer</span>
                    </button>
                    {/* Delivery Status Button */}
                    <button
                      className="bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 hover:border-purple-500/30 px-3 py-1.5 rounded-lg flex items-center justify-center space-x-1.5 text-xs font-medium transition-all duration-200 cursor-pointer"
                      onClick={() => handleDeliveryStatus(order)}
                    >
                      <Truck className="w-3.5 h-3.5" />
                      <span>
                        {order.deliveryStatus && order.deliveryStatus !== "pending"
                          ? "Update Delivery"
                          : "Manage Delivery"}
                      </span>
                    </button>
                    {/* WhatsApp Opt-In Button - Requirement 13.2: Prompt for opt-in on first order */}
                    {ordersNeedingOptIn.has(order.id) && order.whatsappOptIn === undefined && (
                      <button
                        className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/30 px-3 py-1.5 rounded-lg flex items-center justify-center space-x-1.5 text-xs font-medium transition-all duration-200 cursor-pointer"
                        onClick={() => handleWhatsAppOptIn(order)}
                      >
                        <Bell className="w-3.5 h-3.5" />
                        <span>Set WhatsApp Notifications</span>
                      </button>
                    )}
                    {/* WhatsApp Status Badge - Show if preference is already set */}
                    {order.whatsappOptIn !== undefined && (
                      <div className={cn(
                        "px-3 py-1.5 rounded-lg flex items-center justify-center space-x-1.5 text-xs font-medium",
                        order.whatsappOptIn
                          ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                          : "bg-white/5 border border-white/10 text-white/60"
                      )}>
                        {order.whatsappOptIn ? (
                          <>
                            <Bell className="w-3.5 h-3.5" />
                            <span>WhatsApp: On</span>
                          </>
                        ) : (
                          <>
                            <Bell className="w-3.5 h-3.5" />
                            <span>WhatsApp: Off</span>
                          </>
                        )}
                      </div>
                    )}
                    <button
                      className="bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/30 px-3 py-1.5 rounded-lg flex items-center justify-center space-x-1.5 text-xs font-medium transition-all duration-200 cursor-pointer"
                      onClick={() => handleCancelOrder(order)}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Cancel Order</span>
                    </button>
                    <button
                      className={cn(
                        "px-3 py-1.5 rounded-lg flex items-center justify-center space-x-1.5 text-xs font-medium transition-all duration-200 cursor-pointer",
                        order.paymentMethod === "cod" && order.paymentStatus !== "paid"
                          ? "bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/30"
                          : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/30"
                      )}
                      onClick={() => handleCompleteOrder(order)}
                    >
                      {order.paymentMethod === "cod" && order.paymentStatus !== "paid" ? (
                        <>
                          <Banknote className="w-3.5 h-3.5" />
                          <span>Collect Payment & Complete</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Mark Complete</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Modals */}
      <CallbackModal
        isOpen={callbackModalOpen}
        onClose={() => setCallbackModalOpen(false)}
        order={selectedOrder}
        onConfirm={handleCallbackConfirm}
      />

      <OrderCancellationModal
        isOpen={cancellationModalOpen}
        onClose={() => setCancellationModalOpen(false)}
        order={selectedOrder}
        onConfirm={handleCancellationConfirm}
      />

      {/* COD Payment Collection Modal - Requirements 10.3, 10.4, 10.5 */}
      <CODPaymentModal
        isOpen={codPaymentModalOpen}
        onClose={() => setCodPaymentModalOpen(false)}
        order={selectedOrder}
        onConfirmPayment={handleCODPaymentConfirmed}
        onPaymentFailed={handleCODPaymentFailed}
      />

      {/* WhatsApp Opt-In Modal - Requirement 13.2: Prompt for opt-in on first order */}
      <WhatsAppOptInModal
        isOpen={whatsappOptInModalOpen}
        onClose={() => setWhatsappOptInModalOpen(false)}
        order={selectedOrder}
        onOptInConfirmed={handleWhatsAppOptInConfirmed}
      />

      {/* Delivery Status Modal - Manual delivery status management */}
      <DeliveryStatusModal
        isOpen={deliveryStatusModalOpen}
        onClose={() => setDeliveryStatusModalOpen(false)}
        order={selectedOrder}
        onUpdateStatus={handleDeliveryStatusUpdate}
      />
    </div>
  );
};

export default CurrentOrders;
