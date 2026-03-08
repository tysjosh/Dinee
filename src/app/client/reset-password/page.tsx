"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { MinimalHeader } from "@/components/ui/Header";
import Link from "next/link";

/**
 * Reset Password page at /client/reset-password
 *
 * Reads a reset token from query params (?token=...), renders a new password
 * form, validates the token via `resetUserPassword`, updates the user's
 * passwordHash, and redirects to login on success.
 *
 * Handles expired/invalid/used tokens with an error message and a resend option.
 *
 * Requirements: 5.3, 5.4, 5.5
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const resetUserPassword = useMutation(api.passwordResetTokens.resetUserPassword);
  const createResetToken = useMutation(api.passwordResetTokens.createResetToken);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    password?: string;
    confirmPassword?: string;
  }>({});
  const [error, setError] = useState("");
  const [errorType, setErrorType] = useState<"invalid" | "expired" | "used" | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Resend flow state
  const [resendEmail, setResendEmail] = useState("");
  const [showResendForm, setShowResendForm] = useState(false);
  const [resendSubmitting, setResendSubmitting] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  const validate = (): boolean => {
    const errors: typeof fieldErrors = {};

    if (!password) {
      errors.password = "Password is required";
    } else if (password.length < 8) {
      errors.password = "Password must be at least 8 characters";
    }

    if (!confirmPassword) {
      errors.confirmPassword = "Please confirm your password";
    } else if (password !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setErrorType("");

    if (!token) {
      setError("No reset token provided. Please use the link from your email.");
      setErrorType("invalid");
      return;
    }

    if (!validate()) return;

    setIsSubmitting(true);

    try {
      const result = await resetUserPassword({
        rawToken: token,
        newPasswordHash: password, // In production, hash client-side or let Convex Auth handle it
      });

      if (result.success) {
        setSuccess(true);
        // Redirect to login after a short delay so user sees the success message
        setTimeout(() => {
          router.push("/client/login");
        }, 2000);
      } else {
        switch (result.error) {
          case "expired":
            setError("This reset link has expired. Please request a new one.");
            setErrorType("expired");
            break;
          case "used":
            setError("This reset link has already been used. Please request a new one.");
            setErrorType("used");
            break;
          case "invalid":
          default:
            setError("This reset link is invalid. Please request a new one.");
            setErrorType("invalid");
            break;
        }
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = resendEmail.trim();
    if (!trimmed) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;

    setResendSubmitting(true);

    try {
      const { rawToken } = await createResetToken({ email: trimmed });
      // In production this sends an email. Log for dev testing.
      console.info(
        `[Password Reset] New link: /client/reset-password?token=${rawToken}`
      );
      setResendSuccess(true);
    } catch {
      // Show success regardless to avoid leaking account existence
      setResendSuccess(true);
    } finally {
      setResendSubmitting(false);
    }
  };

  // No token in URL at all
  if (!token) {
    return (
      <div className="min-h-screen bg-black text-white overflow-hidden relative">
        <MinimalHeader />
        <div className="flex items-center justify-center min-h-screen px-6 py-20">
          <div className="max-w-md w-full">
            <div className="glass-card rounded-2xl p-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
                <svg
                  className="h-6 w-6 text-red-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-white">Invalid reset link</h1>
              <p className="text-white/50 mt-3 text-sm leading-relaxed">
                This link is missing a reset token. Please use the link from your
                password reset email.
              </p>
              <Link
                href="/client/forgot-password"
                className="mt-6 inline-block text-sm text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
              >
                Request a new reset link
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden relative">
      <MinimalHeader />

      <div className="flex items-center justify-center min-h-screen px-6 py-20">
        <div className="max-w-md w-full">
          <div className="glass-card rounded-2xl p-8">
            {success ? (
              /* Success state */
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
                      d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-white">Password updated</h1>
                <p className="text-white/50 mt-3 text-sm leading-relaxed">
                  Your password has been reset successfully. Redirecting you to
                  sign in...
                </p>
                <Link
                  href="/client/login"
                  className="mt-6 inline-block text-sm text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                >
                  Sign in now
                </Link>
              </div>
            ) : errorType ? (
              /* Error state — expired, used, or invalid token */
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
                  <svg
                    className="h-6 w-6 text-red-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                    />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-white">
                  {errorType === "expired"
                    ? "Reset link expired"
                    : errorType === "used"
                      ? "Reset link already used"
                      : "Invalid reset link"}
                </h1>
                <p className="text-white/50 mt-3 text-sm leading-relaxed">
                  {error}
                </p>

                {/* Resend option */}
                {!showResendForm && !resendSuccess && (
                  <button
                    onClick={() => setShowResendForm(true)}
                    className="mt-6 inline-block text-sm text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                  >
                    Send a new reset link
                  </button>
                )}

                {showResendForm && !resendSuccess && (
                  <form onSubmit={handleResend} className="mt-6 space-y-4 text-left">
                    <div>
                      <label
                        htmlFor="resend-email"
                        className="block text-sm font-medium text-white/70 mb-1.5"
                      >
                        Email
                      </label>
                      <input
                        id="resend-email"
                        type="email"
                        value={resendEmail}
                        onChange={(e) => setResendEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="input-dark w-full rounded-lg px-4 py-3 text-sm"
                        autoComplete="email"
                        disabled={resendSubmitting}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={resendSubmitting}
                      className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm min-h-[44px]"
                    >
                      {resendSubmitting ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                          Sending...
                        </span>
                      ) : (
                        "Send reset link"
                      )}
                    </button>
                  </form>
                )}

                {resendSuccess && (
                  <p className="mt-6 text-sm text-emerald-400">
                    If an account exists with that email, a new reset link has been
                    sent. Check your inbox.
                  </p>
                )}

                <p className="mt-4 text-sm text-white/50">
                  <Link
                    href="/client/login"
                    className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                  >
                    Back to sign in
                  </Link>
                </p>
              </div>
            ) : (
              /* Form state — enter new password */
              <>
                <div className="text-center mb-8">
                  <h1 className="text-2xl font-bold text-white">
                    Set a new password
                  </h1>
                  <p className="text-white/50 mt-2 text-sm">
                    Enter your new password below
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
                  {/* New password */}
                  <div>
                    <label
                      htmlFor="password"
                      className="block text-sm font-medium text-white/70 mb-1.5"
                    >
                      New Password
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldErrors.password)
                          setFieldErrors((prev) => ({ ...prev, password: undefined }));
                      }}
                      placeholder="Minimum 8 characters"
                      className={`input-dark w-full rounded-lg px-4 py-3 text-sm ${
                        fieldErrors.password ? "border-red-500/50" : ""
                      }`}
                      autoComplete="new-password"
                      aria-invalid={!!fieldErrors.password}
                      aria-describedby={
                        fieldErrors.password ? "password-error" : undefined
                      }
                      disabled={isSubmitting}
                    />
                    {fieldErrors.password && (
                      <p id="password-error" className="mt-1.5 text-xs text-red-400">
                        {fieldErrors.password}
                      </p>
                    )}
                  </div>

                  {/* Confirm password */}
                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="block text-sm font-medium text-white/70 mb-1.5"
                    >
                      Confirm New Password
                    </label>
                    <input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (fieldErrors.confirmPassword)
                          setFieldErrors((prev) => ({
                            ...prev,
                            confirmPassword: undefined,
                          }));
                      }}
                      placeholder="Re-enter your new password"
                      className={`input-dark w-full rounded-lg px-4 py-3 text-sm ${
                        fieldErrors.confirmPassword ? "border-red-500/50" : ""
                      }`}
                      autoComplete="new-password"
                      aria-invalid={!!fieldErrors.confirmPassword}
                      aria-describedby={
                        fieldErrors.confirmPassword
                          ? "confirm-password-error"
                          : undefined
                      }
                      disabled={isSubmitting}
                    />
                    {fieldErrors.confirmPassword && (
                      <p
                        id="confirm-password-error"
                        className="mt-1.5 text-xs text-red-400"
                      >
                        {fieldErrors.confirmPassword}
                      </p>
                    )}
                  </div>

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm min-h-[44px]"
                  >
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                        Resetting password...
                      </span>
                    ) : (
                      "Reset password"
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
