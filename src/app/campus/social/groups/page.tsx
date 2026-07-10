import { SocialShell } from "@/components/campus/social/ui";
import { GroupChatScreen } from "@/components/campus/social";

/**
 * Feature: campus-social-loops (Task 19.1)
 * Route `/campus/social/groups` — Group Chat Mode (Req 4.x, 8.7–8.10).
 */
export default function GroupChatPage() {
  return (
    <SocialShell title="Group Chat Mode" subtitle="Drop your agent into a group chat via a share link.">
      <GroupChatScreen />
    </SocialShell>
  );
}
