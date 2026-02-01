import React, { useState } from "react";
import { Order } from "@/types/global";
import { Modal } from "@/components/ui/Modal";
import { MessageCircle, Bell, BellOff, CheckCircle } from "lucide-react";

export interface WhatsAppOptInModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onOptInConfirmed: (orderId: string, phoneNumber: string, optIn: boolean) => Promise<void>;
}

/**
 * WhatsApp Opt-In Modal
 * 
 * Displays when a customer places their first order to prompt for WhatsApp consent.
 * Implements requirement 13.2: WHEN a customer places their first order, 
 * THE System SHALL prompt for WhatsApp opt-in consent.
 * 
 * The preference is stored in the customerPreferences table.
 */
const WhatsAppOptInModal: React.FC<WhatsAppOptInModalProps> = ({
  isOpen,
  onClose,
  order,
  onOptInConfirmed,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedOption, setSelectedOption] = useState<boolean | null>(null);

  const handleClose = () => {
    setSelectedOption(null);
    setIsSubmitting(false);
    onClose();
  };

  const handleOptInChoice = async (optIn: boolean) => {
    if (!order || !order.phoneNumber || order.phoneNumber === "Unknown") return;

    setSelectedOption(optIn);
    setIsSubmitting(true);
    
    try {
      await onOptInConfirmed(order.id, order.phoneNumber, optIn);
      handleClose();
    } catch (error) {
      console.error("Error saving WhatsApp preference:", error);
      setIsSubmitting(false);
    }
  };

  if (!order) return null;

  const hasValidPhone = order.phoneNumber && order.phoneNumber !== "Unknown";

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="WhatsApp Notifications"
      description={`Set notification preferences for ${order.customerName}`}
      size="md"
      closeOnOverlayClick={!isSubmitting}
      closeOnEscape={!isSubmitting}
    >
      <div className="space-y-6">
        {/* WhatsApp Info Banner */}
        <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-lg">
          <div className="flex items-start space-x-3">
            <div className="p-2 bg-emerald-500/20 rounded-lg">
              <MessageCircle className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-emerald-400 mb-1">
                First Order from this Customer
              </h4>
              <p className="text-xs text-emerald-300">
                Would the customer like to receive order updates via WhatsApp? 
                They can opt out anytime by sending &quot;STOP&quot;.
              </p>
            </div>
          </div>
        </div>

        {/* Customer Information */}
        <div className="bg-white/5 border border-white/10 rounded-lg p-4">
          <h4 className="text-sm font-medium text-white mb-3">
            Customer Information
          </h4>
          <div className="text-sm space-y-2">
            <div className="flex items-center space-x-2">
              <span className="font-medium text-white/60">Name:</span>
              <span className="text-white">{order.customerName}</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-medium text-white/60">Phone:</span>
              <span className={hasValidPhone ? "text-emerald-400" : "text-red-400"}>
                {hasValidPhone ? order.phoneNumber : "Not Available"}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-medium text-white/60">Order:</span>
              <span className="text-white">#{order.id}</span>
            </div>
          </div>
        </div>

        {/* No Phone Warning */}
        {!hasValidPhone && (
          <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg">
            <p className="text-xs text-amber-400">
              ⚠️ No valid phone number available for this customer. 
              WhatsApp notifications cannot be enabled without a phone number.
            </p>
          </div>
        )}

        {/* Notification Benefits */}
        {hasValidPhone && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-white">
              WhatsApp notifications include:
            </h4>
            <ul className="text-xs text-white/70 space-y-2">
              <li className="flex items-center space-x-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span>Order confirmation with details</span>
              </li>
              <li className="flex items-center space-x-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span>Preparation status updates</span>
              </li>
              <li className="flex items-center space-x-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span>Delivery dispatch notifications with rider info</span>
              </li>
              <li className="flex items-center space-x-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span>Delivery confirmation</span>
              </li>
            </ul>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2 pt-4 border-t border-white/10">
          {hasValidPhone ? (
            <>
              <button
                onClick={() => handleOptInChoice(true)}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 hover:border-emerald-500/40 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {isSubmitting && selectedOption === true ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-emerald-400 border-t-transparent"></div>
                ) : (
                  <>
                    <Bell className="w-4 h-4" />
                    <span>Yes, Enable Notifications</span>
                  </>
                )}
              </button>
              <button
                onClick={() => handleOptInChoice(false)}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-white/20 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {isSubmitting && selectedOption === false ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                ) : (
                  <>
                    <BellOff className="w-4 h-4" />
                    <span>No, Skip</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <button
              onClick={handleClose}
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 text-white hover:bg-white/10 hover:border-white/20 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer"
            >
              Close
            </button>
          )}
        </div>

        {/* Skip Option */}
        {hasValidPhone && (
          <div className="flex justify-center">
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className="text-xs text-white/50 hover:text-white/70 transition-colors cursor-pointer disabled:opacity-50"
            >
              Ask later
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default WhatsAppOptInModal;
