/**
 * PII masking utilities for logistics public-facing responses and logs.
 * Requirements: 26.1, 26.2, 26.3, 26.5
 */

export interface Address {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  lat?: number;
  lng?: number;
}

export interface MaskedAddress {
  city: string;
  state: string;
}

/**
 * Masks a phone number, showing only the last 4 digits.
 * If the phone has fewer than 4 characters, returns all asterisks.
 * Example: "08012345678" → "****5678"
 */
export function maskPhone(phone: string): string {
  if (phone.length < 4) {
    return "*".repeat(phone.length);
  }
  return "****" + phone.slice(-4);
}

/**
 * Masks an address, returning only city and state.
 * Strips name, phone, street address, and coordinates.
 */
export function maskAddress(addr: Address): MaskedAddress {
  return {
    city: addr.city,
    state: addr.state,
  };
}
