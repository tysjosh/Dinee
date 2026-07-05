/**
 * Partner_Console route (server component) — platform-control-plane (Task 7.3).
 *
 * Builds the serializable, secret-free {@link PlatformCatalog} on the SERVER via
 * `getPlatformCatalog()` (registering built-in platforms and snapshotting the
 * in-process Integration_Registry), then hands it to the client-side
 * {@link PartnerConsole} as a serializable prop. This mirrors the established
 * server-render catalog pattern in
 * `src/app/client/dashboard/integrations/platform/page.tsx`.
 *
 * The catalog projection happens server-side because a `PlatformDefinition`
 * carries a non-serializable adapter factory that cannot cross the
 * server→client boundary; only the plain catalog (platformId, displayName,
 * credentialFields, conversationTypes) is passed to the client, which renders
 * credential inputs dynamically from each platform's `credentialFields`.
 *
 * This is a NEW route that does not overlap any `/api/v1/...` path and does not
 * touch the existing `/integrations/platform` page (Req 12.4, 12.5).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { getPlatformCatalog } from "@/lib/integrations/platform/catalog";
import PartnerConsole from "./PartnerConsole";

export default function PartnerConsolePage() {
  // Server-boundary projection of the in-process registry into a serializable,
  // secret-free catalog. Idempotent registration makes this safe on every
  // render (mirrors the existing platform admin page).
  const catalog = getPlatformCatalog();

  return <PartnerConsole catalog={catalog} />;
}
