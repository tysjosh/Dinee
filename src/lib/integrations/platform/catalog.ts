// src/lib/integrations/platform/catalog.ts
//
// Platform_Catalog projection (Control_Plane Req 1).
//
// The Integration_Registry is an in-process Map populated per V8 isolate, so a
// browser cannot enumerate it and a default-runtime Convex query cannot read
// it. This module projects a snapshot of the registered Platform_Definitions
// into a serializable, secret-free Platform_Catalog that a browser can consume
// to drive integration forms.
//
// `buildPlatformCatalog` is PURE: it copies only public metadata
// (platformId, displayName, credentialFields, conversationTypes) and NEVER the
// adapter factory, the runtime service-token env var, or any credential value
// (Req 1.5, 11.1, 11.2). `getPlatformCatalog` is the Next.js server-boundary
// helper that registers the built-in platforms, snapshots the registry, and
// projects — throwing a typed "catalog unavailable" error rather than returning
// a partial catalog when the snapshot cannot be obtained (Req 1.7).
//
// Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 11.1, 11.2

import type { PlatformDefinition } from "./types";
import { listRegisteredPlatforms } from "./registry";
import { registerRunsheetPlatform } from "../runsheet/platform";

/** A serializable, secret-free catalog entry (Req 1.2, 1.5). */
export interface PlatformCatalogEntry {
  platformId: string;
  displayName: string;
  credentialFields: { name: string; label: string; required: boolean }[];
  /** Empty when the platform declares none (Req 1.4). */
  conversationTypes: string[];
}

export type PlatformCatalog = PlatformCatalogEntry[];

/**
 * Error thrown when the Integration_Registry snapshot cannot be obtained, so no
 * partial Platform_Catalog is ever returned (Req 1.7). Typed via `name` so the
 * server boundary can distinguish it from other failures.
 */
export class CatalogUnavailableError extends Error {
  constructor(message = "Platform catalog is unavailable", cause?: unknown) {
    super(message);
    this.name = "CatalogUnavailableError";
    // Preserve the underlying cause for diagnostics without leaking it to the UI.
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Projects a snapshot of registered PlatformDefinitions to a secret-free
 * catalog: exactly one entry per registered platformId — no duplicates and no
 * entry for an unregistered platform (Req 1.1). Copies ONLY serializable public
 * metadata (platformId, displayName, credentialFields, conversationTypes) and
 * NEVER the adapter factory, the runtime service-token env var, or any
 * credential value (Req 1.5, 11.1, 11.2). An empty snapshot yields an empty
 * catalog (Req 1.6).
 *
 * The registry already guarantees unique platformIds (a duplicate registration
 * is rejected), but this projection defends against duplicate inputs by keeping
 * the first entry seen for each platformId, so the catalog can never contain a
 * duplicate Platform_Id (Req 1.1).
 */
export function buildPlatformCatalog(
  defs: PlatformDefinition[],
): PlatformCatalog {
  const catalog: PlatformCatalog = [];
  const seen = new Set<string>();

  for (const def of defs) {
    if (seen.has(def.platformId)) {
      continue;
    }
    seen.add(def.platformId);

    // Copy credential-field specs by value, taking ONLY the public fields and
    // coercing `required` to a strict boolean (exactly true or false) (Req 1.2).
    const credentialFields = def.credentialFields.map((field) => ({
      name: field.name,
      label: field.label,
      required: field.required === true,
    }));

    // Conversation types: declared list copied by value, else an empty list
    // (Req 1.3, 1.4).
    const conversationTypes = Array.isArray(def.supportedConversationTypes)
      ? [...def.supportedConversationTypes]
      : [];

    catalog.push({
      platformId: def.platformId,
      displayName: def.displayName,
      credentialFields,
      conversationTypes,
    });
  }

  return catalog;
}

/**
 * Server-boundary helper: registers the built-in platforms (Runsheet — the
 * first adapter), snapshots the registry via `listRegisteredPlatforms`, and
 * projects it into a Platform_Catalog. Idempotent registration makes this safe
 * to call on every server render (mirroring the existing platform admin page).
 *
 * If the registry snapshot cannot be obtained, throws a typed
 * `CatalogUnavailableError` rather than returning a partial catalog (Req 1.7).
 * An empty (but readable) registry legitimately yields an empty catalog
 * (Req 1.6) and is NOT treated as an error.
 */
export function getPlatformCatalog(): PlatformCatalog {
  // Register built-in platforms before snapshotting. Idempotent and safe on
  // every render.
  registerRunsheetPlatform();

  let snapshot: PlatformDefinition[];
  try {
    snapshot = listRegisteredPlatforms();
  } catch (error) {
    throw new CatalogUnavailableError(
      "Platform catalog is unavailable: the integration registry could not be accessed",
      error,
    );
  }

  // A missing snapshot (not an empty array) means the registry could not be
  // read — surface catalog-unavailable rather than an empty catalog (Req 1.7).
  if (snapshot === undefined || snapshot === null) {
    throw new CatalogUnavailableError();
  }

  return buildPlatformCatalog(snapshot);
}
