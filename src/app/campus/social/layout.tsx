import { SocialProvider } from "@/components/campus/social";

/**
 * Feature: campus-social-loops (Task 19.1)
 *
 * Layout for the Campus Social Loops surface (`/campus/social/**`). The parent
 * `/campus` layout already provides the Convex client (`ConvexClientProvider`),
 * so this layout only adds the domain-scoped `SocialProvider` that carries the
 * current user identity, `ageBand`, consent state, and companion-safety notices
 * shared across the six social screens.
 */
export default function CampusSocialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SocialProvider>{children}</SocialProvider>;
}
