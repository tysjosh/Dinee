import React, { useState } from "react";
import { Order } from "@/types/global";
import { Modal } from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import { BACKEND_URL } from "@/lib/constants";
import { useRestaurantStorage } from "@/hooks/useRestaurantStorage";

export interface CallbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onConfirm: (orderId: string, reason: string) => void;
}

const CallbackModal: React.FC<CallbackModalProps> = ({
  isOpen,
  onClose,
  order,
  onConfirm,
}) => {
  const TOTAL_CHAR_COUNT = 10;
  const { restaurantData } = useRestaurantStorage();
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!order || reason.trim().length < TOTAL_CHAR_COUNT || !restaurantData) {
      return;
    }

    setIsSubmitting(true);
    try {
      onConfirm(order.id, reason.trim());
      const requestBody = {
        phoneNumber: order.phoneNumber,
        data: `<agent_name>${JSON.stringify(restaurantData.agentName)}</agent_name>
        <restaurant_name>${JSON.stringify(restaurantData.name)}</restaurant_name>
        <restaurant_id>${JSON.stringify(restaurantData.id)}</restaurant_id>
        <order_details>${JSON.stringify(order.items)}</order_details>
        <order_id>${JSON.stringify(order.id)}</order_id>
        <customer_name>${order.customerName}</customer_name>
        <reason>${reason}</reason>`,
        reason: "followup",
      };
      await fetch(`${BACKEND_URL}/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      handleClose();
    } catch (error) {
      console.error("Error submitting callback:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason("");
    setIsSubmitting(false);
    onClose();
  };

  const isReasonValid = reason.trim().length >= TOTAL_CHAR_COUNT;
  const characterCount = reason.trim().length;

  if (!order) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Callback Customer"
      description={`Initiate a callback for Order #${order.id} - ${order.customerName}`}
      size="lg"
      closeOnOverlayClick={!isSubmitting}
      closeOnEscape={!isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
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
          </div>
        </div>

        <div>
          <label
            htmlFor="callback-reason"
            className="block text-sm font-medium text-white mb-2"
          >
            Reason for Callback <span className="text-red-400">*</span>
          </label>
          <textarea
            id="callback-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Please provide a detailed reason for the callback (minimum 10 characters)..."
            className="w-full h-32 px-3 py-2 bg-black border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
            disabled={isSubmitting}
            required
          />
          <div className="flex justify-between items-center mt-2">
            <p
              className={`text-xs ${
                characterCount < TOTAL_CHAR_COUNT
                  ? "text-red-400"
                  : "text-emerald-400"
              }`}
            >
              {characterCount}/{TOTAL_CHAR_COUNT} characters minimum
            </p>
            {characterCount > 0 && characterCount < TOTAL_CHAR_COUNT && (
              <p className="text-xs text-red-400">
                {TOTAL_CHAR_COUNT - characterCount} more characters needed
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-4 py-2 bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-white/20 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isReasonValid || isSubmitting}
            className="px-4 py-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 hover:border-emerald-500/40 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {isSubmitting && (
              <div className="animate-spin rounded-full h-3 w-3 border border-emerald-400 border-t-transparent"></div>
            )}
            <span>Initiate Callback</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default CallbackModal;
