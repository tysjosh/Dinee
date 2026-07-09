import { CreatorPage } from "@/components/campus/CreatorPage";

/**
 * Feature: dinee-campus (Task 40.1)
 *
 * Route `/campus/u/[handle]` — the public Creator_Page (Req 15.15–15.18). The
 * `handle` is the Student_Creator's `campusHandle`. It is read here (server) and
 * handed to the client `CreatorPage`, which runs the access-gated
 * `campus.creators.getCreatorPage` query and renders the public agent list,
 * the empty-state, or the hidden→unavailable state.
 *
 * In the Next.js 15 App Router `params` is async, so the page awaits it before
 * rendering.
 */
export default async function CampusCreatorPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return <CreatorPage handle={handle} />;
}
