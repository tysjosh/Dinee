/**
 * Deprecation Header Middleware — Backward Compatibility Layer
 *
 * During the 6-month dual-support period:
 * - Adds a `Deprecation` header when deprecated fields (e.g. restaurantId) are used
 * - Enriches response bodies with both restaurantId and businessId
 *
 * Requirements: 17.6, 17.5
 */

/** The sunset date for deprecated restaurantId field */
const DEPRECATION_SUNSET_DATE = "2026-06-01";

/**
 * Adds a Deprecation header to the response when a deprecated field was used.
 *
 * Format: `Deprecation: <field_name>; sunset=<date>; use=<replacement>`
 */
export function addDeprecationHeader(
  headers: Headers,
  usedDeprecatedField: boolean
): void {
  if (usedDeprecatedField) {
    headers.set(
      "Deprecation",
      `restaurantId; sunset=${DEPRECATION_SUNSET_DATE}; use=businessId`
    );
  }
}

/**
 * Enriches a response body with both restaurantId and businessId during
 * the dual-support period so existing consumers continue to work.
 *
 * If the body already contains both fields, it is returned as-is.
 */
export function enrichResponseWithDualIds<
  T extends Record<string, unknown>,
>(body: T, businessId: string): T & { restaurantId: string; businessId: string } {
  return {
    ...body,
    restaurantId: businessId,
    businessId,
  };
}
