/**
 * Feature: multi-platform-voice-integrations, Property 16: Credential-test
 * outcome maps to connection status
 *
 * Validates: Requirements 8.2, 8.3, 8.4
 *
 * `runCredentialTest(adapter, record)` probes the adapter's read client
 * (`readClient.testCredential(5000)`), races it against a 5s deadline, records
 * the resulting Connection_Status via `record`, and returns it. This property
 * asserts the outcome→status mapping holds across all probe outcomes:
 *
 *   - a successful probe (`{ valid: true }`)                 → `connected` (Req 8.2)
 *   - an unsuccessful probe (`{ valid: false }` or a throw)  → `error`     (Req 8.3)
 *   - a probe that does not complete within 5 seconds        → `error`     (Req 8.4)
 *
 * and that the status handed to `record` is byte-for-byte the status returned.
 *
 * The success / fail-valid-false / fail-throw mapping is exercised under
 * fast-check (min 100 iterations) with real timers, since those probes settle
 * immediately. The 5s-timeout case is exercised in a dedicated deterministic
 * test using fake timers (advancing past the 5s deadline) so the suite never
 * waits on the wall clock and never interacts poorly with fast-check's runner.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import { runCredentialTest } from "../../src/lib/integrations/platform/credentialTest";
import type {
  IntegrationAdapter,
  ReadClient,
} from "../../src/lib/integrations/platform/adapter";
import type { TransportContract } from "../../src/lib/integrations/platform/types";
import type { ConnectionStatus } from "../../convex/integrations/configStore";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A well-formed Transport_Contract; irrelevant to the mapping under test. */
function makeContract(): TransportContract {
  return {
    authScheme: "bearer",
    readPathPrefix: "/voice",
    intakePath: "/voice-intake",
    timestampFormat: "iso-8601",
    schemaVersion: "1.0",
    tenantHeader: "X-Tenant",
  };
}

/**
 * Builds a minimal IntegrationAdapter whose read client behaves per the chosen
 * probe outcome. The contract/intake client are inert stubs — only
 * `readClient.testCredential` participates in the mapping under test.
 */
function makeAdapter(testCredential: ReadClient["testCredential"]): IntegrationAdapter {
  return {
    platformId: "test-platform",
    contract: makeContract(),
    readClient: { testCredential },
    intakeClient: {
      submit: async () => ({ status: "accepted" as const, httpStatus: 200 }),
    },
  };
}

/** Records statuses handed to `runCredentialTest`'s recorder, for assertions. */
function makeRecorder() {
  const recorded: ConnectionStatus[] = [];
  const record = async (status: ConnectionStatus): Promise<void> => {
    recorded.push(status);
  };
  return { recorded, record };
}

afterEach(() => {
  vi.useRealTimers();
});

// ─── Immediately-settling probe outcomes (Req 8.2, 8.3) ───────────────────────

/** The immediately-settling probe outcomes and their expected mapped status. */
type ImmediateOutcome = "success" | "fail-valid-false" | "fail-throw";

const immediateOutcomeArb: fc.Arbitrary<ImmediateOutcome> = fc.constantFrom(
  "success",
  "fail-valid-false",
  "fail-throw"
);

const EXPECTED: Record<ImmediateOutcome, ConnectionStatus> = {
  success: "connected",
  "fail-valid-false": "error",
  "fail-throw": "error",
};

/** Builds a `testCredential` implementation for an immediately-settling outcome. */
function testCredentialFor(
  outcome: ImmediateOutcome
): ReadClient["testCredential"] {
  switch (outcome) {
    case "success":
      return async () => ({ valid: true });
    case "fail-valid-false":
      return async () => ({ valid: false });
    case "fail-throw":
      return async () => {
        throw new Error("probe failed");
      };
  }
}

describe("Feature: multi-platform-voice-integrations, Property 16: Credential-test outcome maps to connection status", () => {
  it("maps a successful probe to connected and an unsuccessful/throwing probe to error, recording exactly the returned status", async () => {
    await fc.assert(
      fc.asyncProperty(immediateOutcomeArb, async (outcome) => {
        const adapter = makeAdapter(testCredentialFor(outcome));
        const { recorded, record } = makeRecorder();

        const returned = await runCredentialTest(adapter, record);

        // The returned status matches the expected outcome→status mapping.
        expect(returned).toBe(EXPECTED[outcome]);
        // The recorded status equals the returned status (recorded exactly once).
        expect(recorded).toEqual([returned]);
      }),
      { numRuns: 100 }
    );
  });

  it("maps a probe that does not complete within 5s to error, recording exactly the returned status (Req 8.4)", async () => {
    vi.useFakeTimers();

    // A probe that never resolves (hangs) — the 5s deadline must win the race.
    const adapter = makeAdapter(() => new Promise<{ valid: boolean }>(() => {}));
    const { recorded, record } = makeRecorder();

    const pending = runCredentialTest(adapter, record);
    // Drive past the 5s deadline without waiting on the wall clock.
    await vi.advanceTimersByTimeAsync(5000);
    const returned = await pending;

    expect(returned).toBe("error");
    expect(recorded).toEqual([returned]);
  });
});
