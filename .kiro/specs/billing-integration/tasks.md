# Billing Integration — Tasks

## 1. Schema and data layer
- [x] 1.1 Add `pendingPlanId` and `cancelAtPeriodEnd` fields to the subscriptions table in `convex/schema.ts`
  - Requirements: 6.4
- [x] 1.2 Add internal mutations to `convex/subscriptions.ts`: `checkTrialExpiry`, `enforcePastDue`, `applyPendingPlanChanges`, `schedulePlanChange`
  - Requirements: 4.1, 4.2, 4.5, 6.4, 6.5

## 2. Checkout flow
- [x] 2.1 Create `src/app/client/api/v1/billing/checkout/route.ts` — POST handler that validates `{ planId, billingCycle, restaurantId }`, calls `SubscriptionService.initializeSubscription()`, returns `{ checkoutUrl, reference }`
  - Requirements: 2.1
- [x] 2.2 Create `src/app/client/api/v1/billing/verify/route.ts` — POST handler that calls `PaystackProvider.verifyTransaction(reference)`, updates subscription status to `active`, creates invoice record
  - Requirements: 2.3, 2.4
- [x] 2.3 Create `src/app/client/billing/callback/page.tsx` — client page that reads `?reference=` from URL, calls verify endpoint, shows success/error state, redirects to dashboard
  - Requirements: 2.3, 2.5

## 3. Webhook extension
- [x] 3.1 Extend `src/app/client/api/v1/webhooks/paystack/route.ts` to detect subscription-related events and route to `handleSubscriptionWebhook()`
  - Requirements: 3.1, 3.6
- [x] 3.2 Implement `handleSubscriptionWebhook()` — handle `charge.success` (extend period, set active), `invoice.payment_failed` (set past_due), `subscription.disable` (set cancelled), and create invoice records
  - Requirements: 3.2, 3.3, 3.4, 3.5

## 4. Trial expiry and cron jobs
- [x] 4.1 Add billing cron jobs to `convex/crons.ts`: `check-trial-expiry`, `enforce-past-due`, `apply-pending-plan-changes`
  - Requirements: 4.1, 4.5, 6.5

## 5. Plan limit enforcement
- [x] 5.1 Create `src/hooks/usePlanLimits.ts` — hook that queries subscription and usage data, returns limit check functions with admin bypass
  - Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7
- [x] 5.2 Create `src/components/ui/LimitReachedModal.tsx` — modal that shows which limit was hit and an upgrade CTA
  - Requirements: 5.6

## 6. Billing dashboard wiring
- [x] 6.1 Add "Billing" navigation item to `DashboardLayout` sidebar and a `billing` view state
  - Requirements: 1.1
- [x] 6.2 Create a `BillingDashboardContainer` wrapper that queries Convex for subscription, invoices, and usage data, then passes them as props to `BillingDashboard`
  - Requirements: 1.2, 1.3, 1.4, 1.5
- [x] 6.3 Wire `onChangePlan` to trigger checkout API for upgrades and `schedulePlanChange` mutation for downgrades; wire `onCancelSubscription` to set `cancelAtPeriodEnd`
  - Requirements: 6.1, 6.2, 6.3, 6.4
- [x] 6.4 Render `BillingReminderBanner` in the dashboard header when subscription is `past_due` or trial ending within 3 days
  - Requirements: 4.3, 4.4

## 7. Environment and documentation
- [x] 7.1 Add `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` to `.env.example` with descriptions
  - Requirements: 8.1
- [x] 7.2 Add graceful error handling in `PaystackProvider` constructor when env vars are missing
  - Requirements: 8.2, 8.3
