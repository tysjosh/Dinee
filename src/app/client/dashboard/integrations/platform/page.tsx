/**
 * Generic Integration Admin route (server component).
 *
 * Resolves the target Platform_Definition from the in-process
 * Integration_Registry on the SERVER (registering built-in platforms first),
 * then hands a serializable descriptor — `platformId`, `displayName`, and the
 * declared `credentialFields` — to the client-side {@link PlatformIntegrationAdmin}.
 *
 * The resolution happens server-side because a `PlatformDefinition` carries a
 * non-serializable adapter factory (whose module transitively imports Node
 * `crypto`), so it cannot cross the server→client boundary. Only the plain,
 * serializable descriptor is passed to the client component, which renders the
 * credential inputs dynamically from `credentialFields` (Req 9.1).
 *
 * Runsheet is the first platform onboarded onto the generic system, so it drives
 * the form here. The component itself is platform-agnostic.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5 (multi-platform-voice-integrations)
 */

import PlatformIntegrationAdmin, {
  type PlatformUiDescriptor,
} from "@/components/dashboard/PlatformIntegrationAdmin";
import { resolvePlatform } from "@/lib/integrations/platform/registry";
import {
  registerRunsheetPlatform,
  RUNSHEET_PLATFORM_ID,
} from "@/lib/integrations/runsheet/platform";

export default function PlatformIntegrationAdminPage() {
  // Register built-in platforms (Runsheet — the first adapter) before resolving.
  // Idempotent, so this is safe on every render.
  registerRunsheetPlatform();

  const resolved = resolvePlatform(RUNSHEET_PLATFORM_ID);
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
