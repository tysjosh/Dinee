import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Custom hook to check if a customer has existing preferences
 * Used to determine if we should prompt for WhatsApp opt-in on first order
 * 
 * Requirement 13.2: WHEN a customer places their first order, 
 * THE System SHALL prompt for WhatsApp opt-in consent
 * 
 * @param phoneNumber - The customer's phone number to check
 * @returns Object containing preference data and loading state
 */
export function useCustomerPreferences(phoneNumber: string | null | undefined) {
  // Skip the query if no valid phone number
  const shouldSkip = !phoneNumber || phoneNumber === "Unknown";
  
  const preferences = useQuery(
    api.customerPreferences.getByPhoneNumber,
    shouldSkip ? "skip" : { phoneNumber }
  );

  return {
    // Preferences data (null if not found, undefined if loading)
    preferences,
    // True if we're still loading
    isLoading: preferences === undefined && !shouldSkip,
    // True if customer has existing preferences (not a first-time customer)
    hasExistingPreferences: preferences !== null && preferences !== undefined,
    // True if this is a first-time customer (no preferences found)
    isFirstTimeCustomer: preferences === null,
    // WhatsApp opt-in status (undefined if no preferences)
    whatsappOptIn: preferences?.whatsappOptIn,
    // SMS opt-in status (undefined if no preferences)
    smsOptIn: preferences?.smsOptIn,
  };
}

/**
 * Type for the return value of useCustomerPreferences
 */
export interface CustomerPreferencesResult {
  preferences: {
    phoneNumber: string;
    whatsappOptIn: boolean;
    smsOptIn: boolean;
    preferredLanguage?: string;
    updatedAt: number;
  } | null | undefined;
  isLoading: boolean;
  hasExistingPreferences: boolean;
  isFirstTimeCustomer: boolean;
  whatsappOptIn: boolean | undefined;
  smsOptIn: boolean | undefined;
}
