/**
 * Feature: dinee-voice-platform, Task 8.3 — shared cross-language HMAC/canonicalization vectors.
 *
 * Validates: Requirements 11.7
 *
 * The Dinee-side runner for the shared fixture `__tests__/fixtures/intakeVectors.json`.
 * Each vector fixes `payload → canonical bytes → expected signature` under a fixed known
 * secret. This test proves the Dinee TypeScript client (canonicalizeIntake/signIntake)
 * reproduces the fixture exactly; the Runsheet Python Voice_Intake_Adapter runs the SAME
 * fixture, so identical signature inputs prove TypeScript signing matches Python verification.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  canonicalizeIntake,
  signIntake,
  type VoiceIntakePayload,
} from "../../src/lib/integrations/runsheet/voiceIntakeClient";

interface IntakeVector {
  name: string;
  description: string;
  secret: string;
  payload: VoiceIntakePayload;
  canonical: string;
  signature: string;
}

interface IntakeVectorFixture {
  canonicalization: {
    method: string;
    signature: { algorithm: string; encoding: string };
  };
  vectors: IntakeVector[];
}

const fixture: IntakeVectorFixture = JSON.parse(
  readFileSync(
    path.join(__dirname, "..", "fixtures", "intakeVectors.json"),
    "utf8"
  )
);

describe("Shared cross-language intake test vectors (Req 11.7)", () => {
  it("fixture is present and non-empty", () => {
    expect(fixture.vectors.length).toBeGreaterThan(0);
    expect(fixture.canonicalization.signature.algorithm).toBe("HMAC-SHA256");
  });

  for (const vector of fixture.vectors) {
    describe(`vector: ${vector.name}`, () => {
      it("canonicalizeIntake reproduces the fixture canonical bytes", () => {
        expect(canonicalizeIntake(vector.payload)).toBe(vector.canonical);
      });

      it("signIntake reproduces the fixture signature", () => {
        expect(signIntake(vector.canonical, vector.secret)).toBe(
          vector.signature
        );
      });

      it("payload → canonical → signature is byte-reproducible end to end", () => {
        const canonical = canonicalizeIntake(vector.payload);
        expect(signIntake(canonical, vector.secret)).toBe(vector.signature);
      });

      it("signature is lowercase 64-char hex (HMAC-SHA256)", () => {
        expect(vector.signature).toMatch(/^[0-9a-f]{64}$/);
      });
    });
  }
});
