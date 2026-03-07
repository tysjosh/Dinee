/**
 * Dual-ID mapper between businessId and restaurantId.
 *
 * Both functions currently return the input unchanged — the underlying
 * value is the same. The mapper exists to:
 *   1. Document the naming convention in one place
 *   2. Provide a single grep-able import for every ID translation
 *   3. Future-proof if ID formats ever diverge
 *
 * Requirement: REQ-1.1
 */

export function businessIdToRestaurantId(businessId: string): string {
  return businessId;
}

export function restaurantIdToBusinessId(restaurantId: string): string {
  return restaurantId;
}
