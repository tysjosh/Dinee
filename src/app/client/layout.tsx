import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ConvexClientProvider } from "@/components/providers/ConvexClientProvider";
import { ClientLayoutShell } from "@/components/auth/ClientLayoutShell";
import "../../globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Restaurant Call Management",
  description: "Manage AI agent calls and orders for your restaurant",
};

/**
 * Root layout component that wraps all client pages
 * Provides Convex client, auth guard for protected routes, and app context providers
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} h-full`}>
        <ConvexClientProvider>
          <ClientLayoutShell>{children}</ClientLayoutShell>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
