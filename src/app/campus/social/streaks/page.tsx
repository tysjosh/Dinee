import { SocialShell } from "@/components/campus/social/ui";
import { StreaksBadgesScreen } from "@/components/campus/social";

/**
 * Feature: campus-social-loops (Task 19.1)
 * Route `/campus/social/streaks` — Streaks & Badges (Req 5.x, 8.7–8.10).
 */
export default function StreaksBadgesPage() {
  return (
    <SocialShell title="Streaks & Badges" subtitle="Track your streaks and the badges you've earned.">
      <StreaksBadgesScreen />
    </SocialShell>
  );
}
