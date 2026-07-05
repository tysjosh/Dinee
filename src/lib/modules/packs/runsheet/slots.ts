/**
 * Runsheet fuel-intake slot definitions and the transient Order_Draft builder.
 *
 * This module defines the required-slot contract for the Fuel_Intake_Agent and
 * the pure `buildOrderDraft` function that turns collected slot state into the
 * transient, non-authoritative `Order_Draft`.
 *
 * OWNERSHIP BOUNDARY (design §"Ownership boundary", Req 10.7, 20.2, 20.3):
 * The `OrderDraft` produced here is held ONLY in session memory. It is NEVER
 * persisted to a Dinee Convex table — there is no `orderDrafts` table. The
 * Runsheet backend is the system of record once the draft is submitted over the
 * Intake_Contract. `buildOrderDraft` is a pure function over its inputs.
 *
 * Encoded rules:
 * - Invalid values are not recorded and are re-requested (Req 5.10): a raw value
 *   that fails a slot's `validate` never appears in `slots`; the slot stays
 *   unresolved.
 * - A required slot still unresolved after 3 requests is marked missing
 *   (Req 5.9): it appears in `missingSlots`.
 * - A purchase-order number is required only WHERE the tenant requires it
 *   (Req 5.6): `po_number.required(tenant)` reflects the tenant config.
 * - Urgency is constrained to exactly one of `normal` / `urgent` / `emergency`
 *   (Req 5.7).
 * - Every collected (validated) slot value appears in `slots` (Req 5.11).
 * - The draft carries a confidence score in `[0, 1]` (Req 5.8).
 *
 * Requirements: 5.6, 5.7, 5.8, 5.9, 5.10, 5.11
 */

/**
 * The slots the Fuel_Intake_Agent collects during a fuel order call
 * (Req 5.1–5.7). `customer` accepts either a customer/account name or a callback
 * phone number (Req 5.1).
 */
export type SlotKey =
  | "customer"
  | "delivery_site"
  | "product_code"
  | "quantity"
  | "delivery_window"
  | "po_number"
  | "urgency";

/** The urgency levels an Order_Draft may record — exactly these three (Req 5.7). */
export type UrgencyLevel = "normal" | "urgent" | "emergency";

/** The three permitted urgency levels, in ascending severity (Req 5.7). */
export const URGENCY_LEVELS: readonly UrgencyLevel[] = ["normal", "urgent", "emergency"];

/**
 * The subset of a tenant's Runsheet integration configuration that slot
 * collection depends on. Kept intentionally minimal so this pure module has no
 * dependency on Convex or the wider integration record.
 */
export interface RunsheetTenantConfig {
  /**
   * WHERE the calling tenant requires a purchase order number, the PO slot is
   * required before an Order_Draft is produced (Req 5.6). Tenants that do not
   * require a PO leave this `false`.
   */
  requiresPurchaseOrder: boolean;
}

/**
 * The result of validating a raw slot value. A successful result carries the
 * normalized `value` that will be recorded on the draft; a failed result
 * carries no value, so the invalid input is never recorded (Req 5.10).
 */
export type SlotValidationResult = { ok: true; value: unknown } | { ok: false };

/**
 * A per-slot definition: whether it is required for the tenant, how a raw value
 * is validated/normalized, and the retry limit after which an unresolved
 * required slot is marked missing (Req 5.9).
 */
export interface SlotDefinition {
  /** Which order slot this definition governs. */
  key: SlotKey;
  /** Whether this slot is required for the given tenant (Req 5.6). */
  required: (tenant: RunsheetTenantConfig) => boolean;
  /** Validates + normalizes a raw caller value; failure is never recorded (Req 5.10). */
  validate: (raw: string) => SlotValidationResult;
  /** The number of requests after which an unresolved required slot is missing (Req 5.9). */
  maxRequests: 3;
}

/** The retry limit before an unresolved required slot is marked missing (Req 5.9). */
export const SLOT_MAX_REQUESTS = 3;

/** Trims a raw value and returns it only when it is non-empty. */
function nonEmpty(raw: string): { ok: true; value: string } | { ok: false } {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? { ok: true, value: trimmed } : { ok: false };
}

/**
 * A validated quantity: either an explicit gallon amount or a fill-to-full
 * request (Req 5.4).
 */
export type QuantityValue = { gallons: number } | { fillToFull: true };

/** Matches phrasings that indicate the caller wants the tank filled to full (Req 5.4). */
const FILL_TO_FULL_PATTERN = /\b(fill[\s-]?(to[\s-]?)?full|fill[\s-]?up|top[\s-]?off|full[\s-]?tank|topped[\s-]?off)\b/i;

/**
 * Validates a requested quantity (Req 5.4): a positive number of gallons or a
 * fill-to-full indication. Anything else (zero, negative, non-numeric text that
 * is not a fill-to-full phrase) fails and is not recorded (Req 5.10).
 */
function validateQuantity(raw: string): SlotValidationResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false };
  if (FILL_TO_FULL_PATTERN.test(trimmed)) {
    return { ok: true, value: { fillToFull: true } satisfies QuantityValue };
  }
  const match = trimmed.match(/\d+(?:\.\d+)?/);
  if (!match) return { ok: false };
  const gallons = Number(match[0]);
  if (!Number.isFinite(gallons) || gallons <= 0) return { ok: false };
  return { ok: true, value: { gallons } satisfies QuantityValue };
}

/**
 * Validates a reported urgency (Req 5.7): case-insensitively one of `normal`,
 * `urgent`, or `emergency`. Any other value fails and is not recorded.
 */
function validateUrgency(raw: string): SlotValidationResult {
  const normalized = raw.trim().toLowerCase();
  const match = URGENCY_LEVELS.find((level) => level === normalized);
  return match ? { ok: true, value: match } : { ok: false };
}

/**
 * The complete, ordered set of fuel-intake slot definitions.
 *
 * Required-for-all slots (Req 5.1–5.5): customer, delivery_site, product_code,
 * quantity, delivery_window. `po_number` is required only where the tenant
 * requires it (Req 5.6). `urgency` is recorded when the caller reports it
 * (Req 5.7) but is not itself a required slot.
 */
export const RUNSHEET_SLOT_DEFINITIONS: readonly SlotDefinition[] = [
  {
    key: "customer",
    required: () => true,
    validate: (raw) => nonEmpty(raw),
    maxRequests: SLOT_MAX_REQUESTS,
  },
  {
    key: "delivery_site",
    required: () => true,
    validate: (raw) => nonEmpty(raw),
    maxRequests: SLOT_MAX_REQUESTS,
  },
  {
    key: "product_code",
    required: () => true,
    validate: (raw) => {
      const result = nonEmpty(raw);
      return result.ok ? { ok: true, value: result.value.toUpperCase() } : { ok: false };
    },
    maxRequests: SLOT_MAX_REQUESTS,
  },
  {
    key: "quantity",
    required: () => true,
    validate: validateQuantity,
    maxRequests: SLOT_MAX_REQUESTS,
  },
  {
    key: "delivery_window",
    required: () => true,
    validate: (raw) => nonEmpty(raw),
    maxRequests: SLOT_MAX_REQUESTS,
  },
  {
    key: "po_number",
    required: (tenant) => tenant.requiresPurchaseOrder,
    validate: (raw) => nonEmpty(raw),
    maxRequests: SLOT_MAX_REQUESTS,
  },
  {
    key: "urgency",
    required: () => false,
    validate: validateUrgency,
    maxRequests: SLOT_MAX_REQUESTS,
  },
];

/** Fast lookup of a slot definition by key. */
const SLOT_DEFINITION_BY_KEY: ReadonlyMap<SlotKey, SlotDefinition> = new Map(
  RUNSHEET_SLOT_DEFINITIONS.map((definition) => [definition.key, definition])
);

/**
 * The collection state for a single slot as gathered over the call: the most
 * recent raw value the caller offered (if any) and how many times the agent has
 * requested the slot (Req 5.9).
 */
export interface SlotCollectionState {
  /** The most recent raw value the caller provided for this slot, if any. */
  rawValue?: string;
  /** How many times the agent has requested this slot (Req 5.9). */
  requestCount: number;
}

/**
 * The input to `buildOrderDraft`: the per-slot collection state gathered during
 * the call, the urgency the caller reported (if any), and the extraction
 * confidence. `buildOrderDraft` applies each slot's validator to the raw values,
 * so invalid values are never recorded (Req 5.10).
 */
export interface OrderDraftInput {
  /** Per-slot collection state gathered during the call. */
  slots: Partial<Record<SlotKey, SlotCollectionState>>;
  /**
   * Urgency reported by the caller, if any (Req 5.7). Used as a fallback when
   * the `urgency` slot was not collected through the slot pipeline. Defaults to
   * `normal`.
   */
  urgency?: UrgencyLevel;
  /** Confidence score for the extraction (Req 5.8); clamped into `[0, 1]`. */
  confidenceScore: number;
}

/**
 * The transient, non-authoritative in-session Order_Draft.
 *
 * This value lives ONLY in session memory. It is NOT a Dinee Convex table and is
 * never persisted as a Dinee order-of-record (Req 10.7, 20.3). The Runsheet
 * backend is the system of record once the draft is submitted.
 */
export interface OrderDraft {
  /** Collected (validated) slot values keyed by slot id (Req 5.11). */
  slots: Record<string, unknown>;
  /** Required slots still unresolved after 3 requests (Req 5.9). */
  missingSlots: string[];
  /** Urgency level, constrained to exactly three values (Req 5.7). */
  urgency: UrgencyLevel;
  /** Confidence score in `[0, 1]` (Req 5.8). */
  confidenceScore: number;
}

/** Clamps a confidence score into `[0, 1]`, treating non-finite input as `0` (Req 5.8). */
function clampConfidence(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

/**
 * Produces a transient `Order_Draft` from the collected slot state and tenant
 * config (Req 5.8, 5.11).
 *
 * For each slot the caller offered a value for, the slot's validator is applied:
 * a valid value is recorded in `slots` (Req 5.11); an invalid value is discarded
 * and never recorded (Req 5.10). A required slot (per the tenant, Req 5.6) that
 * remains unresolved after `maxRequests` (3) requests is marked in
 * `missingSlots` (Req 5.9). Urgency is constrained to the three-value enum
 * (Req 5.7) and confidence is clamped into `[0, 1]` (Req 5.8).
 *
 * Pure function: it does not mutate its inputs and performs no I/O or
 * persistence — the draft is transient (Req 10.7, 20.3).
 */
export function buildOrderDraft(
  input: OrderDraftInput,
  tenant: RunsheetTenantConfig
): OrderDraft {
  const slots: Record<string, unknown> = {};
  const missingSlots: string[] = [];
  let collectedUrgency: UrgencyLevel | undefined;

  for (const definition of RUNSHEET_SLOT_DEFINITIONS) {
    const state = input.slots[definition.key];
    let resolved = false;

    if (state?.rawValue !== undefined) {
      const result = definition.validate(state.rawValue);
      if (result.ok) {
        // Every collected (validated) value appears in `slots` (Req 5.11).
        slots[definition.key] = result.value;
        resolved = true;
        if (definition.key === "urgency" && isUrgencyLevel(result.value)) {
          collectedUrgency = result.value;
        }
      }
      // Invalid values are intentionally not recorded (Req 5.10).
    }

    // A required slot unresolved after 3 requests is marked missing (Req 5.9).
    const requestCount = state?.requestCount ?? 0;
    if (!resolved && definition.required(tenant) && requestCount >= definition.maxRequests) {
      missingSlots.push(definition.key);
    }
  }

  // Urgency is constrained to the three-value enum (Req 5.7): prefer a value
  // collected through the slot pipeline, then the explicit input, else `normal`.
  const urgency: UrgencyLevel =
    collectedUrgency ?? (isUrgencyLevel(input.urgency) ? input.urgency : "normal");

  return {
    slots,
    missingSlots,
    urgency,
    confidenceScore: clampConfidence(input.confidenceScore),
  };
}

/** Type guard for the urgency enum (Req 5.7). */
function isUrgencyLevel(value: unknown): value is UrgencyLevel {
  return typeof value === "string" && (URGENCY_LEVELS as readonly string[]).includes(value);
}

/**
 * Whether a draft is complete for the tenant: every required slot (per the
 * tenant, Req 5.6) has a recorded value in `slots`. In particular, a draft is
 * not complete while a required PO number is uncollected (Req 5.8).
 *
 * `buildOrderDraft` always returns a well-formed draft; completeness is a
 * separate predicate the session driver uses to decide whether the required
 * slots have all been collected (Req 5.8).
 */
export function isOrderDraftComplete(
  draft: OrderDraft,
  tenant: RunsheetTenantConfig
): boolean {
  return RUNSHEET_SLOT_DEFINITIONS.filter((definition) => definition.required(tenant)).every(
    (definition) => Object.prototype.hasOwnProperty.call(draft.slots, definition.key)
  );
}

/** Returns the slot definition for a key, or `undefined` if none exists. */
export function getSlotDefinition(key: SlotKey): SlotDefinition | undefined {
  return SLOT_DEFINITION_BY_KEY.get(key);
}
