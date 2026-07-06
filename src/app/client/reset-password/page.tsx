"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { MinimalHeader } from "@/components/ui/Header";
import Link from "next/link";

/**
 * Reset Password page at /client/reset-password
 *
 * Completes Convex Auth's password reset: the user enters the 6-digit code from
 * their email plus a new password, and we call the provider's
 * `reset-verification` flow, which actually changes the credential Convex Auth
 * authenticates against. On success the user is signed in and redirected.
 *
 * Requirements: 5.3, 5.4, 5.5
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useAuthActions();

  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    code?: string;
    password?: string;
    confirmPassword?: string;
  }>({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const validate = (): boolean => {
    const errors: typeof fieldErrors = {};

    if (!email.trim()) {
      errors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Please enter a valid email address";
    }

    if (!code.trim()) {
      errors.code = "Enter the code from your email";
    }

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

    if (!validate()) return;

    setIsSubmitting(true);

    try {
      // Convex Auth reset-verification: verifies the OTP and sets the new
      // password on the real credential. On success the user is authenticated.
      await signIn("password", {
        email: email.trim(),
        code: code.trim(),
        newPassword: password,
        flow: "reset-verification",
      });

      setSuccess(true);
      setTimeout(() => {
        router.push("/client/dashboard");
      }, 1500);
    } catch {
      // Convex Auth returns a generic failure for an invalid/expired code.
      setError(
        "That code is invalid or has expired. Request a new one and try again."
      );
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
                  Your password has been reset and you&apos;re signed in.
                  Redirecting you now&hellip;
                </p>
                <Link
                  href="/client/dashboard"
                  className="mt-6 inline-block text-sm text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                >
                  Go to dashboard
                </Link>
              </div>
            ) : (
              /* Form state — enter code + new password */
              <>
                <div className="text-center mb-8">
                  <h1 className="text-2xl font-bold text-white">
                    Set a new password
                  </h1>
                  <p className="text-white/50 mt-2 text-sm">
                    Enter the code we emailed you and choose a new password
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
                  {/* Email */}
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
                        if (fieldErrors.email)
                          setFieldErrors((prev) => ({ ...prev, email: undefined }));
                      }}
                      placeholder="you@example.com"
                      className={`input-dark w-full rounded-lg px-4 py-3 text-sm ${
                        fieldErrors.email ? "border-red-500/50" : ""
                      }`}
                      autoComplete="email"
                      disabled={isSubmitting}
                    />
                    {fieldErrors.email && (
                      <p className="mt-1.5 text-xs text-red-400">
                        {fieldErrors.email}
                      </p>
                    )}
                  </div>

                  {/* Reset code */}
                  <div>
                    <label
                      htmlFor="code"
                      className="block text-sm font-medium text-white/70 mb-1.5"
                    >
                      Reset code
                    </label>
                    <input
                      id="code"
                      type="text"
                      inputMode="numeric"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value);
                        if (fieldErrors.code)
                          setFieldErrors((prev) => ({ ...prev, code: undefined }));
                      }}
                      placeholder="6-digit code"
                      className={`input-dark w-full rounded-lg px-4 py-3 text-sm tracking-widest ${
                        fieldErrors.code ? "border-red-500/50" : ""
                      }`}
                      autoComplete="one-time-code"
                      disabled={isSubmitting}
                    />
                    {fieldErrors.code && (
                      <p className="mt-1.5 text-xs text-red-400">
                        {fieldErrors.code}
                      </p>
                    )}
                  </div>

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
                      disabled={isSubmitting}
                    />
                    {fieldErrors.password && (
                      <p className="mt-1.5 text-xs text-red-400">
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
                      disabled={isSubmitting}
                    />
                    {fieldErrors.confirmPassword && (
                      <p className="mt-1.5 text-xs text-red-400">
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
                  Didn&apos;t get a code?{" "}
                  <Link
                    href="/client/forgot-password"
                    className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                  >
                    Request a new one
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
