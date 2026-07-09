// Feature: dinee-campus, Property 15: Share formats and share card are complete and embed the call link
/**
 * Feature: dinee-campus, Property 15: Share formats and share card are complete and embed the call link
 *
 * Validates: Requirements 7.3, 7.4, 15.14
 *
 * For any published Campus_Agent, the share-format set SHALL be complete
 * (copy-link, QR, SMS/iMessage, Instagram, TikTok, Snapchat, embeddable card)
 * and every link-bearing format SHALL embed the Call_Link URL (Req 7.3, 7.4).
 * The Share_Card SHALL be produced in Instagram, TikTok, and Snapchat formats,
 * and each format SHALL contain the agent name, Campus_Tag, Agent_Type, the
 * visible "AI voice agent" label, and the Call_Link (Req 15.14).
 *
 * The pure functions under test are {@link assembleShareFormats},
 * {@link assembleShareCard}, and the {@link AI_VOICE_AGENT_LABEL} constant.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  assembleShareFormats,
  assembleShareCard,
  buildCallLink,
  AI_VOICE_AGENT_LABEL,
  SOCIAL_PLATFORMS,
  type ShareAgent,
} from "../../../convex/campus/logic/share";
import { AGENT_TYPES } from "../../../convex/campus/logic/validation";

/**
 * A URL-safe slug arbitrary: a non-empty run of lowercase alphanumerics and
 * hyphens, matching the shape {@link buildCallLink} joins onto the base URL.
 */
const slugArb: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
    { minLength: 1, maxLength: 40 }
  )
  .map((chars) => chars.join(""));

/**
 * A base URL arbitrary spanning http/https, with and without a trailing slash,
 * so the Call_Link construction is exercised across both normalization paths.
 */
const baseUrlArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("https", "http"),
    fc.domain(),
    fc.constantFrom("", "/", "//", "/path", "/path/")
  )
  .map(([scheme, host, suffix]) => `${scheme}://${host}${suffix}`);

/**
 * A ShareAgent arbitrary spanning the identity fields a share format / card is
 * assembled from: a free-form name and Campus_Tag (may include punctuation and
 * whitespace), one of the seven Agent_Types, and a URL-safe slug.
 */
const shareAgentArb: fc.Arbitrary<ShareAgent> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  campusTag: fc.string({ minLength: 1, maxLength: 100 }),
  agentType: fc.constantFrom(...AGENT_TYPES),
  slug: slugArb,
});

describe("Property 15: Share formats and share card are complete and embed the call link", () => {
  it("produces a complete share-format set whose link-bearing formats embed the Call_Link (Req 7.3, 7.4)", () => {
    fc.assert(
      fc.property(shareAgentArb, baseUrlArb, (agent, baseUrl) => {
        const formats = assembleShareFormats(agent, baseUrl);
        const callLink = buildCallLink(agent.slug, baseUrl);

        // The canonical Call_Link matches the slug + base construction.
        expect(formats.callLink).toBe(callLink);

        // Every link-bearing format embeds the Call_Link URL (Req 7.3).
        expect(formats.copyLink.url).toBe(callLink);
        expect(formats.qr.payload).toBe(callLink);
        expect(formats.sms.body).toContain(callLink);
        expect(formats.embedCard.html).toContain(callLink); // embeddable card (Req 7.4)

        // All three social share formats are present, correctly labelled, and
        // embed the Call_Link in both the caption and the callLink field.
        for (const platform of SOCIAL_PLATFORMS) {
          const social = formats[platform];
          expect(social.platform).toBe(platform);
          expect(social.callLink).toBe(callLink);
          expect(social.caption).toContain(callLink);
          expect(social.caption).toContain(AI_VOICE_AGENT_LABEL);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("produces the Share_Card in Instagram/TikTok/Snapchat formats, each containing name, campus tag, agent type, the AI voice agent label, and the Call_Link (Req 15.14)", () => {
    fc.assert(
      fc.property(shareAgentArb, baseUrlArb, (agent, baseUrl) => {
        const card = assembleShareCard(agent, baseUrl);
        const callLink = buildCallLink(agent.slug, baseUrl);

        // The Share_Card is produced in exactly the three social formats.
        expect(Object.keys(card).sort()).toEqual(
          [...SOCIAL_PLATFORMS].sort()
        );

        for (const platform of SOCIAL_PLATFORMS) {
          const variant = card[platform];
          // Correct platform tag.
          expect(variant.platform).toBe(platform);
          // Contains the agent name, Campus_Tag, and Agent_Type verbatim.
          expect(variant.agentName).toBe(agent.name);
          expect(variant.campusTag).toBe(agent.campusTag);
          expect(variant.agentType).toBe(agent.agentType);
          // Carries the visible "AI voice agent" label.
          expect(variant.label).toBe(AI_VOICE_AGENT_LABEL);
          // Embeds the Call_Link.
          expect(variant.callLink).toBe(callLink);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("keeps the Share_Card caption consistent with the social share formats (Req 7.3, 15.14)", () => {
    fc.assert(
      fc.property(shareAgentArb, baseUrlArb, (agent, baseUrl) => {
        const formats = assembleShareFormats(agent, baseUrl);
        const card = assembleShareCard(agent, baseUrl);

        // The Share_Card reuses the same social-format caption assembly, so the
        // caption for each platform matches its share-format counterpart.
        for (const platform of SOCIAL_PLATFORMS) {
          expect(card[platform].caption).toBe(formats[platform].caption);
        }
      }),
      { numRuns: 100 }
    );
  });
});
