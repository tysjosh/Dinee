# Phase 0 TypeScript Error Quarantine List

_Feature: dinee-voice-platform — Requirement 1.1_

This document records the pre-existing `npm run type-check` errors found in the
baseline codebase during **Phase 0 stabilization**, before any `VoiceDomainPack`
refactor work begins. Per Requirement 1.1, each pre-existing error is either
**fixed** or **recorded in this quarantine list** naming the file and the error.

The zero-error type-check gate (Requirement 1.7) applies to the refactored
platform **only after Phase 0**, excluding the quarantined files listed below.

## Baseline

- Command: `npm run type-check` (`tsc --noEmit`)
- Total pre-existing errors at start of Phase 0: **53**
- Errors fixed in Phase 0: **41**
- Errors quarantined: **6** (across 2 files)

> **Update (post–task 4.9):** The 6 `convex/phoneProvisioning/scheduledFunctions.ts`
> errors were subsequently **fixed** by adding explicit `Promise<...>` return-type
> annotations to the `processQuarantineExpirations` and `runHealthChecks` handlers,
> which broke the circular type-inference cycle and let `npx convex codegen`
> re-emit those functions in the generated `internal.phoneProvisioning.scheduledFunctions`
> API type (resolving the downstream `convex/crons.ts` TS2339 errors). That file is
> no longer quarantined. The quarantine now covers **2 files** (`actions.ts`,
> `mutations.ts`), previously 3.

## Quarantined files and errors

All remaining errors are concentrated in the phone-provisioning /
scheduled-functions Convex modules. They are the classic Convex **circular
type-inference** errors: an `internalAction` / scheduled function handler calls
`ctx.runQuery` / `ctx.runAction` against the generated `internal.*` API, which
references the handler's own module, so TypeScript infers `any` for the handler
return type (`TS7023`) and for values derived from those calls (`TS7022`). The
`mutations.ts` `TS2345` errors are a related loosely-typed `ctx` parameter
mismatch on an internal helper.

Fixing these correctly requires cascading explicit return-type annotations
across the referenced queries/actions to break the inference cycle, which
carries real regression risk to the working provisioning flow. These are the
exact "phone provisioning" and "scheduled functions" categories called out in
Requirement 1.1 as quarantine candidates, and are deferred rather than fixed in
Phase 0.

### `convex/phoneProvisioning/actions.ts`

| Location | Error | Message |
|---|---|---|
| 350:14 | TS7022 | `'executeProvisioning'` implicitly has type `any` because it does not have a type annotation and is referenced directly or indirectly in its own initializer. |
| 354:3  | TS7023 | `'handler'` implicitly has return type `any` because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions. |
| 360:11 | TS7022 | `'request'` implicitly has type `any` because it does not have a type annotation and is referenced directly or indirectly in its own initializer. |
| 443:11 | TS7022 | `'purchaseResult'` implicitly has type `any` because it does not have a type annotation and is referenced directly or indirectly in its own initializer. |

### `convex/phoneProvisioning/mutations.ts`

| Location | Error | Message |
|---|---|---|
| 79:53  | TS2345 | Argument of type `GenericMutationCtx<...>` is not assignable to parameter of type `{ db: { query: (table: string) => any; }; }`. |
| 433:53 | TS2345 | Argument of type `GenericMutationCtx<...>` is not assignable to parameter of type `{ db: { query: (table: string) => any; }; }`. |

### `convex/phoneProvisioning/scheduledFunctions.ts` — ✅ FIXED (no longer quarantined)

The 6 errors formerly listed here (`processQuarantineExpirations` / `runHealthChecks`
TS7022/TS7023 and their derived `expiredNumbers` / `assignedNumbers` locals) were
resolved by adding explicit `Promise<...>` return-type annotations to both handlers.
This broke the circular inference and allowed `npx convex codegen` to re-emit both
functions in `internal.phoneProvisioning.scheduledFunctions`, which in turn resolved
the downstream `convex/crons.ts` TS2339 errors for `processQuarantineExpirations`
and `runHealthChecks`. Runtime behavior of the scheduled functions was unchanged.

## Errors fixed in Phase 0 (for the record)

The following pre-existing errors were **fixed** (not quarantined). All were the
implicit-`any` and structural categories named in Requirement 1.1.

- **Implicit `any` parameters (TS7006)** — typed the offending callback
  parameters with the correct `Doc<...>` / domain types:
  - `src/app/client/api/v1/(internal-use)/check-blocked/route.ts` (signal)
  - `src/app/client/api/v1/messaging/order-confirmation/route.ts` (item, index)
  - `src/app/client/api/v1/messaging/status-update/route.ts` (item, index)
  - `src/app/client/api/v1/partner/businesses/route.ts` (b, i)
  - `src/app/client/api/v1/partner/webhooks/route.ts` (sub)
  - `src/components/dashboard/FraudReviewDashboard.tsx` (item ×4, s)
  - `src/components/dashboard/KpiDashboard.tsx` (s ×4, a, b — resolved by typing `snapshots`)
  - `src/components/dashboard/PromptManagement.tsx` (prompt ×2, p ×2)
  - `src/components/dashboard/TeamInvitations.tsx` (inv)
  - `src/components/dashboard/UpsellAnalytics.tsx` (item)
  - `src/contexts/CallsContext.tsx` (call)
  - `src/contexts/OrdersContext.tsx` (order ×6)
  - `src/hooks/useRestaurantStorage.ts` (item)
  - `src/lib/logistics/webhook-dispatch.ts` (s)
- **Billing fields (TS2339)**
  - `src/components/dashboard/BillingDashboard.tsx` — added `cancelAtPeriodEnd?: boolean` to the `Subscription` type in `src/lib/billing/types.ts` (the field is set by the `setCancelAtPeriodEnd` mutation).
  - `src/components/dashboard/BillingReminderBanner.tsx` — corrected `plan?.pricing?.monthly` to `plan?.priceMonthly` (the `SubscriptionPlan` type uses `priceMonthly`).
- **Structural (TS2322)**
  - `src/lib/payment/PaystackProvider.ts` — narrowed `secretKey`/`publicKey` with a direct guard so the verified value is `string`.
  - `src/components/dashboard/UpsellAnalytics.tsx` — cast the `unknown` trigger `stats` to the `TriggerBreakdownCard` prop shape.
