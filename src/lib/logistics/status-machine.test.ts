/**
 * Property-Based Test — Status Transition Validator
 *
 * **Validates: Requirements 19.1, 19.2, 19.3**
 *
 * Property 1: Status machine completeness and correctness
 * - For all (current, next) pairs: validateTransition returns true iff the pair is in VALID_TRANSITIONS
 * - Terminal states (delivered, cancelled) have no valid outgoing transitions
 * - failed→created is the only re-attempt path
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  type DeliveryStatus,
  VALID_TRANSITIONS,
  validateTransition,
} from './status-machine';

const ALL_STATUSES: DeliveryStatus[] = [
  'created',
  'assigned',
  'picked_up',
  'in_transit',
  'delivered',
  'failed',
  'cancelled',
];

const statusArb = fc.constantFrom(...ALL_STATUSES);

describe('Status Machine — Property Tests', () => {
  /**
   * **Validates: Requirements 19.1, 19.2**
   *
   * For every (current, next) pair drawn from all statuses:
   * validateTransition returns true iff next is in VALID_TRANSITIONS[current].
   */
  it('validateTransition returns true iff the pair is in VALID_TRANSITIONS', () => {
    fc.assert(
      fc.property(statusArb, statusArb, (current, next) => {
        const expected = VALID_TRANSITIONS[current].includes(next);
        const actual = validateTransition(current, next);
        expect(actual).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 19.3**
   *
   * Terminal states (delivered, cancelled) have empty transition arrays —
   * no valid outgoing transitions exist.
   */
  it('terminal states (delivered, cancelled) have no valid outgoing transitions', () => {
    const terminalStates: DeliveryStatus[] = ['delivered', 'cancelled'];

    for (const terminal of terminalStates) {
      expect(VALID_TRANSITIONS[terminal]).toEqual([]);

      // Verify against every possible next status
      for (const next of ALL_STATUSES) {
        expect(validateTransition(terminal, next)).toBe(false);
      }
    }
  });

  /**
   * **Validates: Requirements 19.1, 19.3**
   *
   * failed→created is the only re-attempt path. No other transition
   * targets "created" as a destination.
   */
  it('failed→created is the only re-attempt path', () => {
    for (const current of ALL_STATUSES) {
      if (current === 'failed') {
        expect(validateTransition(current, 'created')).toBe(true);
      } else {
        expect(validateTransition(current, 'created')).toBe(false);
      }
    }
  });

  /**
   * **Validates: Requirements 19.1**
   *
   * VALID_TRANSITIONS covers every DeliveryStatus as a key —
   * no status is missing from the map.
   */
  it('VALID_TRANSITIONS covers all delivery statuses', () => {
    for (const status of ALL_STATUSES) {
      expect(VALID_TRANSITIONS).toHaveProperty(status);
      expect(Array.isArray(VALID_TRANSITIONS[status])).toBe(true);
    }
  });
});
