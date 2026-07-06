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
import type * as ResetOTP from "../ResetOTP.js";
import type * as apiKeys from "../apiKeys.js";
import type * as apiUsageLogs from "../apiUsageLogs.js";
import type * as auth from "../auth.js";
import type * as billingEvents from "../billingEvents.js";
import type * as branchCapacity from "../branchCapacity.js";
import type * as branches from "../branches.js";
import type * as callbackSessions from "../callbackSessions.js";
import type * as calls from "../calls.js";
import type * as crons from "../crons.js";
import type * as customerPreferences from "../customerPreferences.js";
import type * as featureFlags from "../featureFlags.js";
import type * as featureNotifications from "../featureNotifications.js";
import type * as fraudSignals from "../fraudSignals.js";
import type * as http from "../http.js";
import type * as integrationAuditLog from "../integrationAuditLog.js";
import type * as integrations_adminConfig from "../integrations/adminConfig.js";
import type * as integrations_authorization from "../integrations/authorization.js";
import type * as integrations_configStore from "../integrations/configStore.js";
import type * as integrations_controlPlane from "../integrations/controlPlane.js";
import type * as integrations_controlPlaneAudit from "../integrations/controlPlaneAudit.js";
import type * as integrations_controlPlaneManagement from "../integrations/controlPlaneManagement.js";
import type * as integrations_controlPlaneMetrics from "../integrations/controlPlaneMetrics.js";
import type * as integrations_credentialTestHistory from "../integrations/credentialTestHistory.js";
import type * as integrations_migrateRunsheet from "../integrations/migrateRunsheet.js";
import type * as integrations_phoneRoutes from "../integrations/phoneRoutes.js";
import type * as integrations_runtimeCredentialGuard from "../integrations/runtimeCredentialGuard.js";
import type * as integrations_runtimeCredentials from "../integrations/runtimeCredentials.js";
import type * as internal_ from "../internal.js";
import type * as invitations from "../invitations.js";
import type * as kpiComputation from "../kpiComputation.js";
import type * as kpiSnapshots from "../kpiSnapshots.js";
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
import type * as migrations_step1_addVerticalField from "../migrations/step1_addVerticalField.js";
import type * as migrations_step2_addFeatureFlags from "../migrations/step2_addFeatureFlags.js";
import type * as migrations_step3_gateRestaurantFlows from "../migrations/step3_gateRestaurantFlows.js";
import type * as monitoringAlerts from "../monitoringAlerts.js";
import type * as monitoringMetrics from "../monitoringMetrics.js";
import type * as orders from "../orders.js";
import type * as partners from "../partners.js";
import type * as phoneLookup from "../phoneLookup.js";
import type * as phoneProvisioning_actions from "../phoneProvisioning/actions.js";
import type * as phoneProvisioning_mutations from "../phoneProvisioning/mutations.js";
import type * as phoneProvisioning_providerRouting from "../phoneProvisioning/providerRouting.js";
import type * as phoneProvisioning_providers_africasTalking from "../phoneProvisioning/providers/africasTalking.js";
import type * as phoneProvisioning_providers_index from "../phoneProvisioning/providers/index.js";
import type * as phoneProvisioning_providers_termii from "../phoneProvisioning/providers/termii.js";
import type * as phoneProvisioning_providers_twilio from "../phoneProvisioning/providers/twilio.js";
import type * as phoneProvisioning_providers_types from "../phoneProvisioning/providers/types.js";
import type * as phoneProvisioning_queries from "../phoneProvisioning/queries.js";
import type * as phoneProvisioning_scheduledFunctions from "../phoneProvisioning/scheduledFunctions.js";
import type * as platforms from "../platforms.js";
import type * as prompts from "../prompts.js";
import type * as restaurants from "../restaurants.js";
import type * as runsheet_agentAlerts from "../runsheet/agentAlerts.js";
import type * as runsheet_agentMetrics from "../runsheet/agentMetrics.js";
import type * as runsheet_integrations from "../runsheet/integrations.js";
import type * as runsheet_integrationsData from "../runsheet/integrationsData.js";
import type * as runsheet_numberAssignments from "../runsheet/numberAssignments.js";
import type * as runsheet_transcripts from "../runsheet/transcripts.js";
import type * as runsheetWebhook from "../runsheetWebhook.js";
import type * as shared_phoneProvisioningTypes from "../shared/phoneProvisioningTypes.js";
import type * as shared_validators from "../shared/validators.js";
import type * as signup from "../signup.js";
import type * as subscriptions from "../subscriptions.js";
import type * as tokenHash from "../tokenHash.js";
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
  ResetOTP: typeof ResetOTP;
  apiKeys: typeof apiKeys;
  apiUsageLogs: typeof apiUsageLogs;
  auth: typeof auth;
  billingEvents: typeof billingEvents;
  branchCapacity: typeof branchCapacity;
  branches: typeof branches;
  callbackSessions: typeof callbackSessions;
  calls: typeof calls;
  crons: typeof crons;
  customerPreferences: typeof customerPreferences;
  featureFlags: typeof featureFlags;
  featureNotifications: typeof featureNotifications;
  fraudSignals: typeof fraudSignals;
  http: typeof http;
  integrationAuditLog: typeof integrationAuditLog;
  "integrations/adminConfig": typeof integrations_adminConfig;
  "integrations/authorization": typeof integrations_authorization;
  "integrations/configStore": typeof integrations_configStore;
  "integrations/controlPlane": typeof integrations_controlPlane;
  "integrations/controlPlaneAudit": typeof integrations_controlPlaneAudit;
  "integrations/controlPlaneManagement": typeof integrations_controlPlaneManagement;
  "integrations/controlPlaneMetrics": typeof integrations_controlPlaneMetrics;
  "integrations/credentialTestHistory": typeof integrations_credentialTestHistory;
  "integrations/migrateRunsheet": typeof integrations_migrateRunsheet;
  "integrations/phoneRoutes": typeof integrations_phoneRoutes;
  "integrations/runtimeCredentialGuard": typeof integrations_runtimeCredentialGuard;
  "integrations/runtimeCredentials": typeof integrations_runtimeCredentials;
  internal: typeof internal_;
  invitations: typeof invitations;
  kpiComputation: typeof kpiComputation;
  kpiSnapshots: typeof kpiSnapshots;
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
  "migrations/step1_addVerticalField": typeof migrations_step1_addVerticalField;
  "migrations/step2_addFeatureFlags": typeof migrations_step2_addFeatureFlags;
  "migrations/step3_gateRestaurantFlows": typeof migrations_step3_gateRestaurantFlows;
  monitoringAlerts: typeof monitoringAlerts;
  monitoringMetrics: typeof monitoringMetrics;
  orders: typeof orders;
  partners: typeof partners;
  phoneLookup: typeof phoneLookup;
  "phoneProvisioning/actions": typeof phoneProvisioning_actions;
  "phoneProvisioning/mutations": typeof phoneProvisioning_mutations;
  "phoneProvisioning/providerRouting": typeof phoneProvisioning_providerRouting;
  "phoneProvisioning/providers/africasTalking": typeof phoneProvisioning_providers_africasTalking;
  "phoneProvisioning/providers/index": typeof phoneProvisioning_providers_index;
  "phoneProvisioning/providers/termii": typeof phoneProvisioning_providers_termii;
  "phoneProvisioning/providers/twilio": typeof phoneProvisioning_providers_twilio;
  "phoneProvisioning/providers/types": typeof phoneProvisioning_providers_types;
  "phoneProvisioning/queries": typeof phoneProvisioning_queries;
  "phoneProvisioning/scheduledFunctions": typeof phoneProvisioning_scheduledFunctions;
  platforms: typeof platforms;
  prompts: typeof prompts;
  restaurants: typeof restaurants;
  "runsheet/agentAlerts": typeof runsheet_agentAlerts;
  "runsheet/agentMetrics": typeof runsheet_agentMetrics;
  "runsheet/integrations": typeof runsheet_integrations;
  "runsheet/integrationsData": typeof runsheet_integrationsData;
  "runsheet/numberAssignments": typeof runsheet_numberAssignments;
  "runsheet/transcripts": typeof runsheet_transcripts;
  runsheetWebhook: typeof runsheetWebhook;
  "shared/phoneProvisioningTypes": typeof shared_phoneProvisioningTypes;
  "shared/validators": typeof shared_validators;
  signup: typeof signup;
  subscriptions: typeof subscriptions;
  tokenHash: typeof tokenHash;
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
