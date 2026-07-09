/**
 * Feature: dinee-campus (Task 28.2)
 *
 * Client-side re-export of the pure Campus field validators. The onboarding /
 * creation surface drives its inline field errors from the exact same
 * validators the Convex Creation_Service enforces, so the client and server
 * agree on what "valid" means with a single source of truth.
 *
 * The underlying module (`convex/campus/logic/validation.ts`) is pure and
 * runtime-free, so it is safe to include in the client bundle.
 */

export * from "../../../convex/campus/logic/validation";
