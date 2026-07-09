import { AgentProfile } from "@/components/campus/AgentProfile";

/**
 * Feature: dinee-campus (Task 30.1)
 *
 * Route `/campus/a/[slug]` — the public Agent_Profile_Page (Req 6.1–6.10, 7.6).
 * The `slug` is the Call_Link slug; an optional `?token=` carries a Private_Link
 * token authorizing access to a private agent (Req 6.10, 6.11). Both are read
 * here (server) and handed to the client `AgentProfile`, which runs the
 * access-gated `getPublicProfile` query and renders the profile, share sheet,
 * report flow, and save / remix controls.
 *
 * In the Next.js 15 App Router `params` and `searchParams` are async, so the
 * page awaits them before rendering.
 */
export default async function CampusAgentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { slug } = await params;
  const { token } = await searchParams;
  const privateLinkToken = Array.isArray(token) ? token[0] : token;

  return <AgentProfile slug={slug} token={privateLinkToken} />;
}
