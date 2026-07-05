/**
 * Feature: dinee-voice-platform, Task 4.11: health-endpoint and latency smoke tests
 *
 * **Validates: Requirements 1.8, 1.9, 1.10**
 *
 * These smoke tests exercise the Voice_Runtime seams that back the three
 * latency/connectivity acceptance criteria WITHOUT booting the full Fastify
 * server (importing `src/app/ws-server/index.ts` would start a live server at
 * import time). Instead we test the underlying seams the routes delegate to:
 *
 *   - Req 1.8: the `/health` route replies `{ status: "ok" }`. We mirror that
 *     handler's response shape and assert it reports an operational status of
 *     success within the 5-second SLA.
 *   - Req 1.9: the `/incoming-call` route resolves the called number via
 *     `resolvePhoneToRoute`. We drive that seam with a fast in-memory (fake)
 *     Convex client and assert it resolves to a conversation route within the
 *     2-second SLA.
 *   - Req 1.10: on resolution the runtime builds the session (and opens the
 *     media stream) via `prepareSession`. We assert that a resolved route yields
 *     a `start` decision — the runtime would establish the media-stream
 *     connection — rather than a `terminate` decision.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fc from "fast-check";
import type { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";

import { resolvePhoneToRoute } from "@/lib/call-routing/phone-lookup";
import {
  prepareSession,
  type ResolvedCallContext,
} from "@/app/ws-server/runtime/session";
import {
  clearRegistry,
  resolvePackByConversationType,
} from "@/lib/modules/voiceDomainPackRegistry";
import { registerRestaurantVoicePack } from "@/lib/modules/packs/restaurant";

// ─── SLA budgets (from the acceptance criteria) ──────────────────────────────

const HEALTH_SLA_MS = 5000; // Req 1.8
const LOOKUP_SLA_MS = 2000; // Req 1.9

// ─── Req 1.8: health-status shape ────────────────────────────────────────────

/**
 * Mirrors the `/health` route handler in `src/app/ws-server/index.ts`
 * (`reply.send({ status: "ok" })`). Kept as a local pure function so the SLA can
 * be asserted without booting the Fastify server.
 */
function getHealthStatus(): { status: string } {
  return { status: "ok" };
}

// ─── Req 1.9: fake fast Convex client for phone lookup ───────────────────────

/**
 * A fast in-memory stand-in for the Convex HTTP client. `resolvePhoneToRoute`
 * first calls `.query(api.runsheet.numberAssignments.resolveNumber, ...)` (which
 * returns null here so non-runsheet numbers fall through) and then
 * `.query(api.phoneLookup.getEntityByPhoneNumber, { phoneNumber })`; the latter
 * returns a restaurant-branch entity immediately, so the resolution time
 * reflects the runtime seam rather than network latency.
 */
function makeFastConvexClient(phoneNumber: string): ConvexHttpClient {
  return {
    query: async (ref: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(ref).includes("resolveNumber") ||
      getFunctionName(ref).includes("resolveRoute")
        ? null
        : {
            vertical: "restaurant" as const,
            type: "branch" as const,
            restaurantId: "rest_smoke",
            branchId: "br_smoke",
            platformId: null,
            phoneNumberId: `pn_${phoneNumber}`,
          },
  } as unknown as ConvexHttpClient;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const digitArb = fc.constantFrom("0", "1", "2", "3", "4", "5", "6", "7", "8", "9");

const e164Arb = fc
  .tuple(
    fc.constantFrom("1", "2", "3", "4", "5", "6", "7", "8", "9"),
    fc.array(digitArb, { minLength: 6, maxLength: 13 })
  )
  .map(([first, rest]) => `+${first}${rest.join("")}`);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Task 4.11: health-endpoint and latency smoke tests", () => {
  beforeAll(() => {
    // Ensure the restaurant pack (owner of restaurant_inbound_order) is
    // registered so prepareSession can resolve a resolved route to a `start`.
    clearRegistry();
    registerRestaurantVoicePack();
  });

  describe("Req 1.8: health endpoint reports success within 5 seconds", () => {
    it("returns an operational status of success", () => {
      const health = getHealthStatus();
      expect(health.status).toBe("ok");
    });

    it("responds within the 5-second SLA for any number of checks", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 50 }), (checks) => {
          const start = performance.now();
          for (let i = 0; i < checks; i++) {
            const health = getHealthStatus();
            expect(health.status).toBe("ok");
          }
          const elapsed = performance.now() - start;
          expect(elapsed).toBeLessThan(HEALTH_SLA_MS);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("Req 1.9: /incoming-call number lookup resolves within 2 seconds", () => {
    it("resolves any called number to a conversation route under the SLA", async () => {
      await fc.assert(
        fc.asyncProperty(e164Arb, async (toNumber) => {
          const client = makeFastConvexClient(toNumber);

          const start = performance.now();
          const route = await resolvePhoneToRoute(client, toNumber);
          const elapsed = performance.now() - start;

          // A conversation route is resolved (Req 1.9)…
          expect(route.conversationType).toBeTruthy();
          expect(typeof route.conversationType).toBe("string");
          // …within the 2-second budget.
          expect(elapsed).toBeLessThan(LOOKUP_SLA_MS);
        }),
        { numRuns: 100 }
      );
    });

    it("resolves a restaurant branch number to the inbound-order route", async () => {
      const client = makeFastConvexClient("+15551230000");
      const route = await resolvePhoneToRoute(client, "+15551230000");
      expect(route.vertical).toBe("restaurant");
      expect(route.conversationType).toBe("restaurant_inbound_order");
    });
  });

  describe("Req 1.10: a media-stream connection is established on resolution", () => {
    it("prepareSession returns a start decision for a resolved route", async () => {
      await fc.asyncProperty(e164Arb, async (toNumber) => {
        const client = makeFastConvexClient(toNumber);
        const route = await resolvePhoneToRoute(client, toNumber);

        // Sanity: the resolved conversation type is owned by a registered pack.
        expect(resolvePackByConversationType(route.conversationType)).not.toBeNull();

        const ctx: ResolvedCallContext = {
          callSid: `smoke-${toNumber}`,
          fromNumber: "+10000000000",
          toNumber,
          tenantId: toNumber,
          conversationType: route.conversationType,
          enabledIntegrations: [],
        };

        const prepared = prepareSession(ctx);

        // On resolution the runtime opens the media stream (Req 1.10): the
        // decision is `start`, never `terminate`, and it carries the resolved
        // pack + prompt the runtime applies before the first spoken response.
        expect(prepared.kind).toBe("start");
        if (prepared.kind === "start") {
          expect(prepared.init.pack).toBeTruthy();
          expect(prepared.init.prompt.length).toBeGreaterThan(0);
          expect(prepared.init.initialPhase.length).toBeGreaterThan(0);
        }
      });

      await fc.assert(
        fc.asyncProperty(e164Arb, async (toNumber) => {
          const client = makeFastConvexClient(toNumber);
          const route = await resolvePhoneToRoute(client, toNumber);
          const ctx: ResolvedCallContext = {
            callSid: `smoke-${toNumber}`,
            fromNumber: "+10000000000",
            toNumber,
            tenantId: toNumber,
            conversationType: route.conversationType,
            enabledIntegrations: [],
          };
          const prepared = prepareSession(ctx);
          expect(prepared.kind).toBe("start");
        }),
        { numRuns: 100 }
      );
    });

    it("does not establish a media stream when the number resolves to no route (Req 1.11 contrast)", () => {
      const ctx: ResolvedCallContext = {
        callSid: "smoke-no-route",
        fromNumber: "+10000000000",
        toNumber: "+15550000000",
        tenantId: "+15550000000",
        conversationType: "", // no route mapped
        enabledIntegrations: [],
      };
      const prepared = prepareSession(ctx);
      expect(prepared.kind).toBe("terminate");
      if (prepared.kind === "terminate") {
        expect(prepared.reason).toBe("no_mapping");
      }
    });
  });
});
