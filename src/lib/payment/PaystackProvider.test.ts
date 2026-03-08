/**
 * Unit tests for PaystackProvider constructor error handling and test mode detection.
 *
 * Validates: Requirements 8.2, 8.3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PaystackProvider, createPaystackProvider } from "./PaystackProvider";

describe("PaystackProvider constructor", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("throws a descriptive error when secretKey is empty", () => {
    expect(() => new PaystackProvider({ secretKey: "" })).toThrow(
      "PaystackProvider: secretKey is required"
    );
  });

  it("throws a descriptive error when secretKey has invalid format", () => {
    expect(() => new PaystackProvider({ secretKey: "bad_key_123" })).toThrow(
      "PaystackProvider: secretKey has an invalid format"
    );
  });

  it("auto-detects test mode from sk_test_ prefix", () => {
    const provider = new PaystackProvider({ secretKey: "sk_test_abc123" });
    expect(provider.isTestMode()).toBe(true);
  });

  it("auto-detects live mode from sk_live_ prefix", () => {
    const provider = new PaystackProvider({ secretKey: "sk_live_abc123" });
    expect(provider.isTestMode()).toBe(false);
  });

  it("logs a warning when running in test mode", () => {
    new PaystackProvider({ secretKey: "sk_test_abc123" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("TEST mode")
    );
  });

  it("does not log a warning when running in live mode", () => {
    new PaystackProvider({ secretKey: "sk_live_abc123" });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("allows explicit testMode override", () => {
    const provider = new PaystackProvider({
      secretKey: "sk_live_abc123",
      testMode: true,
    });
    expect(provider.isTestMode()).toBe(true);
  });
});

describe("createPaystackProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("throws when PAYSTACK_SECRET_KEY is missing", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_PUBLIC_KEY = "pk_test_abc";

    expect(() => createPaystackProvider()).toThrow("PAYSTACK_SECRET_KEY");
  });

  it("throws when PAYSTACK_PUBLIC_KEY is missing", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_abc123";
    delete process.env.PAYSTACK_PUBLIC_KEY;

    expect(() => createPaystackProvider()).toThrow("PAYSTACK_PUBLIC_KEY");
  });

  it("throws listing both vars when both are missing", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_PUBLIC_KEY;

    expect(() => createPaystackProvider()).toThrow("PAYSTACK_SECRET_KEY");
    try {
      createPaystackProvider();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("PAYSTACK_SECRET_KEY");
      expect(msg).toContain("PAYSTACK_PUBLIC_KEY");
    }
  });

  it("creates provider successfully when both env vars are set", () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_abc123";
    process.env.PAYSTACK_PUBLIC_KEY = "pk_test_abc123";

    const provider = createPaystackProvider();
    expect(provider).toBeInstanceOf(PaystackProvider);
    expect(provider.isTestMode()).toBe(true);
  });
});
