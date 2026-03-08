# Implementation Plan: Convex Auth Integration

## Overview

Replace the localStorage-based identity system with real authentication powered by `@convex-dev/auth`. Implementation proceeds in layers: schema/validator fixes → auth backend setup → auth pages → session-based tenant resolution → onboarding integration → team invitations → admin panel → sign-out. Each layer builds on the previous, with checkpoints to validate before moving forward.

## Tasks

- [x] 1. Fix user validators and add new schema tables
  - [x] 1.1 Align `convex/users.ts` validators with `convex/schema.ts`
    - Add `v.literal("business_owner")` to `userRoleValidator`
    - Add `v.literal("business")` to `tenantTypeValidator`
    - Update `UserRole` and `TenantType` type definitions to include the new values
    - Ensure `createUser` and `updateUser` mutations accept the full set
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.2 Write property test for validator alignment
    - **Property 1: User mutation validators accept all schema-defined roles and tenant types**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x] 1.3 Add `invitations` and `passwordResetTokens` tables to `convex/schema.ts`
    - Add `invitations` table with fields: `email`, `role`, `tenantId`, `invitedBy`, `inviteToken`, `status`, `createdAt`, `expiresAt`, `acceptedAt` (optional)
    - Add indexes: `by_invite_token`, `by_email`, `by_tenant_id`, `by_status`
    - Add `passwordResetTokens` table with fields: `email`, `tokenHash`, `expiresAt`, `used`, `createdAt`
    - Add indexes: `by_token_hash`, `by_email`, `by_expires_at`
    - _Requirements: 5.2, 9.1_

- [x] 2. Install and configure `@convex-dev/auth`
  - [x] 2.1 Install `@convex-dev/auth` and create auth configuration files
    - Run `npm install @convex-dev/auth`
    - Create `convex/auth.ts` with Email/Password provider configuration, exporting `auth`, `signIn`, `signOut`, `store` helpers
    - Create `convex/auth.config.ts` with provider configuration (password hashing, session expiry, `CONVEX_AUTH_SECRET` requirement)
    - Add `CONVEX_AUTH_SECRET` and `CONVEX_AUTH_PRIVATE_KEY` to `.env.example`
    - _Requirements: 1.1, 1.5, 1.6_

  - [x] 2.2 Wrap `ConvexProvider` with `ConvexAuthProvider` in `src/components/providers/ConvexClientProvider.tsx`
    - Import `ConvexAuthProvider` from `@convex-dev/auth/react`
    - Wrap existing `ConvexProvider` children with `ConvexAuthProvider`
    - _Requirements: 1.3_

  - [x] 2.3 Create `src/hooks/useCurrentUser.ts` hook
    - Use `useConvexAuth()` for `isLoading` and `isAuthenticated` state
    - Query the `users` table using the session identity email to return the full `Doc<"users">` record
    - Return `{ user, isLoading, isAuthenticated }` interface
    - _Requirements: 1.4_

- [x] 3. Checkpoint — Verify auth backend
  - Ensure Convex schema deploys without errors, `@convex-dev/auth` initializes, and `useCurrentUser` hook compiles. Ask the user if questions arise.

- [x] 4. Create auth pages (signup, login, forgot-password, reset-password)
  - [x] 4.1 Create sign-up page at `src/app/client/signup/page.tsx`
    - Render form with email, password, confirm password fields using `card`, `input`, `btn` design system utilities
    - Enforce minimum 8-character password with inline validation error
    - On submit: call Convex Auth `signUp`, then `createUser` mutation with `role: "restaurant_owner"`, `tenantType: "restaurant"`, `tenantId: ""`
    - Handle duplicate email error with inline message: "An account with this email already exists"
    - On success: auto-sign-in and redirect to `/client/onboarding`
    - Accept `?invite={token}` query param — if present, look up invitation and use its `role` and `tenantId` instead of defaults
    - Include link to login page
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 9.5, 9.6_

  - [x] 4.2 Write property tests for sign-up flow
    - **Property 2: Sign-up creates user with correct defaults**
    - **Property 3: Duplicate email rejection**
    - **Property 4: Password length validation**
    - **Property 5: Successful sign-up produces an authenticated session**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5**

  - [x] 4.3 Create login page at `src/app/client/login/page.tsx`
    - Render form with email, password fields using design system utilities
    - On valid credentials: create session, call `updateLastLogin`, redirect to `/client/dashboard`
    - If user has empty `tenantId`: redirect to `/client/onboarding` instead
    - On invalid credentials: display generic error "Invalid email or password" (no field-specific hint)
    - Include links to sign-up page and forgot-password page
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.4 Write property tests for login flow
    - **Property 6: Login with valid credentials creates a session**
    - **Property 7: Invalid credentials produce a generic error**
    - **Validates: Requirements 4.2, 4.3**

  - [x] 4.5 Create forgot-password page at `src/app/client/forgot-password/page.tsx` and `convex/passwordResetTokens.ts`
    - Render email input form at `/client/forgot-password`
    - Create `convex/passwordResetTokens.ts` with mutations: `createResetToken` (generates hashed token, stores with 1-hour expiry), `validateAndUseToken` (checks hash, expiry, used flag)
    - On submit: generate reset token, store in `passwordResetTokens` table, send reset link email
    - _Requirements: 5.1, 5.2, 5.6_

  - [x] 4.6 Create reset-password page at `src/app/client/reset-password/page.tsx`
    - Render new password form, read reset token from query params
    - On submit: validate token via `validateAndUseToken`, update user's `passwordHash`, redirect to login
    - Handle expired/invalid token with error message and resend option
    - _Requirements: 5.3, 5.4, 5.5_

  - [x] 4.7 Write property tests for password reset flow
    - **Property 8: Password reset round trip**
    - **Property 9: Reset token expiry**
    - **Validates: Requirements 5.2, 5.4, 5.6**

- [x] 5. Checkpoint — Verify auth pages
  - Ensure all four auth pages render correctly, sign-up creates users, login creates sessions, and password reset flow works end-to-end. Ask the user if questions arise.

- [x] 6. Implement session-based tenant resolution and route protection
  - [x] 6.1 Create `src/components/auth/AuthGuard.tsx`
    - Use `useCurrentUser()` to check auth state
    - Loading → show spinner; Unauthenticated → redirect to `/client/login`; Authenticated with empty `tenantId` → redirect to `/client/onboarding`; Authenticated with `tenantId` → render children
    - _Requirements: 8.1, 8.2, 8.5_

  - [x] 6.2 Write property tests for route protection
    - **Property 13: Route protection by authentication state**
    - **Property 14: Incomplete onboarding redirect**
    - **Validates: Requirements 7.2, 8.1, 8.2, 8.3**

  - [x] 6.3 Modify `src/contexts/AppProvider.tsx` to use session-based tenant resolution
    - Replace `useRestaurantStorage()` call with `useCurrentUser()` hook
    - Derive `initialRestaurantId`, `initialPlatformId`, `initialBranchId`, `initialRole` from the authenticated user's `tenantType`, `tenantId`, and `role`
    - Remove `restaurantId` read from `useRestaurantStorage()` as primary identity source
    - Keep `useRestaurantStorage` hook functional for backward compatibility
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 6.4 Write property tests for tenant resolution
    - **Property 10: Session-based tenant resolution**
    - **Property 11: Role-based tenant filtering**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [x] 6.5 Wire `AuthGuard` into `src/app/client/layout.tsx` for protected routes
    - Wrap protected route children with `AuthGuard`
    - Ensure public routes (`/client/login`, `/client/signup`, `/client/forgot-password`, `/client/reset-password`) are NOT wrapped
    - Remove the existing localStorage-based redirect logic in `src/app/client/dashboard/page.tsx`
    - _Requirements: 8.1, 8.3, 8.5_

- [x] 7. Checkpoint — Verify tenant resolution and route protection
  - Ensure authenticated users see correct tenant-scoped data, unauthenticated users are redirected to login, and users without tenantId are redirected to onboarding. Ask the user if questions arise.

- [x] 8. Integrate onboarding flow with auth and plan selection
  - [x] 8.1 Modify `src/app/client/onboarding/page.tsx` to require auth and link user to restaurant
    - Require authenticated session (page is behind `AuthGuard`)
    - After `createRestaurantWithBranches()`, call `updateUser()` to set `tenantId` on the user record
    - Remove localStorage write as primary identity mechanism
    - Update `TenantContext` with new restaurant scope without page reload
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 8.2 Write property test for onboarding-user link
    - **Property 12: Onboarding links user to restaurant**
    - **Validates: Requirements 7.1**

  - [x] 8.3 Create `src/components/onboarding/PlanPicker.tsx` and add plan-selection step
    - Display three plans from `SUBSCRIPTION_PLANS` in `src/lib/billing/SubscriptionService.ts` using card layout
    - Show plan name, monthly price in Naira (via `formatNairaPrice()`), feature limits
    - Add "Recommended" badge on Growth plan
    - Add monthly/yearly billing toggle with yearly savings display
    - Add "Skip" option defaulting to Starter with 14-day trial
    - Insert `plan-selection` step after `module-activation` in the onboarding step flow
    - On plan selection: create subscription record via `createSubscription()` in `convex/subscriptions.ts` with `status: "trialing"` and 14-day trial
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 8.4 Write property tests for plan picker and subscription creation
    - **Property 18: Plan display completeness and pricing correctness**
    - **Property 19: Subscription creation during onboarding**
    - **Validates: Requirements 10.2, 10.3, 10.4**

- [x] 9. Checkpoint — Verify onboarding integration
  - Ensure sign-up → onboarding → plan selection → restaurant creation → dashboard flow works end-to-end. Ask the user if questions arise.

- [x] 10. Implement team invitation system
  - [x] 10.1 Create `convex/invitations.ts` with CRUD mutations and queries
    - `createInvitation`: accepts email, role, tenantId, invitedBy; generates unique `inviteToken`; sets `status: "pending"`, `expiresAt` to 7 days; enforces that caller has `restaurant_owner` role
    - `getInvitationByToken`: looks up by `inviteToken`, checks expiry and status
    - `acceptInvitation`: marks invitation as `accepted`, sets `acceptedAt`
    - `revokeInvitation`: sets status to `revoked`
    - `getInvitationsByTenant`: lists all invitations for a tenant
    - `resendInvitation`: resets `expiresAt` to 7 days from now for pending invitations
    - _Requirements: 9.1, 9.3, 9.7, 9.8_

  - [x] 10.2 Create `src/components/dashboard/TeamInvitations.tsx`
    - "Invite Team Member" form with email input and role dropdown (`branch_manager`, `supervisor`)
    - List of pending/accepted/expired invitations with status badges
    - Resend and revoke actions for pending invitations
    - Only visible to users with `restaurant_owner` role (check via `useTenant().actions.hasPermission`)
    - Wire into Settings tab of `DashboardLayout` (modify `src/components/dashboard/SettingsSection.tsx`)
    - _Requirements: 9.2, 9.4_

  - [x] 10.3 Write property tests for invitation system
    - **Property 15: Invitation creation by authorized owner**
    - **Property 16: Invitation sign-up assigns correct role and tenant**
    - **Property 17: Invitation token expiry**
    - **Validates: Requirements 9.3, 9.5, 9.7, 9.8**

- [x] 11. Implement platform admin panel
  - [x] 11.1 Create `src/app/client/dashboard/admin/page.tsx`
    - Restrict access to `platform_admin` role; redirect non-admins to `/client/dashboard`
    - Restaurant list table: name, restaurantId, createdAt, subscription status
    - User list table using `getAllUsers()` query: email, role, tenantType, tenantId, lastLoginAt
    - Role change dropdown per user (calls `updateUser` mutation)
    - User deactivation toggle
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 11.2 Write property tests for admin panel
    - **Property 20: Admin panel access restriction**
    - **Property 21: Admin panel data completeness**
    - **Property 22: Admin role change and deactivation**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6**

- [x] 12. Implement sign-out and verify partner API independence
  - [x] 12.1 Add sign-out button to `src/components/dashboard/DashboardLayout.tsx`
    - Add sign-out button in the header navigation area
    - On click: call `useAuthActions().signOut()`, reset `TenantContext` to initial state, clear `restaurantId` from localStorage
    - Redirect to `/client/login` after sign-out
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 12.2 Write property test for sign-out cleanup
    - **Property 24: Sign-out cleanup**
    - **Validates: Requirements 8.4, 13.2, 13.3, 13.4**

  - [x] 12.3 Write property test for partner API independence
    - **Property 23: Partner API independence from Convex Auth**
    - Verify that API key auth in `src/lib/partner-api/middleware.ts` works without any Convex Auth session
    - **Validates: Requirements 12.2, 12.3**

- [x] 13. Final checkpoint — Full integration verification
  - Ensure all tests pass. Verify: sign-up → onboarding → dashboard, login → dashboard, invitation → sign-up with token, admin panel access, sign-out cleanup, and partner API independence. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` (v4.5.3) and `vitest` (v3.2.4), both already in devDependencies
- Partner API auth (`src/lib/partner-api/middleware.ts`, `src/lib/partner-api/auth.ts`) is explicitly untouched
- The `useRestaurantStorage` hook is kept functional for backward compatibility during migration
- Tailwind CSS v4 with CSS-first configuration — auth pages use existing `card`, `input`, `btn` utilities from `globals.css`
