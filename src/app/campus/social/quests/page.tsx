import { SocialShell } from "@/components/campus/social/ui";
import { CampusQuestsScreen } from "@/components/campus/social";

/**
 * Feature: campus-social-loops (Task 19.1)
 * Route `/campus/social/quests` — Campus Quests (Req 6.x, 8.7–8.10).
 */
export default function CampusQuestsPage() {
  return (
    <SocialShell title="Campus Quests" subtitle="Take on lightweight missions to discover agents.">
      <CampusQuestsScreen />
    </SocialShell>
  );
}
