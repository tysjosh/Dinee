// src/lib/integrations/platform/credentialTest.ts

/**
 * Credential_Test_Service.
 *
 * Probes an integration's credentials through the resolved
 * Integration_Adapter's read client and maps the outcome onto a
 * Connection_Status, which it records via an injected recorder (wired by the
 * caller to `configStore.setConnectionStatus`) and returns for the admin UI to
 * display (Req 9.3).
 *
 * Outcome → status mapping:
 *   - probe reports `{ valid: true }`          → `connected` (Req 8.2)
 *   - probe reports `{ valid: false }` / throws → `error`     (Req 8.3)
 *   - probe does not complete within 5 seconds  → invalid → `error` (Req 8.4)
 *
 * The read client is contracted never to throw and to honour a caller-provided
 * deadline, but this service also races the probe against its own 5s timeout so
 * a hung transport can never leave the status unresolved.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4 (multi-platform-voice-integrations)
 */

import type { IntegrationAdapter } from "./adapter";
import type { ConnectionStatus } from "../../../../convex/integrations/configStore";

/** The credential-test deadline in milliseconds (Req 8.4). */
const CREDENTIAL_TEST_DEADLINE_MS = 5000;

/**
 * Runs a credential test for the given adapter and records the resulting
 * connection status.
 *
 * Performs an authenticated probe against the configured base URL via the
 * adapter's read client (Req 8.1), racing it against a 5s deadline. A
 * successful probe maps to `connected` (Req 8.2); an unsuccessful probe, a
 * thrown error, or a probe that does not complete within 5 seconds maps to
 * `error` (Req 8.3, 8.4). The resolved status is persisted via `record` and
 * then returned.
 *
 * @param adapter - the resolved Integration_Adapter whose read client is probed
 * @param record - persists the resulting status (wired to setConnectionStatus)
 * @returns the recorded Connection_Status
 */
export async function runCredentialTest(
  adapter: IntegrationAdapter,
  record: (status: ConnectionStatus) => Promise<void>
): Promise<ConnectionStatus> {
  const status = await probeStatus(adapter);
  await record(status);
  return status;
}

/**
 * Probes the adapter's read client and maps the outcome to a Connection_Status.
 * Races the probe against a 5s timeout so a hung probe is treated as invalid
 * (Req 8.4). Never throws.
 */
async function probeStatus(
  adapter: IntegrationAdapter
): Promise<ConnectionStatus> {
  // A timeout that resolves (not rejects) to `error` so `Promise.race` yields a
  // status rather than surfacing a rejection when the probe hangs (Req 8.4).
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ConnectionStatus>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve("error"),
      CREDENTIAL_TEST_DEADLINE_MS
    );
  });

  const probe = (async (): Promise<ConnectionStatus> => {
    try {
      const result = await adapter.readClient.testCredential(
        CREDENTIAL_TEST_DEADLINE_MS
      );
      // Success → connected (Req 8.2); unsuccessful → error (Req 8.3).
      return result.valid ? "connected" : "error";
    } catch {
      // A thrown error is treated as an unsuccessful probe (Req 8.3).
      return "error";
    }
  })();

  try {
    return await Promise.race([probe, timeout]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}
