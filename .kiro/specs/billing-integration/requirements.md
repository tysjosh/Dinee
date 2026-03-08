# Billing Integration — Requirements

Close the gaps between the existing payment infrastructure (Paystack/Flutterwave providers, SubscriptionService, BillingDashboard component) and a seamless end-to-end billing experience.

## Requirement 1: Wire BillingDashboard into the Dashboard UI

### User Story
As a restaurant owner, I want to see my current plan, usage, invoices, and upgrade options inside the dashboard so I can manage my subscription without leaving the app.

### Acceptance Criteria
- 1.1 A "Billing" tab is added to the dashboard navigation (DashboardLayout sidebar or settings section).
- 1.2 The BillingDashboard component renders with the authenticated user's subscription data from Convex.
- 1.3 If the user has no subscription, the NoSubscriptionState view is shown with a CTA to pick a plan.
- 1.4 Current plan card shows plan name, price, billing cycle, next renewal date, and trial days remaining (if trialing).
- 1.5 Usage section shows calls/month, orders/month, branches, menu items, and team members with progress bars against plan limits.

## Requirement 2: Paystack Checkout Redirect Flow

### User Story
As a restaurant owner, I want to be redirected to Paystack's hosted checkout page when I select a plan or when my trial ends, so I can pay securely.

### Acceptance Criteria
- 2.1 A Next.js API route `/client/api/v1/billing/checkout` accepts `{ planId, billingCycle, restaurantId }` and calls `SubscriptionService.initializeSubscription()` to get a Paystack checkout URL.
- 2.2 The frontend redirects the user to the Paystack checkout URL in a new tab or inline redirect.
- 2.3 A callback page at `/client/billing/callback` handles the Paystack redirect, verifies the transaction via `PaystackProvider.verifyTransaction()`, and updates the subscription status.
- 2.4 On successful payment, the subscription status changes from `trialing` or `pending` to `active` with correct `currentPeriodStart` and `currentPeriodEnd`.
- 2.5 On failed payment, the user sees an error message with a retry option.
- 2.6 The PlanPicker during onboarding uses this same checkout flow instead of just creating a `trialing` record (for users who want to pay immediately).

## Requirement 3: Subscription Webhook Handler

### User Story
As the system, I need to process Paystack webhook events for subscription lifecycle changes so subscription records stay in sync with payment status.

### Acceptance Criteria
- 3.1 The existing Paystack webhook route at `/client/api/v1/webhooks/paystack` is extended to handle subscription-related events: `charge.success` (for subscription payments), `invoice.payment_failed`, `subscription.disable`.
- 3.2 On `charge.success` with a subscription reference, the subscription's `currentPeriodEnd` is extended by one billing cycle and status is set to `active`.
- 3.3 On `invoice.payment_failed`, the subscription status is set to `past_due` and a retry is scheduled.
- 3.4 On `subscription.disable`, the subscription status is set to `cancelled`.
- 3.5 Each webhook event creates an invoice record in the `subscriptionInvoices` Convex table with amount, status, date, and Paystack reference.
- 3.6 Webhook signature verification uses the existing `PaystackProvider.verifyWebhookSignature()` method.

## Requirement 4: Trial Expiry Handling

### User Story
As the system, I need to automatically handle trial expirations so users are prompted to pay or downgraded gracefully.

### Acceptance Criteria
- 4.1 A Convex cron job runs daily and checks for subscriptions where `trialEndsAt < now` and `status === "trialing"`.
- 4.2 For expired trials, the subscription status is changed to `past_due`.
- 4.3 A banner is shown in the dashboard (via BillingReminderBanner) when the subscription is `past_due` or trial is ending within 3 days.
- 4.4 The banner includes a CTA button that triggers the Paystack checkout flow.
- 4.5 After 7 days in `past_due` status with no payment, the subscription is downgraded to `cancelled` and plan limits are enforced at the free/minimal tier.

## Requirement 5: Plan Limit Enforcement

### User Story
As the system, I need to enforce plan limits so users on lower tiers cannot exceed their allocated resources.

### Acceptance Criteria
- 5.1 Before creating a new branch, the system checks `SubscriptionService.checkSubscriptionLimits()` for `maxBranches`.
- 5.2 Before processing a new call, the system checks the monthly call count against `maxCallsPerMonth`.
- 5.3 Before creating a new order, the system checks the monthly order count against `maxOrdersPerMonth`.
- 5.4 Before adding a menu item, the system checks against `maxMenuItems`.
- 5.5 Before inviting a team member, the system checks against `maxTeamMembers`.
- 5.6 When a limit is reached, the user sees a clear message indicating which limit was hit and a CTA to upgrade.
- 5.7 `platform_admin` users bypass all plan limits.

## Requirement 6: Plan Upgrade/Downgrade Flow

### User Story
As a restaurant owner, I want to change my plan from the billing dashboard so I can scale up or down as my business needs change.

### Acceptance Criteria
- 6.1 The BillingDashboard's plan comparison section has "Upgrade" / "Downgrade" buttons per plan.
- 6.2 Upgrading triggers the Paystack checkout flow with the new plan's amount.
- 6.3 Downgrading takes effect at the end of the current billing period (no immediate change).
- 6.4 The subscription record is updated with `pendingPlanId` for scheduled downgrades.
- 6.5 On the next renewal, the cron job applies the pending plan change.

## Requirement 7: Invoice Storage and History

### User Story
As a restaurant owner, I want to see my payment history and download invoices so I can track my expenses.

### Acceptance Criteria
- 7.1 The `subscriptionInvoices` table already exists in the Convex schema with the required fields.
- 7.2 Invoice records are created by the webhook handler on each payment event.
- 7.3 The BillingDashboard's BillingHistorySection renders invoices from this table.
- 7.4 Each invoice row shows date, amount, status, and billing period.

## Requirement 8: Environment Configuration

### User Story
As a developer, I need the Paystack API keys configured so the payment flow works in development and production.

### Acceptance Criteria
- 8.1 `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` are documented in `.env.example`.
- 8.2 The PaystackProvider reads these from environment variables and fails gracefully with a clear error if missing.
- 8.3 Test mode is auto-detected from the key prefix (`sk_test_` vs `sk_live_`).
