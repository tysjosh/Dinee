"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!convexClient) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="card-minimal rounded-xl border border-white/10 p-6 max-w-lg text-center">
          <h2 className="text-lg text-white text-minimal">
            Missing Convex Configuration
          </h2>
          <p className="text-sm text-white/70 mt-2">
            Set <span className="font-mono text-white/80">NEXT_PUBLIC_CONVEX_URL</span>{" "}
            in your environment to connect the dashboard.
          </p>
        </div>
      </div>
    );
  }

  return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}
