import type { EscalationTarget } from "@/lib/modules/voiceDomainPack";

/**
 * Pure, dependency-free validation for Dinee-owned Runsheet integration config.
 *
 * The primary concern here is the Escalation_Target (Req 9.4, 9.7): an
 * Escalation_Target must be exactly one of a valid phone number, email address,
 * or webhook URL. An invalid target is rejected with an error indicating the
 * invalid value, and the caller is expected to leave the previously stored
 * Escalation_Target unchanged — {@link applyEscalationTarget} encodes that
 * "leave-unchanged-on-invalid" semantic so mutations cannot corrupt config.
 *
 * This module is intentionally pure (no Convex, no I/O) so it is unit- and
 * property-testable in isolation and can be reused by both the config mutation
 * and the Admin UI.
 *
 * Requirements: 9.4, 9.7
 */

/**
 * E.164 phone number format: `+` followed by a non-zero leading digit and
 * 1–14 more digits. Kept consistent with the platform's canonical E.164 rule in
 * `convex/shared/phoneProvisioningTypes.ts` (duplicated here to keep this
 * validator free of the Convex module boundary).
 */
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/**
 * Pragmatic single-address email check: a non-empty local part, a single `@`,
 * a domain with at least one dot, no whitespace, and no consecutive dots. This
 * is deliberately conservative rather than a full RFC 5322 parser.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The three kinds an Escalation_Target may take (Req 9.4). */
export const ESCALATION_TARGET_KINDS = ["phone", "email", "webhook"] as const;
export type EscalationTargetKind = (typeof ESCALATION_TARGET_KINDS)[number];

/** Structured rejection describing why an Escalation_Target was refused (Req 9.7). */
export interface EscalationTargetError {
  code: "invalid_escalation_target";
  /** The kind that was submitted, or the raw kind string when unrecognized. */
  kind: string;
  /** The offending value, echoed back so the admin sees what was rejected (Req 9.7). */
  invalidValue: string;
  /** Human-readable reason naming the invalid value. */
  detail: string;
}

export type ValidateEscalationTargetResult =
  | { ok: true; target: EscalationTarget }
  | { ok: false; error: EscalationTargetError };

/** Returns true when `value` is a valid E.164 phone number. */
export function isValidPhoneValue(value: string): boolean {
  return E164_REGEX.test(value);
}

/** Returns true when `value` is a syntactically valid single email address. */
export function isValidEmailValue(value: string): boolean {
  if (value.length > 254) return false;
  if (value.includes("..")) return false;
  return EMAIL_REGEX.test(value);
}

/**
 * Returns true when `value` is a valid webhook URL: an absolute `http`/`https`
 * URL with a non-empty host. `https` is expected for escalation webhooks, but
 * plain `http` is accepted so local/testing endpoints remain configurable.
 */
export function isValidWebhookValue(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return parsed.hostname.length > 0;
}

function isEscalationTargetKind(kind: unknown): kind is EscalationTargetKind {
  return (
    typeof kind === "string" &&
    (ESCALATION_TARGET_KINDS as readonly string[]).includes(kind)
  );
}

/**
 * Validates an Escalation_Target as exactly one of a valid phone number, email
 * address, or webhook URL (Req 9.4). On failure returns an error naming the
 * invalid value; it never throws (Req 9.7).
 *
 * Accepts `unknown` because the candidate typically originates from untrusted
 * admin input rather than a statically-typed value.
 */
export function validateEscalationTarget(
  candidate: unknown
): ValidateEscalationTargetResult {
  if (typeof candidate !== "object" || candidate === null) {
    return {
      ok: false,
      error: {
        code: "invalid_escalation_target",
        kind: "",
        invalidValue: String(candidate),
        detail: "Escalation target must be an object with a kind and a value.",
      },
    };
  }

  const { kind, value } = candidate as { kind?: unknown; value?: unknown };

  if (!isEscalationTargetKind(kind)) {
    return {
      ok: false,
      error: {
        code: "invalid_escalation_target",
        kind: typeof kind === "string" ? kind : String(kind),
        invalidValue: typeof value === "string" ? value : String(value),
        detail: `Escalation target kind must be one of ${ESCALATION_TARGET_KINDS.join(", ")}.`,
      },
    };
  }

  if (typeof value !== "string" || value.length === 0) {
    return {
      ok: false,
      error: {
        code: "invalid_escalation_target",
        kind,
        invalidValue: typeof value === "string" ? value : String(value),
        detail: `Escalation target of kind "${kind}" requires a non-empty value.`,
      },
    };
  }

  const valid =
    kind === "phone"
      ? isValidPhoneValue(value)
      : kind === "email"
        ? isValidEmailValue(value)
        : isValidWebhookValue(value);

  if (!valid) {
    return {
      ok: false,
      error: {
        code: "invalid_escalation_target",
        kind,
        invalidValue: value,
        detail: `"${value}" is not a valid ${kind} escalation target.`,
      },
    };
  }

  return { ok: true, target: { kind, value } as EscalationTarget };
}

/** Outcome of attempting to set an Escalation_Target while preserving the prior value on failure. */
export interface ApplyEscalationTargetResult {
  /** true when the candidate was valid and adopted; false when rejected. */
  accepted: boolean;
  /** The resulting target: the candidate when accepted, otherwise the unchanged existing target (Req 9.7). */
  target: EscalationTarget | undefined;
  /** Present only when the candidate was rejected. */
  error?: EscalationTargetError;
}

/**
 * Applies a candidate Escalation_Target on top of an existing one. A valid
 * candidate replaces the existing target; an invalid candidate is rejected and
 * the existing target is returned unchanged (Req 9.7). This is the function a
 * config mutation should use so a bad update can never overwrite good config.
 */
export function applyEscalationTarget(
  existing: EscalationTarget | undefined,
  candidate: unknown
): ApplyEscalationTargetResult {
  const result = validateEscalationTarget(candidate);
  if (!result.ok) {
    return { accepted: false, target: existing, error: result.error };
  }
  return { accepted: true, target: result.target };
}
