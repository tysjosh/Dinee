import { AgentSettings } from "@/components/campus/AgentSettings";

/**
 * Feature: dinee-campus (Task 33.2)
 *
 * Route `/campus/dashboard/[agentId]/settings` — the owner-gated settings /
 * privacy surface (Req 12.1–12.6, 12.9). The `agentId` is the target
 * Campus_Agent's public id; it is read here (server) and handed to the client
 * `AgentSettings`, which runs the owner-gated `campus.privacy.getAgentSettings`
 * query and wires the visibility/recording/summary toggles, the knowledge /
 * call-history / agent deletion actions, and the data-usage disclosure.
 *
 * In the Next.js 15 App Router `params` is async, so the page awaits it before
 * rendering.
 */
export default async function CampusAgentSettingsPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return <AgentSettings agentId={agentId} />;
}
