# Requirements Document

## Introduction

This feature replaces the current localStorage-based identity system with real authentication powered by `@convex-dev/auth`. Today, the entire tenant identity chain works as follows: `src/hooks/useRestaurantStorage.ts` stores a `restaurantId` string in localStorage under the key `"restaurantId"`, `src/contexts/AppProvider.tsx` reads it via `useRestaurantStorage()` and passes it to `TenantProvider` as `initialRestaurantId`, and `src/contexts/TenantContext.tsx` uses that value to scope all data queries — with the user role hardcoded to `'supervisor'` since no user record is ever resolved. No `@convex-dev/auth` package is installed, no `convex/auth.ts` or `convex/auth.config.ts` files exist, no login/signup pages exist, and the only "route protection" is a localStorage check in `src/app/client/dashboard/page.tsx` that redirects to onboarding if `restaurantId` is null.

This integration adds Email/Password sign-up and login, session management, password reset, team invitations with role assignment, subscription plan selection during onboarding, and a platform admin panel — all wired into the existing multi-tenant RBAC system in `TenantContext`. It also fixes a validator mismatch between `convex/schema.ts` and `convex/users.ts`. Partner API authentication (API keys via `src/lib/partner-api/middleware.ts` and OAuth via `src/lib/partner-api/auth.ts`) remains unchanged.

## Glossary

- **Auth_System**: The `@convex-dev/auth` library configured with Convex, providing session management, token storage, and authentication provider orchestration. Currently not installed — must be added to `package.json` along with `convex/auth.ts` and `convex/auth.config.ts`.
- **Session**: A server-side Convex Auth session that ties a browser client to an authenticated user record, replacing the current `localStorage` `restaurantId` approach used in `src/hooks/useRestaurantStorage.ts`.
- **User_Record**: A row in the `users` table defined in `convex/schema.ts` containing `userId`, `email`, `passwordHash`, `role`, `tenantType`, and `tenantId`. CRUD operations exist in `convex/users.ts` but are never called from any UI or API route today.
- **Tenant_Context**: The existing `TenantContext` at `src/contexts/TenantContext.tsx` that resolves platform/restaurant/branch scope and RBAC permissions. Currently accepts `initialPlatformId`, `initialRestaurantId`, `initialBranchId`, `initialRole` as props, with role defaulting to `'supervisor'`.
- **Onboarding_Flow**: The multi-step wizard at `src/app/client/onboarding/page.tsx` with steps: business-type → business-setup → module-activation → integration-setup → restaurant-id → complete. Uses `useBusinessStorage().saveBusinessData()` which calls `createRestaurantWithBranches()` in `convex/restaurants.ts`.
- **Dashboard**: The protected area at `src/app/client/dashboard/page.tsx` showing calls, orders, and analytics. Currently checks `restaurantId` from `useRestaurantStorage()` and redirects to onboarding if null.
- **Invitation**: A record representing a team member invite. No `invitations` table currently exists in `convex/schema.ts` — one must be created.
- **Plan_Picker**: A UI component displaying the three subscription plans defined in `src/lib/billing/SubscriptionService.ts` as `SUBSCRIPTION_PLANS`: Starter (₦15,000/month), Growth (₦35,000/month), Enterprise (₦75,000/month).
- **Admin_Panel**: A restricted area accessible only to `platform_admin` users for viewing tenants and managing users across the platform.
- **Partner_API_Auth**: The existing API key-based authentication in `src/lib/partner-api/middleware.ts` with OAuth 2.0 client credentials in `src/lib/partner-api/auth.ts`, which remains unchanged by this feature.
- **ConvexClientProvider**: The existing provider at `src/components/providers/ConvexClientProvider.tsx` that creates a `ConvexReactClient` with `NEXT_PUBLIC_CONVEX_URL` and wraps children with `ConvexProvider` — currently has NO auth provider.
- **AppProvider**: The existing provider at `src/contexts/AppProvider.tsx` that composes `TenantProvider` → `RestaurantProvider` → `CallsProvider` → `OrdersProvider`. Currently reads `restaurantId` from `useRestaurantStorage()` and passes it to `TenantProvider` as `initialRestaurantId`.

## Requirements

### Requirement 1: Convex Auth Installation and Configuration

**User Story:** As a developer, I want `@convex-dev/auth` installed and configured with an Email/Password provider, so that the application has a real authentication backend.

#### Acceptance Criteria

1. THE Auth_System SHALL install `@convex-dev/auth` as a dependency in `package.json` and create `convex/auth.ts` and `convex/auth.config.ts` configuration files with the Email/Password provider.
2. THE Auth_System SHALL store authentication state in Convex server-side sessions rather than in localStorage via `useRestaurantStorage.ts`.
3. THE Auth_System SHALL modify `src/components/providers/ConvexClientProvider.tsx` to wrap the existing `ConvexProvider` with a `ConvexAuthProvider` that provides session state to all child components.
4. THE Auth_System SHALL provide `useCurrentUser` and `useAuthActions` hooks for components to access the authenticated User_Record and perform sign-in/sign-out operations.
5. IF the `CONVEX_AUTH_SECRET` environment variable is missing, THEN THE Auth_System SHALL fail startup with a descriptive error message.
6. THE Auth_System SHALL add `CONVEX_AUTH_SECRET` and `CONVEX_AUTH_PRIVATE_KEY` to the required environment variables alongside the existing `NEXT_PUBLIC_CONVEX_URL`.

### Requirement 2: User Schema and Validator Alignment

**User Story:** As a developer, I want the `convex/users.ts` validators to match the `convex/schema.ts` definitions, so that all defined roles and tenant types can be used without runtime errors.

#### Acceptance Criteria

1. THE Auth_System SHALL add `business_owner` to the role validators in `convex/users.ts` to match the `convex/schema.ts` users table which defines roles: `platform_admin`, `restaurant_owner`, `business_owner`, `branch_manager`, `supervisor`.
2. THE Auth_System SHALL add `business` to the tenantType validators in `convex/users.ts` to match the `convex/schema.ts` users table which defines tenantTypes: `platform`, `restaurant`, `business`, `branch`.
3. THE Auth_System SHALL ensure all mutations in `convex/users.ts` (`createUser`, `updateUser`) accept the full set of roles and tenantTypes defined in the schema.

### Requirement 3: Sign-Up Page

**User Story:** As a new restaurant owner, I want to create an account with my email and password, so that I have a persistent identity in the system.

#### Acceptance Criteria

1. THE Auth_System SHALL render a sign-up page at `/client/signup` using the existing design system utilities (`card`, `input`, `btn`) defined in `src/app/globals.css`.
2. WHEN a user submits valid email and password fields, THE Auth_System SHALL create a User_Record via the `createUser` mutation in `convex/users.ts` with role `restaurant_owner`, tenantType `restaurant`, and an empty tenantId.
3. WHEN a user submits an email that already exists in the users table, THE Auth_System SHALL display an inline error message stating the email is already registered, leveraging the existing email uniqueness check in `convex/users.ts` `createUser`.
4. THE Auth_System SHALL enforce a minimum password length of 8 characters and display a validation error for shorter passwords.
5. WHEN sign-up succeeds, THE Auth_System SHALL automatically sign the user in and redirect to the Onboarding_Flow at `/client/onboarding`.
6. THE Auth_System SHALL include a link to the login page for users who already have an account.

### Requirement 4: Login Page

**User Story:** As a returning user, I want to log in with my email and password, so that I can access my restaurant dashboard.

#### Acceptance Criteria

1. THE Auth_System SHALL render a login page at `/client/login` using the existing design system.
2. WHEN a user submits valid credentials, THE Auth_System SHALL create a Session, call `updateLastLogin` in `convex/users.ts`, and redirect to the Dashboard at `/client/dashboard`.
3. WHEN a user submits invalid credentials, THE Auth_System SHALL display an inline error message without revealing whether the email or password was incorrect.
4. THE Auth_System SHALL include a link to the sign-up page and a link to the password reset page.
5. WHEN a logged-in user who has not completed onboarding (User_Record `tenantId` is empty) navigates to login, THE Auth_System SHALL redirect the user to the Onboarding_Flow instead of the Dashboard.

### Requirement 5: Password Reset Flow

**User Story:** As a user who forgot my password, I want to reset it via email, so that I can regain access to my account.

#### Acceptance Criteria

1. THE Auth_System SHALL render a password reset request page at `/client/forgot-password` with an email input field.
2. WHEN a user submits a valid email address, THE Auth_System SHALL generate a time-limited reset token and send a reset link to the email address.
3. THE Auth_System SHALL render a password reset confirmation page at `/client/reset-password` that accepts the reset token and a new password.
4. WHEN a user submits a valid reset token and new password, THE Auth_System SHALL update the User_Record's passwordHash and redirect to the login page.
5. IF a user submits an expired or invalid reset token, THEN THE Auth_System SHALL display an error message and offer to resend the reset link.
6. THE Auth_System SHALL expire reset tokens after 1 hour.

### Requirement 6: Session-Based Tenant Resolution

**User Story:** As an authenticated user, I want the application to automatically resolve my tenant scope from my session, so that I see only the data I'm authorized to access.

#### Acceptance Criteria

1. WHEN a user is authenticated, THE AppProvider at `src/contexts/AppProvider.tsx` SHALL read the authenticated User_Record's `tenantType` and `tenantId` from the Convex Auth session instead of reading `restaurantId` from `useRestaurantStorage()`, and pass the resolved values to `TenantProvider` as `initialRestaurantId` (or `initialPlatformId`/`initialBranchId` depending on tenantType).
2. THE Tenant_Context SHALL set the `userRole` from the authenticated User_Record's `role` field instead of defaulting to `'supervisor'` as currently hardcoded in `src/contexts/TenantContext.tsx`.
3. WHEN a `restaurant_owner` user is authenticated, THE Tenant_Context SHALL scope all data queries to the user's `tenantId` as the restaurantId, using the existing `getTenantFilter()` method.
4. WHEN a `platform_admin` user is authenticated, THE Tenant_Context SHALL provide access to all restaurants and branches without tenant filtering, consistent with the existing wildcard permission in the RBAC matrix.
5. THE Auth_System SHALL remove the `restaurantId` read from `useRestaurantStorage()` in `src/contexts/AppProvider.tsx` and replace it with the session-derived value.
6. THE Auth_System SHALL maintain backward compatibility by keeping the `useRestaurantStorage` hook at `src/hooks/useRestaurantStorage.ts` functional for any non-auth code paths that still reference it during migration.

### Requirement 7: Onboarding Flow Integration

**User Story:** As a newly signed-up restaurant owner, I want the onboarding flow to create my restaurant and link it to my user account, so that my identity is tied to my business.

#### Acceptance Criteria

1. WHEN a user completes the business setup step in the Onboarding_Flow, THE Auth_System SHALL call `createRestaurantWithBranches()` in `convex/restaurants.ts` (which generates a 5-digit numeric restaurantId and uses `platformId` defaulting to `'default-platform'`), then update the authenticated User_Record's `tenantId` with the newly created restaurantId via the `updateUser` mutation in `convex/users.ts`.
2. THE Onboarding_Flow SHALL require an authenticated Session before allowing access to any onboarding step, replacing the current unauthenticated access at `src/app/client/onboarding/page.tsx`.
3. WHEN onboarding completes, THE Auth_System SHALL update the Tenant_Context with the new restaurant's scope without requiring a page reload, and SHALL NOT write `restaurantId` to localStorage as the primary identity mechanism.
4. THE Onboarding_Flow SHALL replace the current `useBusinessStorage().saveBusinessData()` flow (which writes to localStorage after calling `createRestaurantWithBranches()`) with a flow that persists the restaurant-to-user link in the User_Record's `tenantId` field.

### Requirement 8: Route Protection

**User Story:** As a business owner, I want unauthorized users to be unable to access my dashboard, so that my business data is secure.

#### Acceptance Criteria

1. WHEN an unauthenticated user navigates to any `/client/dashboard` route, THE Auth_System SHALL redirect the user to `/client/login`, replacing the current localStorage-based check in `src/app/client/dashboard/page.tsx` that only redirects to onboarding.
2. WHEN an authenticated user without a completed onboarding (User_Record `tenantId` is empty) navigates to `/client/dashboard`, THE Auth_System SHALL redirect the user to `/client/onboarding`.
3. THE Auth_System SHALL allow unauthenticated access to `/client`, `/client/login`, `/client/signup`, `/client/forgot-password`, and `/client/reset-password`.
4. WHEN a user signs out, THE Auth_System SHALL clear the Session and redirect to `/client/login`.
5. THE Auth_System SHALL implement route protection using a client-side auth guard component that wraps protected routes, since the current `src/middleware.ts` only handles `/client` prefix redirects and has no auth checks.

### Requirement 9: Team Invitation System

**User Story:** As a restaurant owner, I want to invite team members by email and assign them roles, so that my staff can access the system with appropriate permissions.

#### Acceptance Criteria

1. THE Auth_System SHALL add an `invitations` table to `convex/schema.ts` with fields for email, role, tenantId, inviteToken, status, and expiresAt, since no invitations table currently exists.
2. THE Auth_System SHALL provide an "Invite Team Member" form in the Dashboard settings that accepts an email address and a role selection (`branch_manager` or `supervisor`).
3. WHEN a restaurant owner submits an invitation, THE Auth_System SHALL create an Invitation record with the invitee's email, assigned role, the owner's restaurantId as tenantId, and a unique invite token.
4. THE Auth_System SHALL send an invitation email containing a link to `/client/signup?invite={token}`.
5. WHEN an invited user signs up via the invitation link, THE Auth_System SHALL create the User_Record with the role and tenantId specified in the Invitation, bypassing the normal `restaurant_owner` default.
6. IF an invitation token is expired or already used, THEN THE Auth_System SHALL display an error message on the sign-up page.
7. THE Auth_System SHALL enforce that only users with `restaurant_owner` role can create invitations for their own tenant, consistent with the `manage:restaurant` permission in the Tenant_Context RBAC matrix.
8. THE Auth_System SHALL expire invitation tokens after 7 days.

### Requirement 10: Subscription Plan Selection During Onboarding

**User Story:** As a new restaurant owner, I want to choose a subscription plan during onboarding, so that my account is set up with the right feature tier from the start.

#### Acceptance Criteria

1. THE Onboarding_Flow SHALL include a plan selection step after the business setup step, displaying the three plans from `SUBSCRIPTION_PLANS` in `src/lib/billing/SubscriptionService.ts`: Starter (₦15,000/month, 1 branch, 500 calls, 300 orders, 50 menu items, 3 team members), Growth (₦35,000/month, 3 branches, 2000 calls, 1500 orders, 150 menu items, 10 team members), Enterprise (₦75,000/month, unlimited everything).
2. THE Plan_Picker SHALL display each plan's name, monthly price in Naira, feature limits, and a "Recommended" badge on the Growth plan.
3. THE Plan_Picker SHALL allow toggling between monthly and yearly billing cycles and display the yearly savings.
4. WHEN a user selects a plan, THE Onboarding_Flow SHALL create a subscription record via the existing subscription CRUD in `convex/subscriptions.ts` with status `trialing` and a 14-day trial period, since no subscription is currently created during onboarding despite the mutations being available.
5. THE Plan_Picker SHALL allow the user to proceed without selecting a plan, defaulting to the Starter plan with a trial.

### Requirement 11: Platform Admin Panel

**User Story:** As a platform administrator, I want a dedicated admin panel to view all tenants and manage users, so that I can oversee the entire platform.

#### Acceptance Criteria

1. THE Admin_Panel SHALL be accessible at `/client/dashboard/admin` only to users with the `platform_admin` role.
2. WHEN a non-admin user navigates to `/client/dashboard/admin`, THE Auth_System SHALL redirect the user to the Dashboard.
3. THE Admin_Panel SHALL display a list of all restaurants with their name, restaurantId, creation date, and subscription status.
4. THE Admin_Panel SHALL display a list of all users using the existing `getAllUsers()` query in `convex/users.ts`, showing email, role, tenantType, tenantId, and last login date.
5. THE Admin_Panel SHALL allow a platform_admin to change a user's role via the existing `updateUser` mutation in `convex/users.ts`.
6. THE Admin_Panel SHALL allow a platform_admin to deactivate a user account.

### Requirement 12: Partner API Auth Backward Compatibility

**User Story:** As a partner integrator, I want my existing API key authentication to continue working unchanged, so that my integration is not disrupted.

#### Acceptance Criteria

1. THE Auth_System SHALL leave all Partner_API_Auth mechanisms in `src/lib/partner-api/middleware.ts` (API key validation) and `src/lib/partner-api/auth.ts` (OAuth 2.0 client credentials, webhook signatures) unchanged.
2. THE Auth_System SHALL not require Convex Auth sessions for any partner API routes.
3. WHEN a partner API request includes a valid API key, THE Auth_System SHALL authenticate the request using the existing `apiKeys` table validation without involving Convex Auth.

### Requirement 13: Sign-Out

**User Story:** As an authenticated user, I want to sign out of the application, so that my session is terminated and my account is secure.

#### Acceptance Criteria

1. THE Dashboard SHALL display a sign-out button in the navigation area.
2. WHEN a user clicks the sign-out button, THE Auth_System SHALL invalidate the server-side Session.
3. WHEN sign-out completes, THE Auth_System SHALL redirect the user to `/client/login`.
4. WHEN sign-out completes, THE Tenant_Context SHALL reset to its initial state with no tenant scope, and the `useRestaurantStorage` localStorage value SHALL be cleared for consistency.
