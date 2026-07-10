import { SocialShell } from "@/components/campus/social/ui";
import { AgentBattlesScreen } from "@/components/campus/social";

/**
 * Feature: campus-social-loops (Task 19.1)
 * Route `/campus/social/battles` — Agent Battles (Req 1.x, 8.7–8.10).
 */
export default function AgentBattlesPage() {
  return (
    <SocialShell title="Agent Battles" subtitle="Pit two agents head-to-head and let students vote.">
      <AgentBattlesScreen />
    </SocialShell>
  );
}
