/**
 * Feature: dinee-campus (Task 34.1) — Campus upgrade → existing checkout seam.
 *
 * The Campus upgrade CTA reuses the platform's SINGLE checkout entry point
 * (`POST /client/api/v1/billing/checkout`) rather than inventing a Campus-only
 * billing path. On payment confirmation the existing subscription webhook
 * updates the `subscriptions` table, and `campus.usage.getUsage`
 * (`resolveOwnerTier`) reads the new tier within 60s with no Campus-specific
 * billing code (Req 13.4, 13.5).
 *
 * INTEGRATION SEAM (documented, not worked around here). The existing checkout
 * endpoint is tenant-scoped: it authenticates the caller and requires a
 * `restaurantId` the caller OWNS with a tenant-owner role
 * (`restaurant_owner`/`business_owner`), and it prices against the
 * restaurant-tier plan catalog (`SUBSCRIPTION_PLANS`). A Student_Creator has the
 * `student_creator` role and generally no owned tenant, so a raw campus call is
 * rejected (401/403) until the platform provisions a campus account key + campus
 * plan id for that endpoint. This helper therefore:
 *   1. forwards the creator's Convex Auth token and the account key we have, and
 *   2. surfaces the endpoint's own response (including the seam error) verbatim
 *      to the caller, so the upgrade page can show an honest message and the
 *      follow-up work (campus plan/account provisioning on the checkout route)
 *      is a localized change behind this one seam rather than a parallel system.
 */

import type { BillingCycle } from "@/lib/billing/types";

/** The default campus paid-creator plan id sent to the reused checkout route. */
export const CAMPUS_UPGRADE_PLAN_ID = "campus_creator";

/** The shared checkout entry point reused by every upgrade surface. */
export const CHECKOUT_ENDPOINT = "/client/api/v1/billing/checkout";

export interface CampusUpgradeCheckoutArgs {
  /** The creator's Convex Auth bearer token (from `useAuthToken`). */
  readonly authToken: string | null | undefined;
  /**
   * The account key the checkout route scopes the subscription to. For campus
   * this is the creator's account key; see the seam note above.
   */
  readonly accountKey: string;
  /** The campus paid-creator plan id (defaults to {@link CAMPUS_UPGRADE_PLAN_ID}). */
  readonly planId?: string;
  /** Monthly or yearly billing cycle. */
  readonly billingCycle: BillingCycle;
}

export type CampusUpgradeCheckoutResult =
  | { readonly ok: true; readonly checkoutUrl: string }
  | { readonly ok: false; readonly error: string };

/**
 * Initiates an upgrade by calling the EXISTING checkout endpoint and returning
 * the hosted checkout URL (which the caller then redirects to). Never throws:
 * transport/parse failures and endpoint errors are normalized into an `ok:false`
 * result carrying a student-facing message.
 */
export async function startCampusUpgradeCheckout(
  args: CampusUpgradeCheckoutArgs
): Promise<CampusUpgradeCheckoutResult> {
  const { authToken, accountKey, billingCycle } = args;
  const planId = args.planId ?? CAMPUS_UPGRADE_PLAN_ID;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  let response: Response;
  try {
    response = await fetch(CHECKOUT_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        planId,
        billingCycle,
        // The reused route names this field `restaurantId`, but it is a generic
        // account key (see `resolveOwnerTier`); campus passes its account key.
        restaurantId: accountKey,
      }),
    });
  } catch {
    return {
      ok: false,
      error: "We couldn't reach checkout just now. Please try again.",
    };
  }

  let payload: { checkoutUrl?: string; error?: string } = {};
  try {
    payload = (await response.json()) as { checkoutUrl?: string; error?: string };
  } catch {
    payload = {};
  }

  if (response.ok && payload.checkoutUrl) {
    return { ok: true, checkoutUrl: payload.checkoutUrl };
  }

  return {
    ok: false,
    error:
      payload.error ??
      "Upgrades aren't available for this account yet. Please try again later.",
  };
}
