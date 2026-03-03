/**
 * Property-Based Test — PII Masking Utilities
 *
 * **Validates: Requirements 26.1, 26.2**
 *
 * Property 2: PII masking never leaks sensitive data
 * - For all phone strings of length >= 4: maskPhone output contains only `*` and last 4 digits
 * - For all address objects: maskAddress output contains no street address, building, or apartment fields
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { type Address, maskPhone, maskAddress } from './masking';

const addressArb: fc.Arbitrary<Address> = fc.record({
  name: fc.string({ minLength: 1 }),
  phone: fc.string({ minLength: 1 }),
  address: fc.string({ minLength: 1 }),
  city: fc.string({ minLength: 1 }),
  state: fc.string({ minLength: 1 }),
  lat: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), { nil: undefined }),
  lng: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), { nil: undefined }),
});

describe('PII Masking — Property Tests', () => {
  /**
   * **Validates: Requirements 26.1**
   *
   * For all phone strings of length >= 4: output starts with "****" and
   * ends with the last 4 characters of the input.
   */
  it('maskPhone starts with "****" and ends with last 4 chars for phones >= 4 chars', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 4 }), (phone) => {
        const masked = maskPhone(phone);
        const last4 = phone.slice(-4);
        expect(masked.startsWith('****')).toBe(true);
        expect(masked.endsWith(last4)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 26.1**
   *
   * For all phone strings of length >= 4: output length is exactly 4 (asterisks) + 4 (last digits) = 8.
   */
  it('maskPhone output length is exactly 8 for phones >= 4 chars', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 4 }), (phone) => {
        const masked = maskPhone(phone);
        expect(masked.length).toBe(8);
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 26.1**
   *
   * For all phone strings of length < 4: output is all asterisks of the same length.
   */
  it('maskPhone returns all asterisks for phones < 4 chars', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 3 }), (phone) => {
        const masked = maskPhone(phone);
        expect(masked).toBe('*'.repeat(phone.length));
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 26.2**
   *
   * For all address objects: maskAddress output has only city and state,
   * no name, phone, address, lat, or lng fields.
   */
  it('maskAddress output contains only city and state, no sensitive fields', () => {
    fc.assert(
      fc.property(addressArb, (addr) => {
        const masked = maskAddress(addr);
        const keys = Object.keys(masked);
        expect(keys).toEqual(expect.arrayContaining(['city', 'state']));
        expect(keys).toHaveLength(2);
        expect(masked).not.toHaveProperty('name');
        expect(masked).not.toHaveProperty('phone');
        expect(masked).not.toHaveProperty('address');
        expect(masked).not.toHaveProperty('lat');
        expect(masked).not.toHaveProperty('lng');
      }),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 26.2**
   *
   * For all address objects: maskAddress output city and state match the input.
   */
  it('maskAddress preserves city and state from input', () => {
    fc.assert(
      fc.property(addressArb, (addr) => {
        const masked = maskAddress(addr);
        expect(masked.city).toBe(addr.city);
        expect(masked.state).toBe(addr.state);
      }),
      { numRuns: 200 }
    );
  });
});
