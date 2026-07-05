/**
 * Feature: multi-platform-voice-integrations
 *
 * Pure wiring logic extracted from `PlatformIntegrationAdmin.tsx` so the
 * component's behavior can be unit-tested without a React DOM renderer (the
 * repo does not use jsdom/React Testing Library). The React component imports
 * these helpers and delegates to them, so its behavior is unchanged — only the
 * pure decision/transform logic has moved here to be importable and testable.
 *
 * Covered wiring behaviors (Requirement 9):
 *   - 9.1: `prepareSaveConfig` builds the exact arguments handed to the config
 *     store save action from the entered platformId/tenantId/baseUrl/credentials.
 *   - 9.2: `preparePhoneRoute` builds the (phoneNumber, platformId, tenantId,
 *     conversationType) arguments handed to the phone-route store.
 *   - 9.3: `connectionBadge` maps a returned Connection_Status to its display.
 *   - 9.4: `formatMaskedCredential` renders at most the last-4 of a credential,
 *     never a full/plaintext value.
 *   - 9.5: `prepareSaveConfig` blocks the save (returns `ok: false`) and names
 *     each missing required field.
 */

/**
 * A single credential the platform declares it needs. Mirrors
 * `CredentialFieldSpec` but is a plain serializable shape passed from the
 * server (the full `PlatformDefinition` carries a non-serializable factory).
 */
export interface PlatformCredentialField {
  name: string;
  label: string;
  required: boolean;
}

export type ConnectionStatus = "connected" | "disconnected" | "error";

/** Turns a namespaced conversation type into a human label. */
export function humanizeConversationType(type: string): string {
  return type
    .replace(/^[a-z0-9]+_/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Parses a comma / newline separated list into a trimmed, de-duped array. */
export function parseConversationTypes(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\n,]/)) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      seen.add(trimmed);
    }
  }
  return Array.from(seen);
}

/**
 * Renders the masked display of a stored credential (Req 9.4). Only the last-4
 * preview is ever shown; the returned string is a fixed mask followed by at
 * most the last 4 characters and never contains the full/plaintext value.
 */
export function formatMaskedCredential(last4: string): string {
  return `••••••••${last4}`;
}

/** Maps a Connection_Status to its badge class + label for display (Req 9.3). */
export function connectionBadge(status?: ConnectionStatus): {
  cls: string;
  label: string;
} {
  const map: Record<ConnectionStatus, { cls: string; label: string }> = {
    connected: { cls: "badge badge-success", label: "Connected" },
    disconnected: { cls: "badge badge-neutral", label: "Disconnected" },
    error: { cls: "badge badge-danger", label: "Error" },
  };
  return status ? map[status] : { cls: "badge badge-neutral", label: "Not configured" };
}

/** Turns a typed save rejection into a human-readable message (Req 9.5). */
export function describeSaveError(result: {
  code: "missing_field" | "unknown_platform";
  field: string;
}): string {
  if (result.code === "unknown_platform") {
    return `Platform "${result.field}" is not registered.`;
  }
  return `${result.field} is required.`;
}

// ============================================================================
// Config save preparation (Req 9.1, 9.5)
// ============================================================================

/** The raw form state captured by the config form. */
export interface ConfigFormInput {
  platformId: string;
  tenantId: string;
  baseUrl: string;
  platformTenantId: string;
  /** Credential inputs keyed by credential name (only entered values matter). */
  credentials: Record<string, string>;
  allowedTypesRaw: string;
  configRaw: string;
  actorUserId?: string;
  actorRole?: string;
}

/** The exact arguments handed to the config-store save action (Req 9.1). */
export interface SaveConfigArgs {
  platformId: string;
  tenantId: string;
  baseUrl: string;
  platformTenantId: string;
  credentials: Record<string, string>;
  allowedConversationTypes: string[];
  config: Record<string, unknown>;
  actorUserId?: string;
  actorRole?: string;
}

export type PrepareSaveResult =
  | { ok: true; args: SaveConfigArgs }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates the config form and, when valid, builds the arguments for the
 * config-store save action. A missing required field blocks the save and names
 * the offending field (Req 9.5). Only credential fields the admin actually
 * typed a value for are sent, so a blank field never overwrites a stored secret
 * (a field with a stored last-4 may be left blank). Optional platform config is
 * parsed from JSON; invalid JSON or a non-object blocks the save.
 */
export function prepareSaveConfig(
  input: ConfigFormInput,
  credentialFields: PlatformCredentialField[],
  storedLast4: Record<string, string> | undefined,
): PrepareSaveResult {
  const errors: Record<string, string> = {};

  if (!input.baseUrl.trim()) errors.baseUrl = "Base URL is required";
  if (!input.platformTenantId.trim())
    errors.platformTenantId = "Platform tenant ID is required";

  for (const field of credentialFields) {
    const entered = (input.credentials[field.name] ?? "").trim();
    const hasStored = Boolean(storedLast4?.[field.name]);
    if (field.required && !entered && !hasStored) {
      errors[field.name] = `${field.label} is required`;
    }
  }

  let config: Record<string, unknown> = {};
  if (input.configRaw.trim()) {
    try {
      const parsed = JSON.parse(input.configRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        config = parsed as Record<string, unknown>;
      } else {
        errors.config = "Config must be a JSON object";
      }
    } catch {
      errors.config = "Config must be valid JSON";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const credentials: Record<string, string> = {};
  for (const field of credentialFields) {
    const entered = (input.credentials[field.name] ?? "").trim();
    if (entered) credentials[field.name] = entered;
  }

  return {
    ok: true,
    args: {
      platformId: input.platformId,
      tenantId: input.tenantId,
      baseUrl: input.baseUrl.trim(),
      platformTenantId: input.platformTenantId.trim(),
      credentials,
      allowedConversationTypes: parseConversationTypes(input.allowedTypesRaw),
      config,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
    },
  };
}

// ============================================================================
// Phone-route assignment preparation (Req 9.2)
// ============================================================================

/** The exact arguments handed to the phone-route store save mutation. */
export interface PhoneRouteArgs {
  phoneNumber: string;
  platformId: string;
  tenantId: string;
  conversationType: string;
}

export type PreparePhoneRouteResult =
  | { ok: true; args: PhoneRouteArgs }
  | { ok: false; error: string };

/**
 * Validates the assign-number form and, when valid, builds the phone-route save
 * arguments (Req 9.2). A blank phone number or unselected conversation type
 * blocks the save with a message.
 */
export function preparePhoneRoute(input: {
  phoneNumber: string;
  platformId: string;
  tenantId: string;
  conversationType: string;
}): PreparePhoneRouteResult {
  if (!input.phoneNumber.trim() || !input.conversationType) {
    return {
      ok: false,
      error: "Enter a phone number and choose a conversation type.",
    };
  }
  return {
    ok: true,
    args: {
      phoneNumber: input.phoneNumber.trim(),
      platformId: input.platformId,
      tenantId: input.tenantId,
      conversationType: input.conversationType,
    },
  };
}
