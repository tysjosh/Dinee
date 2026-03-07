"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import Button from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { MinimalHeader } from "@/components/ui/Header";

interface BusinessIdDisplayProps {
  restaurantId: string;
  onComplete: () => Promise<void>;
  loading?: boolean;
}

/**
 * Component that displays the generated business ID and virtual phone number
 * Shows setup completion status and instructions for customers
 */
const BusinessIdDisplay: React.FC<BusinessIdDisplayProps> = ({
  restaurantId,
  onComplete,
  loading = false,
}) => {
  const PHONE_NUMBER =
    process.env.NEXT_PUBLIC_VIRTUAL_NUMBER || "(555) 123-4567";
  const [isProceeding, setIsProceeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleProceed = async () => {
    setIsProceeding(true);
    setError(null);

    try {
      await onComplete();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to proceed. Please try again."
      );
    } finally {
      setIsProceeding(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="max-w-4xl w-full space-y-12"
      >
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-center"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-500/10 rounded-full mb-6">
            <svg
              className="w-8 h-8 text-emerald-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-4xl text-minimal text-white mb-3">
            Setup Complete
          </h1>
          <p className="text-gray-400 text-lg text-minimal">
            Your business is ready! Customers can now call your new virtual
            number.
          </p>
        </motion.div>

        {/* Main Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="card-minimal rounded-2xl p-8"
        >
          {error && (
            <div
              className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg backdrop-blur-sm mb-6"
              role="alert"
              aria-live="polite"
            >
              {error}
            </div>
          )}

          {/* Business Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            {/* Business ID */}
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-4 bg-blue-500/10 rounded-full flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <h3 className="text-sm text-blue-400 mb-2 text-minimal">
                Business ID
              </h3>
              <div className="text-2xl text-white font-mono text-minimal">
                {restaurantId}
              </div>
            </div>

            {/* Phone Number */}
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-4 bg-green-500/10 rounded-full flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-green-400"
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
              <h3 className="text-sm text-green-400 mb-2 text-minimal">
                AI Phone Number
              </h3>
              <div className="text-xl text-white font-mono text-minimal">
                {PHONE_NUMBER}
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="border-t border-white/10 pt-6">
            <h3 className="text-white text-minimal mb-4 text-center">
              How it works
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-400">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 bg-emerald-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-emerald-400 text-xs">1</span>
                </div>
                <span>Customers call {PHONE_NUMBER}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 bg-blue-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-400 text-xs">2</span>
                </div>
                <span>
                  They enter Business ID:{" "}
                  <span className="font-mono text-cyan-400">
                    {restaurantId}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 bg-purple-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-purple-400 text-xs">3</span>
                </div>
                <span>AI takes their order automatically</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 bg-yellow-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-yellow-400 text-xs">4</span>
                </div>
                <span>Monitor everything in your dashboard</span>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="mt-8 text-center">
            <button
              onClick={handleProceed}
              disabled={isProceeding || loading}
              className="btn-minimal btn-primary-minimal px-8 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-minimal"
            >
              {isProceeding ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-emerald-500/30 border-t-emerald-500"></div>
                  Setting up...
                </span>
              ) : (
                "Go to Dashboard"
              )}
            </button>
          </div>
        </motion.div>

        {/* Footer note */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-center"
        >
          <p className="text-sm text-gray-500 text-minimal">
            Save your Business ID{" "}
            <span className="font-mono text-cyan-400">{restaurantId}</span> and
            phone number {PHONE_NUMBER}
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default BusinessIdDisplay;
