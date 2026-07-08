"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { MinimalHeader } from "@/components/ui/Header";
import Link from "next/link";

/**
 * Sign-up page at /client/signup
 *
 * Handles new user registration with email/password.
 * Supports ?invite={token} query param for team invitations.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 9.5, 9.6
 */
export default function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const { signIn } = useAuthActions();
  const upsertCurrentUserProfile = useMutation(api.users.upsertCurrentUserProfile);
  const acceptInvitation = useMutation(api.invitations.acceptInvitation);

  // Look up invitation if token is present (query will be wired when invitations module is created)
  const invitation = useQuery(
    api.invitations.getInvitationByToken,
    inviteToken ? { inviteToken } : "skip"
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check invitation validity
  const invitationError = inviteToken
    ? invitation === null
      ? "" // Still loading
      : invitation === undefined
        ? ""
        : invitation.status === "expired" || (invitation.expiresAt && invitation.expiresAt < Date.now())
          ? "This invitation has expired. Please ask the team owner to resend."
          : invitation.status === "accepted"
            ? "This invitation has already been used."
            : invitation.status === "revoked"
              ? "This invitation has been revoked."
              : ""
    : "";

  useEffect(() => {
    if (invitationError) {
      setError(invitationError);
    }
  }, [invitationError]);

  const validate = (): boolean => {
    const errors: typeof fieldErrors = {};

    if (!email.trim()) {
      errors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "Please enter a valid email address";
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
      // Determine role/tenant from an accepted invitation, or fall back to a
      // fresh owner. tenantType is vertical-agnostic: an invitee inherits the
      // tenant's type snapshotted on the invitation; a brand-new owner has not
      // picked a vertical yet, so we use the neutral "business" default, which
      // onboarding corrects (restaurant/business/...) via setCurrentUserTenant.
      const isInvited = invitation?.status === "pending";
      // A restaurant is just one kind of business — new tenant owners are
      // provisioned with the generic business_owner role regardless of vertical
      // (the vertical is captured separately on the tenant during onboarding).
      const role = isInvited && invitation?.role
        ? invitation.role
        : "business_owner";
      const tenantId = isInvited && invitation?.tenantId
        ? invitation.tenantId
        : "";
      const tenantType: "platform" | "restaurant" | "business" | "branch" =
        isInvited && invitation?.tenantType ? invitation.tenantType : "business";

      // Step 1: Sign up via Convex Auth (creates the auth account + session and
      // the single users row).
      await signIn("password", { email, password, flow: "signUp" });

      // Step 2: Populate app profile fields ON THAT SAME auth row (idempotent).
      // No second row is created, so currentUser resolves a fully-populated
      // record and there are never duplicate users for one email.
      await upsertCurrentUserProfile({
        email,
        role: role as
          | "business_owner"
          | "restaurant_owner"
          | "branch_manager"
          | "supervisor",
        tenantType,
        tenantId,
      });

      // Step 3: For an invited staff member, mark the invitation accepted so it
      // is single-use and the owner's team list reflects reality. Non-fatal:
      // the user is already provisioned, so a failure here should not block
      // sign-in.
      if (isInvited && inviteToken) {
        try {
          await acceptInvitation({ inviteToken });
        } catch (acceptErr) {
          console.error("Failed to mark invitation accepted:", acceptErr);
        }
      }

      // Step 4: Invited staff already belong to a tenant — send them straight to
      // the dashboard. A new owner goes through onboarding to create their
      // tenant.
      router.push(tenantId ? "/client/dashboard" : "/client/onboarding");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (
        message.toLowerCase().includes("already exists") ||
        message.toLowerCase().includes("duplicate") ||
        message.toLowerCase().includes("account already")
      ) {
        setError("An account with this email already exists");
      } else {
        setError(message || "Something went wrong. Please try again.");
      }
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
              <h1 className="text-2xl font-bold text-white">Create your account</h1>
              <p className="text-white/50 mt-2 text-sm">
                {inviteToken
                  ? "You've been invited to join a team"
                  : "Get started with your AI reception agent"}
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
                    if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  placeholder="you@example.com"
                  className={`input-dark w-full rounded-lg px-4 py-3 text-sm ${
                    fieldErrors.email ? "border-red-500/50" : ""
                  }`}
                  autoComplete="email"
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? "email-error" : undefined}
                  disabled={isSubmitting}
                />
                {fieldErrors.email && (
                  <p id="email-error" className="mt-1.5 text-xs text-red-400">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              {/* Password field */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-white/70 mb-1.5">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  placeholder="Minimum 8 characters"
                  className={`input-dark w-full rounded-lg px-4 py-3 text-sm ${
                    fieldErrors.password ? "border-red-500/50" : ""
                  }`}
                  autoComplete="new-password"
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? "password-error" : undefined}
                  disabled={isSubmitting}
                />
                {fieldErrors.password && (
                  <p id="password-error" className="mt-1.5 text-xs text-red-400">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              {/* Confirm password field */}
              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-white/70 mb-1.5">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (fieldErrors.confirmPassword) setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                  }}
                  placeholder="Re-enter your password"
                  className={`input-dark w-full rounded-lg px-4 py-3 text-sm ${
                    fieldErrors.confirmPassword ? "border-red-500/50" : ""
                  }`}
                  autoComplete="new-password"
                  aria-invalid={!!fieldErrors.confirmPassword}
                  aria-describedby={fieldErrors.confirmPassword ? "confirm-password-error" : undefined}
                  disabled={isSubmitting}
                />
                {fieldErrors.confirmPassword && (
                  <p id="confirm-password-error" className="mt-1.5 text-xs text-red-400">
                    {fieldErrors.confirmPassword}
                  </p>
                )}
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={isSubmitting || !!invitationError}
                className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm min-h-[44px]"
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                    Creating account...
                  </span>
                ) : (
                  "Create account"
                )}
              </button>
            </form>

            {/* Link to login */}
            <p className="mt-6 text-center text-sm text-white/50">
              Already have an account?{" "}
              <Link
                href="/client/login"
                className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
