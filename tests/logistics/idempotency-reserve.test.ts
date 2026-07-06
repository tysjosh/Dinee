/**
 * Idempotency Reserve — atomic check-and-insert semantics (finding #6 fix).
 *
 * The real reservation is a single Convex mutation (`reserveIdempotencyKey`)
 * whose transaction makes the check-and-insert atomic, so two concurrent
 * requests with the same (key, partnerId) can never both proceed. Since Convex
 * mutations can't be invoked from vitest, this mirrors the mutation's decision
 * logic as a pure function and locks in the outcome table:
 *
 *   - no record            → reserved   (write "pending", proceed)
 *   - "failed" record      → reserved   (re-executable; re-reserve)
 *   - "pending" same hash   → in_progress (concurrent duplicate → 409)
 *   - "pending" diff hash   → mismatch   (422)
 *   - "success" same hash   → replay     (return stored response)
 *   - "success" diff hash   → mismatch   (422)
 */
import { describe, it, expect } from "vitest";

type Status = "pending" | "success" | "failed";

interface Record {
  key: string;
  partnerId: string;
  requestHash: string;
  responseStatus: number;
  responseBody: string;
  status: Status;
}

type Outcome =
  | { outcome: "reserved" }
  | { outcome: "in_progress" }
  | { outcome: "mismatch" }
  | { outcome: "replay"; responseStatus: number; responseBody: string };

/** Mirrors the handler of convex/logistics/idempotencyKeys.reserveIdempotencyKey. */
function simulateReserve(
  store: Record[],
  key: string,
  partnerId: string,
  requestHash: string
): Outcome {
  const existing = store.find((r) => r.key === key && r.partnerId === partnerId);

  if (!existing) return { outcome: "reserved" };

  const status = existing.status ?? "success";

  if (status === "failed") return { outcome: "reserved" };

  if (status === "pending") {
    return existing.requestHash === requestHash
      ? { outcome: "in_progress" }
      : { outcome: "mismatch" };
  }

  // success
  if (existing.requestHash === requestHash) {
    return {
      outcome: "replay",
      responseStatus: existing.responseStatus,
      responseBody: existing.responseBody,
    };
  }
  return { outcome: "mismatch" };
}

function rec(partial: Partial<Record>): Record {
  return {
    key: "k",
    partnerId: "p",
    requestHash: "h",
    responseStatus: 201,
    responseBody: "{}",
    status: "success",
    ...partial,
  };
}

describe("reserveIdempotencyKey outcome semantics", () => {
  it("reserves a free key", () => {
    expect(simulateReserve([], "k", "p", "h")).toEqual({ outcome: "reserved" });
  });

  it("treats a failed prior attempt as re-reservable", () => {
    const store = [rec({ status: "failed", requestHash: "h" })];
    expect(simulateReserve(store, "k", "p", "h")).toEqual({ outcome: "reserved" });
  });

  it("blocks a concurrent duplicate holding a pending reservation (same hash)", () => {
    const store = [rec({ status: "pending", requestHash: "h" })];
    expect(simulateReserve(store, "k", "p", "h")).toEqual({ outcome: "in_progress" });
  });

  it("rejects a pending reservation reused with a different body", () => {
    const store = [rec({ status: "pending", requestHash: "h1" })];
    expect(simulateReserve(store, "k", "p", "h2")).toEqual({ outcome: "mismatch" });
  });

  it("replays a stored success with the same hash", () => {
    const store = [rec({ status: "success", requestHash: "h", responseStatus: 201, responseBody: '{"ok":true}' })];
    expect(simulateReserve(store, "k", "p", "h")).toEqual({
      outcome: "replay",
      responseStatus: 201,
      responseBody: '{"ok":true}',
    });
  });

  it("rejects a success key reused with a different body (422)", () => {
    const store = [rec({ status: "success", requestHash: "h1" })];
    expect(simulateReserve(store, "k", "p", "h2")).toEqual({ outcome: "mismatch" });
  });

  it("scopes reservations by partner (no cross-partner collision)", () => {
    const store = [rec({ partnerId: "p1", status: "pending", requestHash: "h" })];
    // Same key + hash but a different partner is unaffected → reserved.
    expect(simulateReserve(store, "k", "p2", "h")).toEqual({ outcome: "reserved" });
  });

  it("only one of two concurrent reservations wins (the loser sees in_progress)", () => {
    const store: Record[] = [];
    // First request reserves.
    const first = simulateReserve(store, "k", "p", "h");
    expect(first).toEqual({ outcome: "reserved" });
    // Simulate the atomic insert the winning transaction performs.
    store.push(rec({ status: "pending", requestHash: "h" }));
    // Second concurrent request with the same key + hash is blocked.
    const second = simulateReserve(store, "k", "p", "h");
    expect(second).toEqual({ outcome: "in_progress" });
  });
});
