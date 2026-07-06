/**
 * Region / country configuration — the single source of truth for making the
 * platform multi-region (Nigeria + United States).
 *
 * Everything that used to be hardcoded to Nigeria (currency, ₦ formatting,
 * phone dial code, states list, payment providers, telecom routing region,
 * default language) is now derived from a tenant's `country`. Existing tenants
 * default to Nigeria (`DEFAULT_COUNTRY`) so behavior is unchanged unless a
 * tenant is explicitly created as US.
 */

export type CountryCode = "NG" | "US";
export type CurrencyCode = "NGN" | "USD";

/** Backward-compatible default so existing (Nigeria) tenants are unaffected. */
export const DEFAULT_COUNTRY: CountryCode = "NG";

export interface CountryConfig {
  code: CountryCode;
  name: string;
  currency: CurrencyCode;
  currencySymbol: string;
  /** Intl locale used for number/currency formatting. */
  locale: string;
  /** E.164 dial code, e.g. "+234" / "+1". */
  dialCode: string;
  /** Default agent language for the country. */
  defaultLanguage: string;
  /**
   * Payment providers offered to tenants in this country, in priority order.
   * The first is the default at checkout.
   */
  paymentProviders: string[];
  /** Phone-provisioning region key (see convex REGION_PROVIDER_ROUTING). */
  telecomRegion: string;
  /** ISO country code for telecom provisioning (Twilio/Termii/AT). */
  telecomCountryCode: string;
}

export const COUNTRY_CONFIG: Record<CountryCode, CountryConfig> = {
  NG: {
    code: "NG",
    name: "Nigeria",
    currency: "NGN",
    currencySymbol: "₦",
    locale: "en-NG",
    dialCode: "+234",
    defaultLanguage: "english",
    paymentProviders: ["paystack", "flutterwave", "cod"],
    telecomRegion: "nigeria",
    telecomCountryCode: "NG",
  },
  US: {
    code: "US",
    name: "United States",
    currency: "USD",
    currencySymbol: "$",
    locale: "en-US",
    dialCode: "+1",
    defaultLanguage: "english",
    paymentProviders: ["stripe"],
    telecomRegion: "default",
    telecomCountryCode: "US",
  },
};

export const SUPPORTED_COUNTRIES: CountryCode[] = ["NG", "US"];

/** Resolve a country config, falling back to the default country. */
export function getCountryConfig(country?: string | null): CountryConfig {
  const code = (country ?? "").toUpperCase();
  if (code === "NG" || code === "US") return COUNTRY_CONFIG[code];
  return COUNTRY_CONFIG[DEFAULT_COUNTRY];
}

/** The currency a country bills in. */
export function getCurrencyForCountry(country?: string | null): CurrencyCode {
  return getCountryConfig(country).currency;
}

/** The default payment provider at checkout for a country. */
export function getDefaultPaymentProvider(country?: string | null): string {
  return getCountryConfig(country).paymentProviders[0];
}

/**
 * Format a money amount in the given currency. Whole-number currencies like
 * NGN render without decimals; USD renders with cents.
 */
export function formatMoney(amount: number, currency: CurrencyCode): string {
  const cfg = currency === "USD" ? COUNTRY_CONFIG.US : COUNTRY_CONFIG.NG;
  const fractionDigits = currency === "USD" ? 2 : 0;
  return `${cfg.currencySymbol}${amount.toLocaleString(cfg.locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

/** Convenience: format money for a country using its currency. */
export function formatMoneyForCountry(
  amount: number,
  country?: string | null
): string {
  return formatMoney(amount, getCurrencyForCountry(country));
}
