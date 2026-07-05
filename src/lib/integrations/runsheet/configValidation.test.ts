import { describe, expect, it } from "vitest";
import type { EscalationTarget } from "@/lib/modules/voiceDomainPack";
import {
  applyEscalationTarget,
  isValidEmailValue,
  isValidPhoneValue,
  isValidWebhookValue,
  validateEscalationTarget,
} from "./configValidation";

describe("validateEscalationTarget", () => {
  it("accepts a valid E.164 phone target", () => {
    const result = validateEscalationTarget({ kind: "phone", value: "+2348012345678" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target).toEqual({ kind: "phone", value: "+2348012345678" });
    }
  });

  it("accepts a valid email target", () => {
    const result = validateEscalationTarget({ kind: "email", value: "dispatch@runsheet.io" });
    expect(result.ok).toBe(true);
  });

  it("accepts a valid https webhook target", () => {
    const result = validateEscalationTarget({
      kind: "webhook",
      value: "https://hooks.runsheet.io/escalate",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a plain http webhook target", () => {
    const result = validateEscalationTarget({
      kind: "webhook",
      value: "http://localhost:3000/escalate",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a phone value that is not E.164", () => {
    const result = validateEscalationTarget({ kind: "phone", value: "0801-234-5678" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_escalation_target");
      expect(result.error.invalidValue).toBe("0801-234-5678");
      expect(result.error.kind).toBe("phone");
    }
  });

  it("rejects a malformed email", () => {
    const result = validateEscalationTarget({ kind: "email", value: "not-an-email" });
    expect(result.ok).toBe(false);
  });

  it("rejects an email with consecutive dots", () => {
    const result = validateEscalationTarget({ kind: "email", value: "a..b@runsheet.io" });
    expect(result.ok).toBe(false);
  });

  it("rejects a webhook with a non-http protocol", () => {
    const result = validateEscalationTarget({ kind: "webhook", value: "ftp://runsheet.io/hook" });
    expect(result.ok).toBe(false);
  });

  it("rejects a webhook that is not a valid URL", () => {
    const result = validateEscalationTarget({ kind: "webhook", value: "not a url" });
    expect(result.ok).toBe(false);
  });

  it("rejects an unrecognized kind", () => {
    const result = validateEscalationTarget({ kind: "slack", value: "#alerts" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("slack");
    }
  });

  it("rejects an empty value", () => {
    const result = validateEscalationTarget({ kind: "phone", value: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects non-object input without throwing", () => {
    expect(validateEscalationTarget(null).ok).toBe(false);
    expect(validateEscalationTarget(undefined).ok).toBe(false);
    expect(validateEscalationTarget("+2348012345678").ok).toBe(false);
  });

  it("rejects a value that does not match its kind (email in a phone target)", () => {
    const result = validateEscalationTarget({ kind: "phone", value: "dispatch@runsheet.io" });
    expect(result.ok).toBe(false);
  });
});

describe("applyEscalationTarget", () => {
  const existing: EscalationTarget = { kind: "phone", value: "+15551234567" };

  it("adopts a valid candidate", () => {
    const candidate: EscalationTarget = { kind: "email", value: "ops@runsheet.io" };
    const result = applyEscalationTarget(existing, candidate);
    expect(result.accepted).toBe(true);
    expect(result.target).toEqual(candidate);
    expect(result.error).toBeUndefined();
  });

  it("leaves the existing target unchanged on an invalid candidate (Req 9.7)", () => {
    const result = applyEscalationTarget(existing, { kind: "phone", value: "555-1234" });
    expect(result.accepted).toBe(false);
    expect(result.target).toEqual(existing);
    expect(result.error?.code).toBe("invalid_escalation_target");
  });

  it("returns undefined (unchanged) when there is no existing target and the candidate is invalid", () => {
    const result = applyEscalationTarget(undefined, { kind: "webhook", value: "bad" });
    expect(result.accepted).toBe(false);
    expect(result.target).toBeUndefined();
  });
});

describe("value-level validators", () => {
  it("isValidPhoneValue enforces E.164", () => {
    expect(isValidPhoneValue("+2348012345678")).toBe(true);
    expect(isValidPhoneValue("+0123456789")).toBe(false); // leading zero
    expect(isValidPhoneValue("2348012345678")).toBe(false); // missing +
  });

  it("isValidEmailValue accepts basic addresses", () => {
    expect(isValidEmailValue("a@b.co")).toBe(true);
    expect(isValidEmailValue("a@b")).toBe(false);
  });

  it("isValidWebhookValue requires http(s) and a host", () => {
    expect(isValidWebhookValue("https://runsheet.io/hook")).toBe(true);
    expect(isValidWebhookValue("https://")).toBe(false);
  });
});
