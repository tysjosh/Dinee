import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ResetOTP } from "./ResetOTP";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  // Password auth with a real reset flow: `reset` issues an OTP via ResetOTP
  // and `reset-verification` changes the credential Convex Auth actually uses.
  providers: [Password({ reset: ResetOTP })],
});
