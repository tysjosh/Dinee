import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import Button from "./Button";

export interface LimitReachedModalProps {
  isOpen: boolean;
  onClose: () => void;
  limitType: string;
  current: number;
  limit: number;
  onUpgrade: () => void;
}

const LIMIT_LABELS: Record<string, { singular: string; icon: React.ReactNode }> = {
  branches: {
    singular: "branch",
    icon: (
      <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  calls: {
    singular: "call",
    icon: (
      <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
  },
  orders: {
    singular: "order",
    icon: (
      <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  "menu items": {
    singular: "menu item",
    icon: (
      <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  "team members": {
    singular: "team member",
    icon: (
      <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
};

const LimitReachedModal: React.FC<LimitReachedModalProps> = ({
  isOpen,
  onClose,
  limitType,
  current,
  limit,
  onUpgrade,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const labelInfo = LIMIT_LABELS[limitType] ?? {
    singular: limitType,
    icon: (
      <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    ),
  };

  const usagePercent = limit > 0 ? Math.min((current / limit) * 100, 100) : 100;

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      modalRef.current?.focus();
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
      previousFocusRef.current?.focus();
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      // Focus trap
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="limit-modal-title"
      aria-describedby="limit-modal-desc"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleOverlayClick}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div
        ref={modalRef}
        className={cn(
          "relative w-full max-w-md rounded-lg bg-black border border-gray-800 shadow-xl",
          "max-h-[90vh] overflow-y-auto"
        )}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="px-4 pt-5 pb-4 sm:px-6 sm:pt-6 sm:pb-5">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-amber-500/10 border border-amber-500/20">
              {labelInfo.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h2
                id="limit-modal-title"
                className="text-lg font-medium text-white"
              >
                {limitType.charAt(0).toUpperCase() + limitType.slice(1)} limit reached
              </h2>
              <p
                id="limit-modal-desc"
                className="mt-1 text-sm text-gray-400"
              >
                You&apos;ve used all available {limitType} on your current plan.
                Upgrade to get more.
              </p>
            </div>
          </div>

          {/* Usage bar */}
          <div className="mt-5 rounded-md bg-gray-900 border border-gray-800 p-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-gray-300">Current usage</span>
              <span className="font-medium text-white">
                {current} of {limit} {limitType} used
              </span>
            </div>
            <div
              className="h-2 w-full rounded-full bg-gray-800 overflow-hidden"
              role="progressbar"
              aria-valuenow={current}
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-label={`${current} of ${limit} ${limitType} used`}
            >
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-gray-800 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse gap-3">
          <Button
            variant="primary"
            onClick={onUpgrade}
            className="w-full sm:w-auto"
          >
            Upgrade Plan
          </Button>
          <Button
            variant="outline"
            onClick={onClose}
            className="mt-3 w-full sm:mt-0 sm:w-auto"
          >
            Close
          </Button>
        </div>

        {/* Close X button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-black rounded-md transition-colors cursor-pointer"
          aria-label="Close modal"
        >
          <svg
            className="h-4 w-4 sm:h-5 sm:w-5"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

LimitReachedModal.displayName = "LimitReachedModal";

export default LimitReachedModal;
