/**
 * KPI computation functions for the AI Reception OS platform.
 *
 * Computes metrics segmented by vertical with correct attribution windows:
 * - Restaurant: 30min call-to-outcome window
 * - Logistics: 60min call-to-outcome window
 * - General Services: 24hr call-to-outcome window
 *
 * All period boundaries use UTC timezone (Req 15.9).
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.8, 15.9
 */

import type { Vertical } from "@/lib/modules/types";

export type PeriodType = "day" | "week" | "month";

export interface PeriodBounds {
  periodStart: number;
  periodEnd: number;
}

/** Attribution windows per vertical in milliseconds (Req 15.4) */
export const ATTRIBUTION_WINDOWS: Record<string, number> = {
  restaurant: 30 * 60 * 1000,         // 30 minutes
  logistics: 60 * 60 * 1000,          // 60 minutes
  general_services: 24 * 60 * 60 * 1000, // 24 hours
  healthcare: 24 * 60 * 60 * 1000,
  legal: 24 * 60 * 60 * 1000,
  hospitality: 24 * 60 * 60 * 1000,
};

/**
 * Returns the daily period bounds (UTC) for a given timestamp.
 * A call is attributed to the period in which it ended (Req 15.8).
 */
export function getDailyPeriod(timestampMs: number): PeriodBounds {
  const date = new Date(timestampMs);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const end = start + 24 * 60 * 60 * 1000;
  return { periodStart: start, periodEnd: end };
}

/**
 * Returns the ISO week period bounds (UTC) for a given timestamp.
 * ISO weeks start on Monday.
 */
export function getWeeklyPeriod(timestampMs: number): PeriodBounds {
  const date = new Date(timestampMs);
  const utcDay = date.getUTCDay();
  // ISO: Monday=1, Sunday=7. JS: Sunday=0, Monday=1...Saturday=6
  const daysSinceMonday = utcDay === 0 ? 6 : utcDay - 1;
  const mondayStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceMonday
  );
  const sundayEnd = mondayStart + 7 * 24 * 60 * 60 * 1000;
  return { periodStart: mondayStart, periodEnd: sundayEnd };
}

/**
 * Returns the monthly period bounds (UTC) for a given timestamp.
 */
export function getMonthlyPeriod(timestampMs: number): PeriodBounds {
  const date = new Date(timestampMs);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return { periodStart: start, periodEnd: end };
}

/**
 * Returns the period bounds for a given timestamp and period type.
 * Each call falls in exactly one period per type (Req 15.8).
 */
export function getPeriodBounds(timestampMs: number, periodType: PeriodType): PeriodBounds {
  switch (periodType) {
    case "day":
      return getDailyPeriod(timestampMs);
    case "week":
      return getWeeklyPeriod(timestampMs);
    case "month":
      return getMonthlyPeriod(timestampMs);
  }
}

/**
 * Determines if a call resulted in a successful outcome within the attribution window.
 *
 * @param callEndedAt - When the call ended (ms since epoch)
 * @param outcomeCreatedAt - When the outcome (order/shipment/appointment) was created
 * @param vertical - The business vertical
 * @returns true if the outcome falls within the attribution window
 */
export function isWithinAttributionWindow(
  callEndedAt: number,
  outcomeCreatedAt: number,
  vertical: string
): boolean {
  const window = ATTRIBUTION_WINDOWS[vertical] ?? ATTRIBUTION_WINDOWS.general_services;
  return outcomeCreatedAt >= callEndedAt && outcomeCreatedAt <= callEndedAt + window;
}

/**
 * Checks if a business should be excluded from churn calculation.
 * New businesses created within the current period are excluded (Req 15.9).
 */
export function isExcludedFromChurn(
  businessCreatedAt: number,
  periodStart: number,
  periodEnd: number
): boolean {
  return businessCreatedAt >= periodStart && businessCreatedAt < periodEnd;
}

export interface ActiveTenantInput {
  vertical: Vertical;
  hasCompletedOnboarding: boolean;
}

/**
 * Computes active tenant count by vertical (Req 15.1).
 * Only onboarded businesses count as active.
 */
export function computeActiveTenantCount(
  businesses: ActiveTenantInput[],
  vertical: Vertical
): number {
  return businesses.filter(
    (b) => b.vertical === vertical && b.hasCompletedOnboarding
  ).length;
}

export interface RunsheetAttachInput {
  vertical: Vertical;
  runsheetStatus?: "connected" | "disconnected" | "error" | null;
}

/**
 * Computes Runsheet attach rate for logistics vertical (Req 15.2).
 * Returns percentage (0-100).
 */
export function computeRunsheetAttachRate(businesses: RunsheetAttachInput[]): number {
  const logisticsBusinesses = businesses.filter((b) => b.vertical === "logistics");
  if (logisticsBusinesses.length === 0) return 0;
  const attached = logisticsBusinesses.filter((b) => b.runsheetStatus === "connected").length;
  return (attached / logisticsBusinesses.length) * 100;
}

export interface RevenueInput {
  vertical: Vertical;
  amount: number;
}

/**
 * Computes revenue per tenant by vertical (Req 15.3).
 */
export function computeRevenuePerTenant(
  invoices: RevenueInput[],
  activeTenantCount: number,
  vertical: Vertical
): number {
  if (activeTenantCount === 0) return 0;
  const totalRevenue = invoices
    .filter((inv) => inv.vertical === vertical)
    .reduce((sum, inv) => sum + inv.amount, 0);
  return totalRevenue / activeTenantCount;
}

export interface ChurnInput {
  vertical: Vertical;
  hasCompletedOnboarding: boolean;
  lastCallAt: number | null;
  createdAt: number;
}

/**
 * Computes churn rate by vertical (Req 15.5).
 * Churn = businesses with zero calls in trailing 30 days.
 * New businesses in the current period are excluded.
 */
export function computeChurnRate(
  businesses: ChurnInput[],
  vertical: Vertical,
  periodStart: number,
  periodEnd: number
): number {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const now = periodEnd;

  const eligible = businesses.filter(
    (b) =>
      b.vertical === vertical &&
      b.hasCompletedOnboarding &&
      !isExcludedFromChurn(b.createdAt, periodStart, periodEnd)
  );

  if (eligible.length === 0) return 0;

  const churned = eligible.filter(
    (b) => !b.lastCallAt || b.lastCallAt < now - THIRTY_DAYS_MS
  ).length;

  return (churned / eligible.length) * 100;
}
