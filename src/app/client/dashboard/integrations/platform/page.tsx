/**
 * Generic Integration Admin route (server component).
 *
 * The single, platform-agnostic surface for a tenant to connect ANY external
 * voice platform to Dinee. It resolves the target Platform_Definition from the
 * in-process Integration_Registry on the SERVER (registering built-in platforms
 * first), then hands a serializable descriptor — `platformId`, `displayName`,
 * and the declared `credentialFields` — to the client-side
 * {@link PlatformIntegrationAdmin}, which renders the credential inputs
 * dynamically. Runsheet is simply the first platform registered; there is no
 * Runsheet-specific code here.
 *
 * The platform is chosen via the `?platform=<id>` query param and defaults to
 * the first registered platform. Resolution happens server-side because a
 * `PlatformDefinition` carries a non-serializable adapter factory (whose module
 * transitively imports Node `crypto`), so only the plain descriptor crosses the
 * server→client boundary.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5 (multi-platform-voice-integrations)
 */

import PlatformIntegrationAdmin, {
  type PlatformUiDescriptor,
} from "@/components/dashboard/PlatformIntegrationAdmin";
import {
  resolvePlatform,
  listRegisteredPlatforms,
} from "@/lib/integrations/platform/registry";
import { registerRunsheetPlatform } from "@/lib/integrations/runsheet/platform";

/** Register all built-in platforms. Add future platform registrations here. */
function registerBuiltInPlatforms(): void {
  // Idempotent — safe to call on every render.
  registerRunsheetPlatform();
}

export default async function PlatformIntegrationAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>;
}) {
  registerBuiltInPlatforms();

  const registered = listRegisteredPlatforms();
  const { platform: requested } = await searchParams;
  // Default to the first registered platform when none is specified.
  const targetId = requested ?? registered[0]?.platformId;

  const resolved = targetId
    ? resolvePlatform(targetId)
    : ({ resolved: false } as const);

  const platform: PlatformUiDescriptor | null = resolved.resolved
    ? {
        platformId: resolved.definition.platformId,
        displayName: resolved.definition.displayName,
        // Only the serializable credential-field specs cross to the client.
        credentialFields: resolved.definition.credentialFields.map((f) => ({
          name: f.name,
          label: f.label,
          required: f.required,
        })),
      }
    : null;

  return <PlatformIntegrationAdmin platform={platform} />;
}
