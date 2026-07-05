"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { MinimalHeader } from "@/components/ui/Header";
import Link from "next/link";

/**
 * Login page at /client/login
 *
 * Handles returning user authentication with email/password.
 * On success: redirects to dashboard (or onboarding if tenantId is empty).
 * On failure: displays generic error without revealing which field was wrong.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const { user, isAuthenticated, isLoading: userLoading } = useCurrentUser();
  const updateLastLogin = useMutation(api.users.updateLastLogin);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);

  // After successful login, wait for user record to resolve then redirect
  useEffect(() => {
    if (!loginSuccess || userLoading || !isAuthenticated) return;

    if (user) {
      // Update last login timestamp (userId is optional on the users doc)
      if (user.userId) {
        updateLastLogin({ userId: user.userId }).catch(() => {
          // Non-critical — don't block redirect
        });
      }

      // Redirect based on onboarding status
      if (!user.tenantId) {
        router.push("/client/onboarding");
      } else {
        router.push("/client/dashboard");
      }
    }
  }, [loginSuccess, user, isAuthenticated, userLoading, router, updateLastLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Please enter your email and password");
      return;
    }

    setIsSubmitting(true);

    try {
      await signIn("password", { email, password, flow: "signIn" });
      setLoginSuccess(true);
    } catch {
      setError("Invalid email or password");
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
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-white">Welcome back</h1>
              <p className="text-white/50 mt-2 text-sm">
                Sign in to your account
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
              {/* Email field */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-white/70 mb-1.5">
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

              {/* Password field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="block text-sm font-medium text-white/70">
                    Password
                  </label>
                  <Link
                    href="/client/forgot-password"
                    className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError("");
                  }}
                  placeholder="Enter your password"
                  className="input-dark w-full rounded-lg px-4 py-3 text-sm"
                  autoComplete="current-password"
                  disabled={isSubmitting}
                />
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm min-h-[44px]"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                    Signing in...
                  </span>
                ) : (
                  "Sign in"
                )}
              </button>
            </form>

            {/* Link to sign-up */}
            <p className="mt-6 text-center text-sm text-white/50">
              Don&apos;t have an account?{" "}
              <Link
                href="/client/signup"
                className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
              >
                Create one
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
