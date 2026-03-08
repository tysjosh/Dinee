"use client";

import React, { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { MinimalHeader } from "@/components/ui/Header";
import Link from "next/link";

/**
 * Forgot Password page at /client/forgot-password
 *
 * Renders an email input form. On submit, generates a password reset token
 * and shows a generic success message (never reveals whether the email exists).
 *
 * Requirements: 5.1, 5.2, 5.6
 */
export default function ForgotPasswordPage() {
  const createResetToken = useMutation(api.passwordResetTokens.createResetToken);

  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email address");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Please enter a valid email address");
      return;
    }

    setIsSubmitting(true);

    try {
      // Generate reset token — the mutation always succeeds regardless of
      // whether the email exists, so we never leak account existence.
      const { rawToken } = await createResetToken({ email: trimmed });

      // In production this would send an email with the reset link.
      // For now we log it so developers can test the flow.
      console.info(
        `[Password Reset] Link: /client/reset-password?token=${rawToken}`
      );

      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden relative">
      <MinimalHeader />

      <div className="flex items-center justify-center min-h-screen px-6 py-20">
        <div className="max-w-md w-full">
          <div className="glass-card rounded-2xl p-8">
            {submitted ? (
              /* Success state — generic message */
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                  <svg
                    className="h-6 w-6 text-emerald-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                    />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-white">Check your email</h1>
                <p className="text-white/50 mt-3 text-sm leading-relaxed">
                  If an account exists with that email, we&apos;ve sent a password
                  reset link. The link expires in 1 hour.
                </p>
                <Link
                  href="/client/login"
                  className="mt-6 inline-block text-sm text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                >
                  Back to sign in
                </Link>
              </div>
            ) : (
              /* Form state */
              <>
                <div className="text-center mb-8">
                  <h1 className="text-2xl font-bold text-white">
                    Reset your password
                  </h1>
                  <p className="text-white/50 mt-2 text-sm">
                    Enter your email and we&apos;ll send you a reset link
                  </p>
                </div>

                {error && (
                  <div
                    className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                    role="alert"
                  >
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                  <div>
                    <label
                      htmlFor="email"
                      className="block text-sm font-medium text-white/70 mb-1.5"
                    >
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError("");
                      }}
                      placeholder="you@example.com"
                      className="input-dark w-full rounded-lg px-4 py-3 text-sm"
                      autoComplete="email"
                      disabled={isSubmitting}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm min-h-[44px]"
                  >
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                        Sending...
                      </span>
                    ) : (
                      "Send reset link"
                    )}
                  </button>
                </form>

                <p className="mt-6 text-center text-sm text-white/50">
                  Remember your password?{" "}
                  <Link
                    href="/client/login"
                    className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                  >
                    Sign in
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
