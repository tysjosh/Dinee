"use client";

/**
 * Billing Callback Page
 *
 * Paystack redirects here after payment. Extracts the reference from
 * the URL query params, calls the verify API to confirm payment and
 * activate the subscription, then redirects to the dashboard.
 */

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

type VerifyState = "verifying" | "success" | "failed";

export default function BillingCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<VerifyState>("verifying");
  const [error, setError] = useState<string>("");

  // Paystack/Flutterwave redirect with `reference`/`trxref`; Stripe Checkout
  // redirects with `session_id` (which is the reference we persisted on the
  // subscription). Accept any of them.
  const reference =
    searchParams.get("reference") ||
    searchParams.get("trxref") ||
    searchParams.get("session_id");

  useEffect(() => {
    if (!reference) {
      setState("failed");
      setError("No payment reference found");
      return;
    }

    let cancelled = false;

    async function verify() {
      try {
        const res = await fetch("/client/api/v1/billing/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference }),
        });

        if (cancelled) return;

        const data = await res.json();

        if (data.verified) {
          setState("success");
          // Redirect to dashboard after a short delay
          setTimeout(() => {
            if (!cancelled) router.push("/client/dashboard?tab=billing");
          }, 2000);
        } else {
          setState("failed");
          setError(data.error || "Payment could not be verified");
        }
      } catch {
        if (!cancelled) {
          setState("failed");
          setError("Something went wrong verifying your payment");
        }
      }
    }

    verify();

    return () => {
      cancelled = true;
    };
  }, [reference, router]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="card p-8 max-w-md w-full text-center">
        {state === "verifying" && (
          <>
            <Loader2 className="h-12 w-12 text-emerald-400 mx-auto mb-4 animate-spin" />
            <h1 className="text-xl font-semibold text-white mb-2">
              Verifying Payment
            </h1>
            <p className="text-white/60 text-sm">
              Please wait while we confirm your payment...
            </p>
          </>
        )}

        {state === "success" && (
          <>
            <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-white mb-2">
              Payment Successful
            </h1>
            <p className="text-white/60 text-sm">
              Your subscription is now active. Redirecting to dashboard...
            </p>
          </>
        )}

        {state === "failed" && (
          <>
            <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-white mb-2">
              Payment Not Confirmed
            </h1>
            <p className="text-white/60 text-sm mb-6">{error}</p>
            <button
              onClick={() => router.push("/client/dashboard?tab=billing")}
              className="btn btn-primary btn-md"
            >
              Back to Billing
            </button>
          </>
        )}
      </div>
    </div>
  );
}
