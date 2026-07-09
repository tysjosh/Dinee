import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ConvexClientProvider } from "@/components/providers/ConvexClientProvider";
import "../../globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dinee Campus — Create an AI voice agent",
  description:
    "Create an AI voice agent. Give it knowledge, personality, and a call link. Share it with your campus.",
};

/**
 * Root layout for the student-facing Dinee Campus surface (`/campus/**`).
 *
 * Isolated from the restaurant `/client/**` surface: it provides the Convex
 * client (with `@convex-dev/auth`) so campus pages can read/write Convex, but it
 * deliberately does NOT wrap children in the tenant-based `AuthGuard`. The
 * campus landing, onboarding, discovery, and public-profile routes are usable
 * without a tenant; authentication is only required to complete the
 * Onboarding_Flow, which is enforced inline at the completion boundary
 * (Req 1.4, 1.5, 2.8).
 */
export default function CampusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full bg-black text-white`}>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
