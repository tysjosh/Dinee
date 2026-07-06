/**
 * Unit coverage for the typed platform-config builder/hydrator used by the
 * generic integration admin (per-platform config schema).
 *
 * Verifies coercion by type, dotted-path nesting, pruning of empty groups,
 * preservation of config keys the schema does not own, numeric validation, and
 * round-trip hydration.
 */

import { describe, it, expect } from "vitest";
import {
  buildTypedConfig,
  flattenTypedConfig,
  type PlatformConfigField,
} from "../../src/components/dashboard/platformIntegrationAdmin.logic";

// Mirrors the Runsheet config schema shape.
const FIELDS: PlatformConfigField[] = [
  {
    name: "defaultReviewMode",
    label: "Default review mode",
    type: "select",
    options: [
      { value: "always_review", label: "Always review" },
      { value: "auto_submit_low_risk", label: "Auto-submit low risk" },
    ],
  },
  { name: "autoSubmitEnabled", label: "Auto-submit", type: "boolean" },
  {
    name: "confidenceThreshold",
    label: "Confidence threshold",
    type: "number",
    min: 0,
    max: 1,
  },
  { name: "requiresPurchaseOrder", label: "Require PO", type: "boolean" },
  { name: "escalationTarget.kind", label: "Escalation type", type: "select" },
  { name: "escalationTarget.value", label: "Escalation value", type: "string" },
];

describe("buildTypedConfig", () => {
  it("coerces types and assembles nested dotted paths", () => {
    const result = buildTypedConfig(
      FIELDS,
      {
        defaultReviewMode: "auto_submit_low_risk",
        autoSubmitEnabled: "true",
        confidenceThreshold: "0.85",
        requiresPurchaseOrder: "false",
        "escalationTarget.kind": "phone",
        "escalationTarget.value": "+15551234567",
      },
      undefined
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({
      defaultReviewMode: "auto_submit_low_risk",
      autoSubmitEnabled: true,
      confidenceThreshold: 0.85,
      requiresPurchaseOrder: false,
      escalationTarget: { kind: "phone", value: "+15551234567" },
    });
  });

  it("skips empty optional values and prunes the empty escalation group", () => {
    const result = buildTypedConfig(
      FIELDS,
      {
        defaultReviewMode: "always_review",
        autoSubmitEnabled: "false",
        confidenceThreshold: "",
        requiresPurchaseOrder: "false",
        "escalationTarget.kind": "",
        "escalationTarget.value": "",
      },
      undefined
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({
      defaultReviewMode: "always_review",
      autoSubmitEnabled: false,
      requiresPurchaseOrder: false,
    });
    expect("escalationTarget" in result.config).toBe(false);
    expect("confidenceThreshold" in result.config).toBe(false);
  });

  it("rejects an out-of-range number and names the field", () => {
    const result = buildTypedConfig(
      FIELDS,
      { confidenceThreshold: "1.5", autoSubmitEnabled: "false", requiresPurchaseOrder: "false" },
      undefined
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.confidenceThreshold).toContain("≤ 1");
  });

  it("preserves existing config keys the schema does not own", () => {
    const result = buildTypedConfig(
      FIELDS,
      { autoSubmitEnabled: "false", requiresPurchaseOrder: "false" },
      { legacyFlag: "keep-me", defaultReviewMode: "stale" }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Unowned key preserved; schema-owned key rebuilt from the form (dropped).
    expect(result.config.legacyFlag).toBe("keep-me");
    expect("defaultReviewMode" in result.config).toBe(false);
  });
});

describe("flattenTypedConfig", () => {
  it("round-trips a built config back to string form values", () => {
    const config = {
      defaultReviewMode: "auto_submit_low_risk",
      autoSubmitEnabled: true,
      confidenceThreshold: 0.85,
      requiresPurchaseOrder: false,
      escalationTarget: { kind: "email", value: "ops@example.com" },
    };
    expect(flattenTypedConfig(FIELDS, config)).toEqual({
      defaultReviewMode: "auto_submit_low_risk",
      autoSubmitEnabled: "true",
      confidenceThreshold: "0.85",
      requiresPurchaseOrder: "false",
      "escalationTarget.kind": "email",
      "escalationTarget.value": "ops@example.com",
    });
  });

  it("represents missing values as empty strings and false booleans", () => {
    expect(flattenTypedConfig(FIELDS, undefined)).toEqual({
      defaultReviewMode: "",
      autoSubmitEnabled: "false",
      confidenceThreshold: "",
      requiresPurchaseOrder: "false",
      "escalationTarget.kind": "",
      "escalationTarget.value": "",
    });
  });
});
