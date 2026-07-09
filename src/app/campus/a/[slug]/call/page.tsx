import { CallExperience } from "@/components/campus/CallExperience";

/**
 * Feature: dinee-campus (Task 32.1)
 *
 * Route `/campus/a/[slug]/call` — the browser call surface for a Campus_Agent,
 * the target of the "Call this agent" button on the Agent_Profile_Page
 * (Req 8.1). The `slug` is the Call_Link slug; an optional `?token=` carries the
 * Private_Link token so a private agent stays callable by an authorized Caller
 * (Req 6.10, 6.11). Both are read here (server) and handed to the client
 * `CallExperience`, which runs the usage gate → recording notice → call →
 * post-call options flow.
 *
 * In the Next.js 15 App Router `params` and `searchParams` are async, so the
 * page awaits them before rendering.
 */
export default async function CampusAgentCallPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { slug } = await params;
  const { token } = await searchParams;
  const privateLinkToken = Array.isArray(token) ? token[0] : token;

  return <CallExperience slug={slug} token={privateLinkToken} />;
}
