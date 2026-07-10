import { SocialShell } from "@/components/campus/social/ui";
import { ShareClipsScreen } from "@/components/campus/social";

/**
 * Feature: campus-social-loops (Task 19.1)
 * Route `/campus/social/clips` — Share Clips (Req 3.x, 8.7–8.10).
 */
export default function ShareClipsPage() {
  return (
    <SocialShell title="Share Clips" subtitle="Turn a good call into a ready-to-post captioned clip.">
      <ShareClipsScreen />
    </SocialShell>
  );
}
