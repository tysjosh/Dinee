/**
 * Property-Based Test — Shipment Status Transitions (Property 3)
 *
 * **Validates: Requirements 19.1, 19.2, 19.3, 19.5**
 *
 * Property 3: Status transitions enforce state machine invariants
 * - For all (current, next) pairs NOT in VALID_TRANSITIONS: validateTransition returns false
 * - Terminal states (delivered, cancelled) have no outgoing transitions
 * - failed→created is the only path back to created (re-attempt)
 *
 * These tests exercise the exported status-machine module since the Convex
 * mutation (updateShipmentStatus) inlines the same logic and cannot be
 * called directly from vitest.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  type DeliveryStatus,
  VALID_TRANSITIONS,
  validateTransition,
} from "../../src/lib/logistics/status-machine";

const ALL_STATUSES: DeliveryStatus[] = [
  "created",
  "assigned",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
];

const TERMINAL_STATES: DeliveryStatus[] = ["delivered", "cancelled"];

const statusArb = fc.constantFrom(...ALL_STATUSES);

describe("Shipment Status Transitions — Property 3", () => {
  /**
   * **Validates: Requirements 19.1, 19.2**
   *
   * For all (current, next) pairs NOT in VALID_TRANSITIONS,
   * validateTransition must return false (the mutation would reject).
   */
  it("rejects all invalid (current, next) pairs", () => {
    fc.assert(
      fc.property(statusArb, statusArb, (current, next) => {
        const isValid = VALID_TRANSITIONS[current].includes(next);
        if (!isValid) {
          expect(validateTransition(current, next)).toBe(false);
        }
      }),
      { numRuns: 300 }
    );
  });

  /**
   * **Validates: Requirements 19.3**
   *
   * Terminal states (delivered, cancelled) accept no further transitions.
   * For every possible next status, validateTransition returns false.
   */
  it("terminal states (delivered, cancelled) have no outgoing transitions", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TERMINAL_STATES),
        statusArb,
        (terminal, next) => {
          expect(validateTransition(terminal, next)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 19.5**
   *
   * failed→created is the only transition that targets "created".
   * No other status can transition to "created".
   */
  it("failed→created is the only path back to created", () => {
    fc.assert(
      fc.property(statusArb, (current) => {
        if (current === "failed") {
          expect(validateTransition(current, "created")).toBe(true);
        } else {
          expect(validateTransition(current, "created")).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 19.1, 19.5**
   *
   * Simulates the re-attempt scenario: a shipment in "failed" state
   * transitions to "created", which conceptually clears assignedRiderId.
   * The status machine allows this transition, and the mutation (tested
   * here via the pure function) confirms the path is valid while no
   * other non-failed status can reach "created".
   */
  it("failed→created re-attempt clears the path (assignedRiderId conceptually reset)", () => {
    // Verify the transition is valid
    expect(validateTransition("failed", "created")).toBe(true);

    // Verify no other status can go back to "created"
    const nonFailedStatuses = ALL_STATUSES.filter((s) => s !== "failed");
    for (const status of nonFailedStatuses) {
      expect(validateTransition(status, "created")).toBe(false);
    }

    // Verify that after failed→created, the shipment can resume the
    // normal lifecycle (created→assigned or created→cancelled)
    expect(validateTransition("created", "assigned")).toBe(true);
    expect(validateTransition("created", "cancelled")).toBe(true);
  });
});
