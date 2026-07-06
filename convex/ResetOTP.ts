import { Email } from "@convex-dev/auth/providers/Email";

/**
 * Password-reset OTP provider for the Convex Auth `Password` provider.
 *
 * Convex Auth owns credentials (in `authAccounts`), so a password reset MUST go
 * through the provider's `reset` / `reset-verification` flow to actually change
 * the stored secret. This replaces the previous custom `passwordResetTokens`
 * flow, which wrote a dead `users.passwordHash` field that Convex Auth never
 * reads — making "password reset" a silent no-op.
 *
 * The code is a 6-digit numeric OTP generated with the Web Crypto CSPRNG and is
 * valid for 15 minutes.
 *
 * DELIVERY: in this environment the code is logged to the Convex server console
 * (visible in `npx convex dev`), matching the app's existing dev pattern of
 * logging reset links. For production, replace `sendVerificationRequest` with a
 * real email sender (e.g. Resend/SMTP) keyed by an env var — no other change is
 * required.
 */
export const ResetOTP = Email({
  id: "password-reset-otp",
  // 15-minute validity for the reset code.
  maxAge: 60 * 15,
  async generateVerificationToken() {
    // 6-digit numeric OTP from a cryptographically secure RNG (no Math.random).
    const digits = new Uint32Array(6);
    crypto.getRandomValues(digits);
    return Array.from(digits, (d) => (d % 10).toString()).join("");
  },
  async sendVerificationRequest({
    identifier: email,
    token,
  }: {
    identifier: string;
    token: string;
  }) {
    // DEV delivery: log the code. Replace with a real email provider in prod.
    console.info(
      JSON.stringify({
        level: "info",
        module: "auth/password-reset",
        message: "Password reset code issued",
        email,
        code: token,
        timestamp: new Date().toISOString(),
      })
    );
  },
});
