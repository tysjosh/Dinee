/**
 * Feature: dinee-campus (Task 2.1)
 *
 * Client-side re-export of the pure `campusCopy` corpus. The student-facing
 * Next.js surface (`CampusLanding`, `OnboardingWizard`, `CreationWizard`, ...)
 * imports its strings from here so the copy has a single source of truth shared
 * with the Convex layer, while keeping client imports inside the `@/` alias
 * space.
 *
 * The underlying module (`convex/campus/logic/copy.ts`) is pure and runtime-free,
 * so it is safe to include in the client bundle.
 */

export * from "../../../convex/campus/logic/copy";
export { campusCopy as default } from "../../../convex/campus/logic/copy";
