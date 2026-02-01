import React, { useState } from "react";
import { Order } from "@/types/global";
import { Modal } from "@/components/ui/Modal";
import { Banknote, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

export interface CODPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onConfirmPayment: (orderId: string) => Promise<void>;
  onPaymentFailed: (orderId: string, reason: string) => Promise<void>;
}

type PaymentStep = "confirm" | "failed_reason";

const CHARS_COUNT = 10;

/**
 * COD Payment Collection Modal
 * 
 * Displays when marking a COD order as delivered to confirm payment collection.
 * Implements requirements:
 * - 10.3: Prompt for payment collection confirmation when marking as delivered
 * - 10.4: Update paymentStatus to "paid" when confirmed
 * - 10.5: Allow marking as "payment_failed" with a reason
 */
const CODPaymentModal: React.FC<CODPaymentModalProps> = ({
  isOpen,
  onClose,
  order,
  onConfirmPayment,
  onPaymentFailed,
}) => {
  const [step, setStep] = useState<PaymentStep>("confirm");
  const [failureReason, setFailureReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleClose = () => {
    setStep("confirm");
    setFailureReason("");
    setIsSubmitting(false);
    onClose();
  };

  const handlePaymentConfirmed = async () => {
    if (!order) return;

    setIsSubmitting(true);
    try {
      await onConfirmPayment(order.id);
      handleClose();
    } catch (error) {
      console.error("Error confirming payment:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaymentFailedClick = () => {
    setStep("failed_reason");
  };

  const handleFailureReasonSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (failureReason.trim().length < CHARS_COUNT || !order) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onPaymentFailed(order.id, failureReason.trim());
      handleClose();
    } catch (error) {
      console.error("Error recording payment failure:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
    }).format(amount);
  };

  const isReasonValid = failureReason.trim().length >= CHARS_COUNT;
  const characterCount = failureReason.trim().length;

  if (!order) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="COD Payment Collection"
      description={
        step === "confirm"
          ? `Confirm payment collection for Order #${order.id}`
          : `Record payment failure reason for Order #${order.id}`
      }
      size="lg"
      closeOnOverlayClick={!isSubmitting}
      closeOnEscape={!isSubmitting}
    >
      {step === "confirm" && (
        <div className="space-y-6">
          {/* Order Information */}
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
                <span className="font-medium text-white/60">Amount to Collect:</span>
                <span className="text-amber-400 font-semibold text-base">
                  {formatCurrency(order.totalAmount)}
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

          {/* COD Payment Confirmation */}
          <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg">
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-amber-500/20 rounded-lg">
                <Banknote className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-amber-400 mb-1">
                  Cash on Delivery Payment
                </h4>
                <p className="text-xs text-amber-300">
                  Please confirm that you have collected the payment of{" "}
                  <span className="font-semibold">{formatCurrency(order.totalAmount)}</span>{" "}
                  from the customer.
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-white/10">
            <button
              onClick={handlePaymentConfirmed}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 hover:border-emerald-500/40 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {isSubmitting ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-emerald-400 border-t-transparent"></div>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>Payment Collected</span>
                </>
              )}
            </button>
            <button
              onClick={handlePaymentFailedClick}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/30 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              <XCircle className="w-4 h-4" />
              <span>Payment Failed</span>
            </button>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-white/20 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "failed_reason" && (
        <form onSubmit={handleFailureReasonSubmit} className="space-y-6">
          {/* Warning Banner */}
          <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg">
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-red-500/20 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-red-400 mb-1">
                  Payment Collection Failed
                </h4>
                <p className="text-xs text-red-300">
                  Please provide a reason for the payment failure. This will be recorded
                  for reconciliation purposes.
                </p>
              </div>
            </div>
          </div>

          {/* Order Summary */}
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <div className="text-sm space-y-2">
              <div className="flex items-center space-x-2">
                <span className="font-medium text-white/60">Customer:</span>
                <span className="text-white">{order.customerName}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="font-medium text-white/60">Amount:</span>
                <span className="text-amber-400 font-semibold">
                  {formatCurrency(order.totalAmount)}
                </span>
              </div>
            </div>
          </div>

          {/* Failure Reason Input */}
          <div>
            <label
              htmlFor="failure-reason"
              className="block text-sm font-medium text-white mb-2"
            >
              Reason for Payment Failure <span className="text-red-400">*</span>
            </label>
            <textarea
              id="failure-reason"
              value={failureReason}
              onChange={(e) => setFailureReason(e.target.value)}
              placeholder="Please describe why the payment could not be collected (e.g., customer refused to pay, insufficient cash, etc.)..."
              className="w-full h-32 px-3 py-2 bg-black border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
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

          {/* Action Buttons */}
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
              <span>Record Payment Failure</span>
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default CODPaymentModal;
