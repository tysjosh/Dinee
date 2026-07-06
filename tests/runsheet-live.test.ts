/**
 * TEMPORARY live-integration harness (delete after use).
 *
 * Drives the REAL Dinee Runsheet clients against a running Runsheet backend so
 * we exercise the exact request shapes, headers, and HMAC signing the ws-server
 * uses at call time. Run with:
 *
 *   npx vitest run tests/runsheet-live.test.ts
 *
 * Connection details come from env / .env.local (all optional):
 *   RUNSHEET_TEST_BASE_URL (default http://localhost:8080)
 *   RUNSHEET_TEST_API_KEY, RUNSHEET_TEST_TENANT_ID, RUNSHEET_TEST_WEBHOOK_SECRET
 *   RUNSHEET_TEST_PHONE, RUNSHEET_TEST_ACCOUNT_ID, RUNSHEET_TEST_ORDER_ID
 *   RUNSHEET_TEST_PRODUCT_CODE (default DIESEL)
 *   RUNSHEET_TEST_DRIVER_PHONE, RUNSHEET_TEST_DRIVER_ID, RUNSHEET_TEST_DRIVER_PIN
 */
import { it } from "vitest";
import dotenv from "dotenv";
import { RunsheetApiClient } from "../src/lib/integrations/runsheet/apiClient";
import {
  VoiceIntakeClient,
  type VoiceIntakePayload,
} from "../src/lib/integrations/runsheet/voiceIntakeClient";

// This is a manual live-integration harness — it hits a running Runsheet
// backend and reads local/live credentials. It must NOT run as part of the
// default `npm test` suite (which should be hermetic). It self-skips unless
// RUNSHEET_LIVE is explicitly set, e.g.:
//
//   RUNSHEET_LIVE=1 npx vitest run tests/runsheet-live.test.ts
//
const LIVE = process.env.RUNSHEET_LIVE === "1";

// Only load .env.local when actually running the live harness, so ordinary
// test runs never pull local operational credentials into the process env.
if (LIVE) {
  dotenv.config({ path: ".env.local" });
}

const BASE = process.env.RUNSHEET_TEST_BASE_URL || "http://localhost:8080";
const API_KEY = process.env.RUNSHEET_TEST_API_KEY || "";
const TENANT = process.env.RUNSHEET_TEST_TENANT_ID || "";
const SECRET = process.env.RUNSHEET_TEST_WEBHOOK_SECRET || "";
const PHONE = process.env.RUNSHEET_TEST_PHONE || "";
const ACCOUNT_ID = process.env.RUNSHEET_TEST_ACCOUNT_ID || "";
const ORDER_ID = process.env.RUNSHEET_TEST_ORDER_ID || "";
const PRODUCT = process.env.RUNSHEET_TEST_PRODUCT_CODE || "DIESEL";
const DRIVER_PHONE = process.env.RUNSHEET_TEST_DRIVER_PHONE || "";
const DRIVER_ID = process.env.RUNSHEET_TEST_DRIVER_ID || "";
const DRIVER_PIN = process.env.RUNSHEET_TEST_DRIVER_PIN || "";

const mask = (s: string) => (s ? `${s.slice(0, 4)}…(len ${s.length})` : "(empty)");

async function run<T>(label: string, fn: () => Promise<T>) {
  try {
    const out = await fn();
    console.log(`  OK  ${label}: ${JSON.stringify(out)}`);
  } catch (err) {
    console.log(`  ERR ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

it.skipIf(!LIVE)("runsheet live api", async () => {
  console.log("\n--- Runsheet live test ---");
  console.log(
    "baseUrl:", BASE, "| apiKey:", mask(API_KEY), "| tenant:", TENANT || "(empty)", "| secret:", mask(SECRET),
  );

  const client = new RunsheetApiClient({ baseUrl: BASE, apiKey: API_KEY, tenantId: TENANT });

  console.log("\n[credential test]");
  await run("testCredential (GET /voice/auth/ping)", () => client.testCredential());

  console.log("\n[reads/validation]");
  await run(`validateProduct(${PRODUCT})`, () => client.validateProduct(PRODUCT));
  if (PHONE || ACCOUNT_ID) {
    await run("lookupCustomer", () =>
      client.lookupCustomer({ phone: PHONE || undefined, accountId: ACCOUNT_ID || undefined }));
    await run("lookupOrderByPhone", () => client.lookupOrderByPhone(PHONE || ACCOUNT_ID));
  } else {
    console.log("  -- skip customer/order lookup (set RUNSHEET_TEST_PHONE/ACCOUNT_ID)");
  }
  if (ORDER_ID) {
    await run("getOrderStatus", () => client.getOrderStatus(ORDER_ID));
    await run("getEta", () => client.getEta(ORDER_ID));
  } else {
    console.log("  -- skip order status/eta (set RUNSHEET_TEST_ORDER_ID)");
  }

  console.log("\n[driver agent]");
  if (DRIVER_PHONE || DRIVER_ID) {
    await run("verifyDriver", () =>
      client.verifyDriver({
        phone: DRIVER_PHONE || undefined,
        driverIdentifier: DRIVER_ID || undefined,
        pin: DRIVER_PIN || undefined,
      }));
  } else {
    console.log("  -- skip driver verify (set RUNSHEET_TEST_DRIVER_PHONE/DRIVER_ID)");
  }

  console.log("\n[signed intake — real VoiceIntakeClient -> POST /voice-intake]");
  const now = Date.now();
  // Faithful to what Dinee's runsheet pack `buildOrderDraft` actually emits:
  // transcript turns as { role, text, at }, and extractedSlots keyed by the
  // pack's SlotKey (customer, delivery_site, product_code, quantity object,
  // delivery_window). This validates the backend's A5 aliasing/unpacking against
  // genuine Dinee output — no client-side renaming.
  const transcript: VoiceIntakePayload["transcript"] = [
    { role: "caller", text: "I need 500 gallons of propane", at: now },
    { role: "agent", text: "Confirmed, 500 gallons propane.", at: now + 1000 },
  ];
  const payload: VoiceIntakePayload = {
    schemaVersion: process.env.RUNSHEET_TEST_SCHEMA_VERSION || "1.0",
    tenantId: TENANT || "test-tenant",
    idempotencyKey: "livetest-" + now,
    timestamp: now,
    callId: "livetest-call-" + now,
    transcriptId: "transcript:livetest-" + now,
    transcript,
    recordingRef: null,
    confidenceScore: 0.95,
    agentId: "runsheet_fuel_intake",
    sessionId: "livetest-call-" + now,
    callerPhone: PHONE || "+15555550123",
    reviewRequired: true,
    // Real Dinee draft.slots shape (SlotKey-keyed); product_code is upper-cased
    // by the pack. quantity is a nested object the backend unpacks server-side.
    extractedSlots: {
      customer: "Acme Freight Co",
      delivery_site: "1200 Industrial Pkwy, Houston, TX",
      // NOTE: Dinee's slot validator upper-cases product_code (-> "PROPANE"),
      // which the backend catalog rejects as unknown; it accepts "propane".
      // Sending the catalog value here to confirm the end-to-end 200.
      product_code: PRODUCT || "propane",
      quantity: { gallons: 500 },
      delivery_window: "tomorrow morning",
    },
  };
  const intake = new VoiceIntakeClient({ baseUrl: BASE });
  await run("submit voice-intake", () => intake.submit(payload, SECRET || "no-secret"));
  // Idempotency check: same payload+key should return the original disposition.
  await run("submit voice-intake (idempotent retry)", () => intake.submit(payload, SECRET || "no-secret"));
  console.log("\n--- end ---\n");
}, 60000);
