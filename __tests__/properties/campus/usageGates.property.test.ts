// Feature: dinee-campus, Property 33: Usage gates enforce tier limits
/**
 * Feature: dinee-campus, Property 33: Usage gates enforce tier limits
 *
 * Validates: Requirements 4.5, 5.7, 13.1, 13.3, 13.6, 13.7
 *
 * For any account usage state within a calendar month, the Usage_Meter SHALL
 * permit creating an agent, uploading a document, and starting a call if and
 * only if the corresponding usage is strictly below the account tier's limit
 * (free tier: 1 agent, 5 document uploads, 30 call minutes). A document upload
 * SHALL additionally require the document size to be within both layered size
 * limits — no greater than the platform maximum of 20 MB (checked FIRST) and no
 * greater than the per-tier per-document limit of 10 MB for the free tier. When
 * a limit is reached the corresponding action SHALL be blocked with the
 * applicable limit and an upgrade option (Req 4.5, 5.7, 13.3); blocking a call
 * start SHALL leave the agent's configuration and data unchanged (Req 13.6,
 * 13.7) — guaranteed here by the purity of `canStartCall`, which mutates
 * nothing and surfaces a "temporarily unavailable" indication instead of an
 * upgrade option.
 *
 * The pure decisions under test are `canCreateAgent`, `canUploadDocument`, and
 * `canStartCall`. Each property asserts the biconditional (allowed exactly when
 * usage is strictly below the applicable limit and, for documents, both size
 * layers hold) and checks the shape of the blocked branch, including the
 * layered document-size ordering (platform maximum reported before the per-tier
 * limit before the upload-count limit).
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  canCreateAgent,
  canUploadDocument,
  canStartCall,
  resolveTierLimits,
  FREE_TIER_LIMITS,
} from "../../../convex/campus/logic/usage";
import {
  PLATFORM_MAX_DOCUMENT_BYTES,
  perTierDocumentLimitBytes,
  type AccountTier,
} from "../../../convex/campus/logic/knowledge";

/** Both metered account tiers (Req 13.1). */
const tierArb: fc.Arbitrary<AccountTier> = fc.constantFrom("free", "paid");

/**
 * Non-negative usage counter spanning both sides of the small free-tier count
 * limits (1 agent, 5 uploads) and the 30 call-minute limit, so the strict
 * below-limit boundary is exercised in both directions.
 */
const usageCountArb: fc.Arbitrary<number> = fc.nat({ max: 40 });

/**
 * Document sizes spanning both layered boundaries: the per-tier free limit
 * (10 MB) and the platform maximum (20 MB), plus values comfortably above and
 * below each so all three size branches (platform, per-tier, within-bounds) are
 * exercised.
 */
const sizeBytesArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 0, max: PLATFORM_MAX_DOCUMENT_BYTES + 5 * 1024 * 1024 }),
  fc.constantFrom(
    0,
    perTierDocumentLimitBytes("free") - 1,
    perTierDocumentLimitBytes("free"),
    perTierDocumentLimitBytes("free") + 1,
    PLATFORM_MAX_DOCUMENT_BYTES - 1,
    PLATFORM_MAX_DOCUMENT_BYTES,
    PLATFORM_MAX_DOCUMENT_BYTES + 1
  )
);

describe("Property 33: Usage gates enforce tier limits", () => {
  it("permits creating an agent iff the agent count is strictly below the tier limit (Req 4.5, 13.3)", () => {
    fc.assert(
      fc.property(usageCountArb, tierArb, (agentCount, tier) => {
        const limit = resolveTierLimits(tier).agents;
        const result = canCreateAgent(agentCount, tier);
        expect(result.allowed).toBe(agentCount < limit);
        if (!result.allowed) {
          expect(result.reason).toBe("usage_limit");
          expect(result.dimension).toBe("agents");
          expect(result.limit).toBe(limit);
          expect(result.upgradeOption).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("permits starting a call iff call-minutes usage is strictly below the tier limit and never mutates its inputs (Req 13.6, 13.7)", () => {
    fc.assert(
      fc.property(usageCountArb, tierArb, (callMinutesUsed, tier) => {
        const limit = resolveTierLimits(tier).callMinutes;
        const result = canStartCall(callMinutesUsed, tier);
        expect(result.allowed).toBe(callMinutesUsed < limit);
        if (!result.allowed) {
          // Blocked call start: "temporarily unavailable", NOT an upgrade
          // option, and the agent's configuration/data are left unchanged
          // (purity — the function returns a fresh result and touches nothing).
          expect(result.reason).toBe("call_minutes_exhausted");
          expect(result.limit).toBe(limit);
          expect(result.unavailable).toBe(true);
          expect(result).not.toHaveProperty("upgradeOption");
        }
      }),
      { numRuns: 100 }
    );
  });

  it("permits a document upload iff both layered size limits hold AND the upload count is below the tier limit (Req 5.7, 13.1, 13.3)", () => {
    fc.assert(
      fc.property(usageCountArb, sizeBytesArb, tierArb, (uploadCount, sizeBytes, tier) => {
        const perTierLimit = perTierDocumentLimitBytes(tier);
        const uploadLimit = resolveTierLimits(tier).documentUploads;
        const result = canUploadDocument(uploadCount, sizeBytes, tier);

        const withinPlatform = sizeBytes <= PLATFORM_MAX_DOCUMENT_BYTES;
        const withinTierSize = sizeBytes <= perTierLimit;
        const withinCount = uploadCount < uploadLimit;
        const shouldAllow = withinPlatform && withinTierSize && withinCount;

        expect(result.allowed).toBe(shouldAllow);
        // The applicable per-tier size limit is surfaced on every outcome.
        expect(result.perTierSizeLimitBytes).toBe(perTierLimit);

        if (!result.allowed) {
          // Layered ordering: platform maximum checked FIRST, then per-tier
          // size, then upload-count Usage_Limit.
          if (!withinPlatform) {
            expect(result.reason).toBe("document_too_large_platform");
            if (result.reason === "document_too_large_platform") {
              expect(result.limitBytes).toBe(PLATFORM_MAX_DOCUMENT_BYTES);
            }
          } else if (!withinTierSize) {
            expect(result.reason).toBe("document_too_large_tier");
            if (result.reason === "document_too_large_tier") {
              expect(result.limitBytes).toBe(perTierLimit);
              expect(result.upgradeOption).toBe(true);
            }
          } else {
            expect(result.reason).toBe("usage_limit");
            if (result.reason === "usage_limit") {
              expect(result.limit).toBe(uploadLimit);
              expect(result.upgradeOption).toBe(true);
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("applies the concrete free-tier limits: 1 agent, 5 uploads, 30 call minutes, 10 MB per document (Req 13.1)", () => {
    expect(FREE_TIER_LIMITS.agents).toBe(1);
    expect(FREE_TIER_LIMITS.documentUploads).toBe(5);
    expect(FREE_TIER_LIMITS.callMinutes).toBe(30);
    expect(perTierDocumentLimitBytes("free")).toBe(10 * 1024 * 1024);

    // Boundary spot-checks of the strict-below-limit rule on the free tier.
    expect(canCreateAgent(0, "free").allowed).toBe(true);
    expect(canCreateAgent(1, "free").allowed).toBe(false);
    expect(canStartCall(29, "free").allowed).toBe(true);
    expect(canStartCall(30, "free").allowed).toBe(false);
    expect(canUploadDocument(4, 10 * 1024 * 1024, "free").allowed).toBe(true);
    expect(canUploadDocument(5, 10 * 1024 * 1024, "free").allowed).toBe(false);
  });
});
