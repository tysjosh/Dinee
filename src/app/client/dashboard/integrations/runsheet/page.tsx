import { redirect } from "next/navigation";

/**
 * Legacy Runsheet-specific integration route — RETIRED.
 *
 * Runsheet is no longer a special case: connecting it now goes through the
 * single, platform-agnostic integration surface, which writes the generic
 * `integrations` store the voice runtime actually reads. This route previously
 * wrote the Runsheet-specific `runsheetIntegrations` store, whose post-migration
 * edits the runtime ignored (the stale-credential drift).
 *
 * Kept as a redirect so existing links/bookmarks resolve to the generic admin
 * pre-selected for Runsheet. The legacy Convex read paths remain intact until
 * all tenants are confirmed migrated (run `migrateRunsheet` once to copy any
 * legacy-only rows into the generic store).
 */
export default function RunsheetIntegrationRedirect() {
  redirect("/client/dashboard/integrations/platform?platform=runsheet");
}
