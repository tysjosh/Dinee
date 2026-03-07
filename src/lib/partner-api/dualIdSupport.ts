/**
 * Dual ID Support — Backward Compatibility Layer
 *
 * During the 6-month dual-support period, API endpoints accept both
 * `restaurantId` (deprecated) and `businessId` (canonical) identifiers.
 *
 * Requirements: 17.4, 17.5
 */

export function normalizeBusinessId(
  params: Record<string, unknown>
): { businessId: string; usedDeprecatedField: boolean } {
  if (params.businessId) {
    return { businessId: params.businessId as string, usedDeprecatedField: false };
  }
  if (params.restaurantId) {
    return { businessId: params.restaurantId as string, usedDeprecatedField: true };
  }
  throw new Error("Either businessId or restaurantId is required");
}
