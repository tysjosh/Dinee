/**
 * Feature: dinee-campus (Task 28.2)
 *
 * Client-side re-export of the pure Template_Library core. The student-facing
 * Next.js surface (`OnboardingWizard`, `CreationWizard`, ...) imports the seven
 * Agent_Type templates and the pure `applyTemplate` transform from here, so the
 * template presets have a single source of truth shared with the Convex layer
 * while keeping client imports inside the `@/` alias space.
 *
 * The underlying module (`convex/campus/logic/templates.ts`) is pure and
 * runtime-free, so it is safe to include in the client bundle.
 */

export * from "../../../convex/campus/logic/templates";
