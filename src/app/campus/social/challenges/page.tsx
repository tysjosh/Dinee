import { SocialShell } from "@/components/campus/social/ui";
import { DailyChallengesScreen } from "@/components/campus/social";

/**
 * Feature: campus-social-loops (Task 19.1)
 * Route `/campus/social/challenges` — Daily Challenges (Req 2.x, 8.7–8.10).
 */
export default function DailyChallengesPage() {
  return (
    <SocialShell title="Daily Challenges" subtitle="Enter today's prompt and climb the campus leaderboard.">
      <DailyChallengesScreen />
    </SocialShell>
  );
}
