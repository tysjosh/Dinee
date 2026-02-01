/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as apiKeys from "../apiKeys.js";
import type * as apiUsageLogs from "../apiUsageLogs.js";
import type * as branchCapacity from "../branchCapacity.js";
import type * as branches from "../branches.js";
import type * as calls from "../calls.js";
import type * as customerPreferences from "../customerPreferences.js";
import type * as featureFlags from "../featureFlags.js";
import type * as featureNotifications from "../featureNotifications.js";
import type * as fraudSignals from "../fraudSignals.js";
import type * as internal_ from "../internal.js";
import type * as menuImports from "../menuImports.js";
import type * as menuItems from "../menuItems.js";
import type * as messaging from "../messaging.js";
import type * as migration from "../migration.js";
import type * as migrationRollback from "../migrationRollback.js";
import type * as monitoringAlerts from "../monitoringAlerts.js";
import type * as monitoringMetrics from "../monitoringMetrics.js";
import type * as orders from "../orders.js";
import type * as partners from "../partners.js";
import type * as platforms from "../platforms.js";
import type * as prompts from "../prompts.js";
import type * as restaurants from "../restaurants.js";
import type * as signup from "../signup.js";
import type * as subscriptions from "../subscriptions.js";
import type * as users from "../users.js";
import type * as webhookDeliveries from "../webhookDeliveries.js";
import type * as webhookEvents from "../webhookEvents.js";
import type * as webhookSubscriptions from "../webhookSubscriptions.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  apiUsageLogs: typeof apiUsageLogs;
  branchCapacity: typeof branchCapacity;
  branches: typeof branches;
  calls: typeof calls;
  customerPreferences: typeof customerPreferences;
  featureFlags: typeof featureFlags;
  featureNotifications: typeof featureNotifications;
  fraudSignals: typeof fraudSignals;
  internal: typeof internal_;
  menuImports: typeof menuImports;
  menuItems: typeof menuItems;
  messaging: typeof messaging;
  migration: typeof migration;
  migrationRollback: typeof migrationRollback;
  monitoringAlerts: typeof monitoringAlerts;
  monitoringMetrics: typeof monitoringMetrics;
  orders: typeof orders;
  partners: typeof partners;
  platforms: typeof platforms;
  prompts: typeof prompts;
  restaurants: typeof restaurants;
  signup: typeof signup;
  subscriptions: typeof subscriptions;
  users: typeof users;
  webhookDeliveries: typeof webhookDeliveries;
  webhookEvents: typeof webhookEvents;
  webhookSubscriptions: typeof webhookSubscriptions;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
