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
import type * as callbackSessions from "../callbackSessions.js";
import type * as calls from "../calls.js";
import type * as crons from "../crons.js";
import type * as customerPreferences from "../customerPreferences.js";
import type * as featureFlags from "../featureFlags.js";
import type * as featureNotifications from "../featureNotifications.js";
import type * as fraudSignals from "../fraudSignals.js";
import type * as internal_ from "../internal.js";
import type * as logistics_adapters from "../logistics/adapters.js";
import type * as logistics_idempotencyKeys from "../logistics/idempotencyKeys.js";
import type * as logistics_locations from "../logistics/locations.js";
import type * as logistics_organizations from "../logistics/organizations.js";
import type * as logistics_riders from "../logistics/riders.js";
import type * as logistics_shipmentEvents from "../logistics/shipmentEvents.js";
import type * as logistics_shipments from "../logistics/shipments.js";
import type * as menuImports from "../menuImports.js";
import type * as menuItems from "../menuItems.js";
import type * as messaging from "../messaging.js";
import type * as migration from "../migration.js";
import type * as migrationRollback from "../migrationRollback.js";
import type * as monitoringAlerts from "../monitoringAlerts.js";
import type * as monitoringMetrics from "../monitoringMetrics.js";
import type * as orders from "../orders.js";
import type * as partners from "../partners.js";
import type * as phoneLookup from "../phoneLookup.js";
import type * as platforms from "../platforms.js";
import type * as prompts from "../prompts.js";
import type * as restaurants from "../restaurants.js";
import type * as runsheetWebhook from "../runsheetWebhook.js";
import type * as shared_validators from "../shared/validators.js";
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
  callbackSessions: typeof callbackSessions;
  calls: typeof calls;
  crons: typeof crons;
  customerPreferences: typeof customerPreferences;
  featureFlags: typeof featureFlags;
  featureNotifications: typeof featureNotifications;
  fraudSignals: typeof fraudSignals;
  internal: typeof internal_;
  "logistics/adapters": typeof logistics_adapters;
  "logistics/idempotencyKeys": typeof logistics_idempotencyKeys;
  "logistics/locations": typeof logistics_locations;
  "logistics/organizations": typeof logistics_organizations;
  "logistics/riders": typeof logistics_riders;
  "logistics/shipmentEvents": typeof logistics_shipmentEvents;
  "logistics/shipments": typeof logistics_shipments;
  menuImports: typeof menuImports;
  menuItems: typeof menuItems;
  messaging: typeof messaging;
  migration: typeof migration;
  migrationRollback: typeof migrationRollback;
  monitoringAlerts: typeof monitoringAlerts;
  monitoringMetrics: typeof monitoringMetrics;
  orders: typeof orders;
  partners: typeof partners;
  phoneLookup: typeof phoneLookup;
  platforms: typeof platforms;
  prompts: typeof prompts;
  restaurants: typeof restaurants;
  runsheetWebhook: typeof runsheetWebhook;
  "shared/validators": typeof shared_validators;
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
