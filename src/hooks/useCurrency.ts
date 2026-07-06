"use client";

import { useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useBusinessStorage } from "./useBusinessStorage";
import {
  formatMoney,
  getCurrencyForCountry,
  type CurrencyCode,
} from "@/lib/region";

/**
 * Resolves the current tenant's billing/display currency from its `country`
 * and exposes a currency-aware money formatter.
 *
 * This is the multi-region replacement for the various hardcoded Naira
 * formatters (`formatNaira`, `Intl.NumberFormat('en-NG', { currency: 'NGN' })`)
 * scattered across dashboard surfaces. US tenants (country === "US") see USD;
 * everyone else defaults to NGN, so existing Nigeria tenants are unaffected.
 */
export function useCurrency(): {
  currency: CurrencyCode;
  format: (amount: number) => string;
  loading: boolean;
} {
  const { businessId } = useBusinessStorage();

  const restaurant = useQuery(
    api.restaurants.getRestaurant,
    businessId ? { restaurantId: businessId } : "skip"
  );

  const currency = getCurrencyForCountry(
    (restaurant as { country?: string } | null | undefined)?.country
  );

  const format = useCallback(
    (amount: number) => formatMoney(amount, currency),
    [currency]
  );

  return {
    currency,
    format,
    loading: businessId != null && restaurant === undefined,
  };
}
