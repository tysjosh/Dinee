# Billing Integration — Design

## Architecture Overview

This spec wires the existing payment infrastructure (PaystackProvider, FlutterwaveProvider, SubscriptionService, BillingDashboard) into a seamless end-to-end billing flow. The architecture follows the existing patterns: Convex for data/mutations, Next.js API routes for server-side Paystack calls, and React components for the UI.

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ BillingDash  │  │ PlanPicker   │  │ BillingBanner     │  │
│  │ (settings)   │  │ (onboarding) │  │ (dashboard header)│  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────────┘  │
│         │                 │                   │              │
│         ▼                 ▼                   ▼              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           /api/v1/billing/checkout (API route)       │    │
│  └──────────────────────┬──────────────────────────────┘    │
└─────────────────────────┼───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Paystack API                              │
│  initializeTransaction → hosted checkout → callback          │
│  verifyTransaction ← webhook events                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Convex Backend                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ subscriptions│  │ subscription │  │ billingEvents     │  │
│  │ (table)      │  │ Invoices     │  │ (usage tracking)  │  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Cron: checkTrialExpiry (daily)                        │   │
│  │ Cron: applyPendingPlanChanges (daily)                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Component Design

### 1. Billing Tab in Dashboard (Req 1)

Add a "Billing" section to the DashboardLayout. The existing `DashboardLayout` uses a `currentView` state with sections like `dashboard`, `calls`, `orders`, `menu`, `settings`. Add `billing` as a new view.

The `BillingDashboard` component already exists at `src/components/dashboard/BillingDashboard.tsx` with:
- `CurrentPlanCard` — plan name, price, renewal date, trial countdown
- `UsageSection` — progress bars for each limit
- `BillingHistorySection` — invoice table
- `PlanComparisonSection` — plan cards with upgrade/downgrade CTAs
- `NoSubscriptionState` — empty state with CTA
- `BillingReminderBanner` — trial ending / past_due warning

Wiring needed:
- Query `subscriptions` table by `restaurantId` to get the active subscription
- Query `subscriptionInvoices` table for invoice history
- Query usage data from Convex
- Pass data as props to `BillingDashboard`

### 2. Checkout API Route (Req 2)

New file: `src/app/client/api/v1/billing/checkout/route.ts`

```typescript
// POST handler
// 1. Validate request body: { planId, billingCycle, restaurantId }
// 2. Create SubscriptionService instance with callback URL
// 3. Call initializeSubscription() which calls PaystackProvider.initializeTransaction()
// 4. Save subscription record to Convex
// 5. Return { checkoutUrl, reference } to frontend
```

New file: `src/app/client/billing/callback/page.tsx`

```typescript
// Client component
// 1. Read ?reference= from URL params
// 2. Call /api/v1/billing/verify with the reference
// 3. On success: redirect to dashboard with success toast
// 4. On failure: show error with retry button
```

New file: `src/app/client/api/v1/billing/verify/route.ts`

```typescript
// POST handler
// 1. Call PaystackProvider.verifyTransaction(reference)
// 2. Update subscription in Convex: status → active, set period dates
// 3. Create invoice record
// 4. Return { success, subscription }
```

### 3. Webhook Extension (Req 3)

Modify: `src/app/client/api/v1/webhooks/paystack/route.ts`

The existing handler processes order-related `charge.success` events. Extend it to:
- Detect subscription-related events by checking for `metadata.subscriptionId` or `metadata.type === "subscription"`
- Route to a new `handleSubscriptionWebhook()` function
- Handle `invoice.payment_failed` and `subscription.disable` events
- Create invoice records in `subscriptionInvoices` table

### 4. Trial Expiry Cron (Req 4)

Extend existing `convex/crons.ts` with:

```typescript
crons.daily(
  "check-trial-expiry",
  { hourUTC: 2, minuteUTC: 0 },
  internal.subscriptions.checkTrialExpiry
);

crons.daily(
  "enforce-past-due",
  { hourUTC: 3, minuteUTC: 0 },
  internal.subscriptions.enforcePastDue
);

crons.daily(
  "apply-pending-plan-changes",
  { hourUTC: 4, minuteUTC: 0 },
  internal.subscriptions.applyPendingPlanChanges
);
```

Add internal mutations to `convex/subscriptions.ts`:
- `checkTrialExpiry`: query trialing subs where `trialEndsAt < Date.now()`, set status to `past_due`
- `enforcePastDue`: query `past_due` subs older than 7 days, set to `cancelled`
- `applyPendingPlanChanges`: query subs with `pendingPlanId` where `currentPeriodEnd < Date.now()`, apply the plan change

### 5. Plan Limit Enforcement (Req 5)

Create a reusable hook: `src/hooks/usePlanLimits.ts`

```typescript
export function usePlanLimits() {
  const subscription = useQuery(api.subscriptions.getSubscriptionByRestaurant, { restaurantId });
  const usage = useQuery(api.subscriptions.getSubscriptionUsage, { ... });
  
  return {
    canCreateBranch: () => checkLimit(usage.branches, subscription.limits.maxBranches),
    canProcessCall: () => checkLimit(usage.calls, subscription.limits.maxCallsPerMonth),
    canCreateOrder: () => checkLimit(usage.orders, subscription.limits.maxOrdersPerMonth),
    canAddMenuItem: () => checkLimit(usage.menuItems, subscription.limits.maxMenuItems),
    canInviteTeamMember: () => checkLimit(usage.teamMembers, subscription.limits.maxTeamMembers),
    isAdmin: userRole === "platform_admin",
  };
}
```

### 6. Upgrade/Downgrade Flow (Req 6)

The `BillingDashboard` already has `onChangePlan` and `onCancelSubscription` callback props. Wire them:

- **Upgrade**: Call the checkout API route with the new planId.
- **Downgrade**: Call a new `schedulePlanChange` mutation that sets `pendingPlanId`. The daily cron applies it at period end.
- **Cancel**: Set `cancelAtPeriodEnd: true` on the subscription.

### 7. Schema Updates

Add `pendingPlanId` and `cancelAtPeriodEnd` fields to the subscriptions table:

```typescript
pendingPlanId: v.optional(v.string()),
cancelAtPeriodEnd: v.optional(v.boolean()),
```

## Correctness Properties

- **P1: Checkout URL validity** — For any valid planId and billingCycle, the checkout API returns a non-empty URL starting with `https://checkout.paystack.com/` (or test equivalent).
- **P2: Webhook idempotency** — Processing the same webhook event twice produces the same subscription state (no duplicate invoices, no double period extension).
- **P3: Trial expiry determinism** — For any subscription with `trialEndsAt < now` and `status === "trialing"`, the cron always transitions it to `past_due`.
- **P4: Plan limit monotonicity** — For any usage count and plan limit, `checkLimit(usage, limit)` returns `false` iff `usage >= limit` (unless limit is unlimited).
- **P5: Downgrade scheduling** — For any downgrade request, the plan change is never applied before `currentPeriodEnd`.
- **P6: Invoice completeness** — For every `charge.success` webhook event, exactly one invoice record is created.
- **P7: Admin bypass** — For any `platform_admin` user, all plan limit checks return `true` regardless of usage.

## Files to Create/Modify

### New Files
- `src/app/client/api/v1/billing/checkout/route.ts`
- `src/app/client/api/v1/billing/verify/route.ts`
- `src/app/client/billing/callback/page.tsx`
- `src/hooks/usePlanLimits.ts`

### Modified Files
- `convex/schema.ts` — add `pendingPlanId`, `cancelAtPeriodEnd` to subscriptions table
- `convex/subscriptions.ts` — add internal mutations for cron jobs, `schedulePlanChange` mutation
- `convex/crons.ts` — add billing cron jobs
- `src/app/client/api/v1/webhooks/paystack/route.ts` — extend for subscription events
- `src/components/dashboard/DashboardLayout.tsx` — add Billing nav item, render BillingReminderBanner
- `src/components/dashboard/BillingDashboard.tsx` — wire real data props
- `.env.example` — document PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY
