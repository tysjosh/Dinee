/**
 * Admin_Console route (server component) — Platform Control Plane (Task 7.2).
 *
 * The Integration_Registry is an in-process Map populated per V8 isolate, so the
 * browser cannot enumerate it and a default-runtime Convex query cannot read it.
 * This server component projects the registry into a serializable, secret-free
 * {@link PlatformCatalog} at the Next.js server-render boundary (mirroring the
 * existing `/integrations/platform` page), then hands it to the client-side
 * {@link AdminConsole}. Only public metadata — platform id, display name,
 * credential-field specs, and conversation types — crosses to the client; the
 * adapter factory, runtime service tokens, and credential values never do
 * (Req 1.5, 11.1, 11.2).
 *
 * If the registry snapshot cannot be obtained, `getPlatformCatalog` throws a
 * typed {@link CatalogUnavailableError} rather than returning a partial catalog
 * (Req 1.7); this route catches it and renders a catalog-unavailable state.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10
 */

import {
  CatalogUnavailableError,
  getPlatformCatalog,
  type PlatformCatalog,
} from "@/lib/integrations/platform/catalog";
import AdminConsole from "./AdminConsole";

export default function ControlPlaneAdminPage() {
  let catalog: PlatformCatalog | null = null;
  try {
    catalog = getPlatformCatalog();
  } catch (error) {
    // A catalog-unavailable failure must not surface internals to the UI
    // (Req 1.7, 11). Render a safe fallback instead of a partial catalog.
    if (!(error instanceof CatalogUnavailableError)) {
      // Re-throw genuinely unexpected errors for the framework error boundary.
      throw error;
    }
  }

  if (!catalog) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="card max-w-md text-center">
          <div className="card-content space-y-2">
            <h1 className="text-lg font-semibold text-white">
              Platform catalog unavailable
            </h1>
            <p className="text-sm text-gray-400">
              The integration registry could not be read. Reload the page, and
              if the problem persists contact platform support.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <AdminConsole catalog={catalog} />;
}
