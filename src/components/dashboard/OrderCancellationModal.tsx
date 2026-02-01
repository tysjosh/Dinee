import React, { useState } from "react";
import { Order } from "@/types/global";
import { Modal } from "@/components/ui/Modal";
import { BACKEND_URL } from "@/lib/constants";
import { useRestaurantStorage } from "@/hooks/useRestaurantStorage";

export interface OrderCancellationModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onConfirm: (
    orderId: string,
    shouldCallCustomer: boolean,
    reason?: string
  ) => void;
}

type CancellationStep = "confirm" | "reason";

const CHARS_COUNT = 10;

const OrderCancellationModal: React.FC<OrderCancellationModalProps> = ({
  isOpen,
  onClose,
  order,
  onConfirm,
}) => {
  const [step, setStep] = useState<CancellationStep>("confirm");
  const [shouldCallCustomer, setShouldCallCustomer] = useState<boolean | null>(
    null
  );
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { restaurantData } = useRestaurantStorage();

  const handleClose = () => {
    setStep("confirm");
    setShouldCallCustomer(null);
    setReason("");
    setIsSubmitting(false);
    onClose();
  };

  const handleCustomerCallDecision = (willCall: boolean) => {
    setShouldCallCustomer(willCall);
    if (willCall) {
      setStep("reason");
    } else {
      // If not calling customer, proceed directly to cancellation
      handleFinalConfirmation(false, "");
    }
  };

  const handleReasonSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (reason.trim().length < CHARS_COUNT || !restaurantData || !order) {
      return;
    }
    await handleFinalConfirmation(true, reason.trim());
    const requestBody = {
      phoneNumber: order.phoneNumber,
      data: `<agent_name>${restaurantData.agentName}</agent_name>
      <restaurant_name>${restaurantData.name}</restaurant_name>
      <restaurant_id>${restaurantData.id}</restaurant_id>
      <order_details>${order.items}</order_details>
      <order_id>${order.id}</order_id>
      <customer_name>${order.customerName}</customer_name>
      <reason>${reason}</reason>`,
      reason: "cancellation",
    };
    await fetch(`${BACKEND_URL}/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  };

  const handleFinalConfirmation = async (
    callCustomer: boolean,
    cancellationReason: string
  ) => {
    if (!order) return;

    setIsSubmitting(true);
    try {
      await onConfirm(order.id, callCustomer, cancellationReason);
      handleClose();
    } catch (error) {
      console.error("Error cancelling order:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isReasonValid = reason.trim().length >= CHARS_COUNT;
  const characterCount = reason.trim().length;

  if (!order) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Cancel Order"
      description={
        step === "confirm"
          ? `Are you sure you want to cancel Order #${order.id}?`
          : `Provide cancellation reason for Order #${order.id}`
      }
      size="lg"
      closeOnOverlayClick={!isSubmitting}
      closeOnEscape={!isSubmitting}
    >
      {step === "confirm" && (
        <div className="space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <h4 className="text-sm font-medium text-white mb-3">
              Order Information
            </h4>
            <div className="text-sm space-y-2">
              <div className="flex items-center space-x-2">
                <span className="font-medium text-white/60">Customer:</span>
                <span className="text-white">{order.customerName}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="font-medium text-white/60">Phone:</span>
                <span className="text-emerald-400">{order.phoneNumber}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="font-medium text-white/60">Total:</span>
                <span className="text-emerald-400">
                  ${order.totalAmount.toFixed(2)}
                </span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="font-medium text-white/60">Items:</span>
                <span className="text-white text-xs">
                  {order.items
                    .map((item) => `${item.quantity}x ${item.name}`)
                    .join(", ")}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-emerald-400 mb-2">
              Do you want to call and inform the customer about the
              cancellation?
            </h4>
            <p className="text-xs text-emerald-300 mb-4">
              This will help maintain good customer service and explain the
              reason for cancellation.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => handleCustomerCallDecision(true)}
                disabled={isSubmitting}
                className="px-4 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 hover:border-emerald-500/40 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <span>📞</span>
                <span>Yes, Call Customer</span>
              </button>
              <button
                onClick={() => handleCustomerCallDecision(false)}
                disabled={isSubmitting}
                className="px-4 py-2 bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-white/20 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                No, Cancel Without Calling
              </button>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t border-white/10">
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-white/20 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Keep Order Active
            </button>
          </div>
        </div>
      )}

      {step === "reason" && (
        <form onSubmit={handleReasonSubmit} className="space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <h4 className="text-sm font-medium text-white mb-3">
              Order Information
            </h4>
            <div className="text-sm space-y-2">
              <div className="flex items-center space-x-2">
                <span className="font-medium text-white/60">Customer:</span>
                <span className="text-white">{order.customerName}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="font-medium text-white/60">Phone:</span>
                <span className="text-emerald-400">{order.phoneNumber}</span>
              </div>
            </div>
          </div>

          <div>
            <label
              htmlFor="cancellation-reason"
              className="block text-sm font-medium text-white mb-2"
            >
              Reason for Cancellation <span className="text-red-400">*</span>
            </label>
            <textarea
              id="cancellation-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Please provide a detailed reason for the cancellation that will be communicated to the customer (minimum 10 characters)..."
              className="w-full h-32 px-3 py-2 bg-black border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
              disabled={isSubmitting}
              required
            />
            <div className="flex justify-between items-center mt-2">
              <p
                className={`text-xs ${
                  characterCount < CHARS_COUNT
                    ? "text-red-400"
                    : "text-emerald-400"
                }`}
              >
                {characterCount}/{CHARS_COUNT} characters minimum
              </p>
              {characterCount > 0 && characterCount < CHARS_COUNT && (
                <p className="text-xs text-red-400">
                  {CHARS_COUNT - characterCount} more characters needed
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={() => setStep("confirm")}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-white/20 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={!isReasonValid || isSubmitting}
              className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 hover:border-red-500/40 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {isSubmitting && (
                <div className="animate-spin rounded-full h-3 w-3 border border-red-400 border-t-transparent"></div>
              )}
              <span>Cancel Order & Call Customer</span>
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default OrderCancellationModal;
