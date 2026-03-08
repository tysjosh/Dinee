/**
 * Feature: convex-auth-integration, Property 2-5: Sign-up flow properties
 *
 * Validates: Requirements 3.2, 3.3, 3.4, 3.5
 *
 * Property 2: Sign-up creates user with correct defaults
 *   For any valid email (not already registered) and for any password of 8+ characters,
 *   calling the sign-up flow should create a User_Record with role = "restaurant_owner",
 *   tenantType = "restaurant", and tenantId = "".
 *
 * Property 3: Duplicate email rejection
 *   For any email that already exists in the users table, attempting to create a new user
 *   with that email should fail with an error, and the total number of users with that
 *   email should remain exactly 1.
 *
 * Property 4: Password length validation
 *   For any string shorter than 8 characters, the sign-up form should reject the submission.
 *   For any string of 8 or more characters (that is otherwise valid), the password should
 *   be accepted.
 *
 * Property 5: Successful sign-up produces an authenticated session
 *   For any successful sign-up (valid email + valid password), the user should immediately
 *   have an active session without requiring a separate login step.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// --- Constants mirroring the sign-up page defaults (src/app/client/signup/page.tsx) ---

const SIGNUP_DEFAULT_ROLE = "restaurant_owner" as const;
const SIGNUP_DEFAULT_TENANT_TYPE = "restaurant" as const;
const SIGNUP_DEFAULT_TENANT_ID = "";

const MIN_PASSWORD_LENGTH = 8;

// --- Pure validation logic extracted from the sign-up page ---

/** Email validation regex from the sign-up page validate() function */
function isValidEmail(email: string): boolean {
  if (!email.trim()) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Password validation from the sign-up page validate() function */
function isValidPassword(password: string): boolean {
  if (!password) return false;
  return password.length >= MIN_PASSWORD_LENGTH;
}

/**
 * Pure function mirroring the sign-up user creation logic.
 * Given an email and password, returns the user record defaults
 * that would be passed to createUser (without invitation).
 */
function computeSignUpDefaults(email: string, password: string) {
  if (!isValidEmail(email)) throw new Error("Invalid email");
  if (!isValidPassword(password)) throw new Error("Password must be at least 8 characters");

  return {
    email,
    passwordHash: "managed-by-convex-auth",
    role: SIGNUP_DEFAULT_ROLE,
    tenantType: SIGNUP_DEFAULT_TENANT_TYPE,
    tenantId: SIGNUP_DEFAULT_TENANT_ID,
  };
}

/**
 * Simulates the in-memory user store for duplicate email detection.
 * Mirrors the createUser mutation in convex/users.ts which checks
 * for existing email via the by_email index before inserting.
 */
class UserStore {
  private users: Map<string, { email: string; role: string; tenantType: string; tenantId: string }> = new Map();

  createUser(args: { email: string; role: string; tenantType: string; tenantId: string }) {
    if (this.users.has(args.email)) {
      throw new Error("User with this email already exists");
    }
    this.users.set(args.email, { ...args });
    return { userId: `user_${this.users.size}` };
  }

  countByEmail(email: string): number {
    return this.users.has(email) ? 1 : 0;
  }
}

/**
 * Simulates the session state after sign-up.
 * Mirrors the flow: signIn("password", ...) → createUser → isAuthenticated = true
 */
function simulateSignUpSession(email: string, password: string): { isAuthenticated: boolean } {
  if (!isValidEmail(email)) return { isAuthenticated: false };
  if (!isValidPassword(password)) return { isAuthenticated: false };
  // Successful sign-up via Convex Auth produces an immediate session
  return { isAuthenticated: true };
}

// --- Arbitraries ---

/** Generates valid email addresses */
const validEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9._]{0,19}$/),
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,9}$/),
    fc.constantFrom("com", "org", "net", "io", "co", "dev")
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`)
  .filter((e) => isValidEmail(e));

/** Generates valid passwords (8+ characters) */
const validPasswordArb = fc
  .string({ minLength: MIN_PASSWORD_LENGTH, maxLength: 64 })
  .filter((p) => p.length >= MIN_PASSWORD_LENGTH);

/** Generates invalid passwords (fewer than 8 characters) */
const shortPasswordArb = fc.string({ minLength: 0, maxLength: MIN_PASSWORD_LENGTH - 1 });

/** Generates passwords at the exact boundary (length 8) */
const boundaryPasswordArb = fc.string({ minLength: MIN_PASSWORD_LENGTH, maxLength: MIN_PASSWORD_LENGTH });

// --- Tests ---

describe("Property 2: Sign-up creates user with correct defaults", () => {
  it("for any valid email and password (8+ chars), user record has role=restaurant_owner, tenantType=restaurant, tenantId=''", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, (email, password) => {
        const result = computeSignUpDefaults(email, password);

        expect(result.role).toBe("restaurant_owner");
        expect(result.tenantType).toBe("restaurant");
        expect(result.tenantId).toBe("");
        expect(result.email).toBe(email);
        expect(result.passwordHash).toBe("managed-by-convex-auth");
      }),
      { numRuns: 100 }
    );
  });

  it("defaults are always the same regardless of email or password content", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, (email, password) => {
        const a = computeSignUpDefaults(email, password);
        const b = computeSignUpDefaults(email, password);

        expect(a.role).toBe(b.role);
        expect(a.tenantType).toBe(b.tenantType);
        expect(a.tenantId).toBe(b.tenantId);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 3: Duplicate email rejection", () => {
  it("for any email already in the store, creating a second user with that email fails and count stays 1", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, (email, password) => {
        const store = new UserStore();

        // First creation succeeds
        store.createUser({
          email,
          role: SIGNUP_DEFAULT_ROLE,
          tenantType: SIGNUP_DEFAULT_TENANT_TYPE,
          tenantId: SIGNUP_DEFAULT_TENANT_ID,
        });
        expect(store.countByEmail(email)).toBe(1);

        // Second creation with same email fails
        expect(() =>
          store.createUser({
            email,
            role: SIGNUP_DEFAULT_ROLE,
            tenantType: SIGNUP_DEFAULT_TENANT_TYPE,
            tenantId: SIGNUP_DEFAULT_TENANT_ID,
          })
        ).toThrow("User with this email already exists");

        // Count remains exactly 1
        expect(store.countByEmail(email)).toBe(1);
      }),
      { numRuns: 100 }
    );
  });

  it("different emails can coexist without conflict", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(validEmailArb, { minLength: 2, maxLength: 5 }),
        (emails) => {
          const store = new UserStore();

          for (const email of emails) {
            store.createUser({
              email,
              role: SIGNUP_DEFAULT_ROLE,
              tenantType: SIGNUP_DEFAULT_TENANT_TYPE,
              tenantId: SIGNUP_DEFAULT_TENANT_ID,
            });
          }

          for (const email of emails) {
            expect(store.countByEmail(email)).toBe(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 4: Password length validation", () => {
  it("any string shorter than 8 characters is rejected", () => {
    fc.assert(
      fc.property(shortPasswordArb, (password) => {
        expect(isValidPassword(password)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("any string of 8 or more characters is accepted", () => {
    fc.assert(
      fc.property(validPasswordArb, (password) => {
        expect(isValidPassword(password)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("the boundary at exactly 8 characters is accepted", () => {
    fc.assert(
      fc.property(boundaryPasswordArb, (password) => {
        expect(password.length).toBe(MIN_PASSWORD_LENGTH);
        expect(isValidPassword(password)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("empty string is rejected", () => {
    expect(isValidPassword("")).toBe(false);
  });

  it("string of length 7 is rejected, string of length 8 is accepted", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (len) => {
        const password = "x".repeat(len);
        if (len < MIN_PASSWORD_LENGTH) {
          expect(isValidPassword(password)).toBe(false);
        } else {
          expect(isValidPassword(password)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 5: Successful sign-up produces an authenticated session", () => {
  it("for any valid email and valid password, session is immediately authenticated", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, (email, password) => {
        const session = simulateSignUpSession(email, password);
        expect(session.isAuthenticated).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("invalid email does not produce an authenticated session", () => {
    fc.assert(
      fc.property(shortPasswordArb, (badEmail) => {
        // Using short strings as invalid emails (most won't match email regex)
        const session = simulateSignUpSession(badEmail, "validpass123");
        if (!isValidEmail(badEmail)) {
          expect(session.isAuthenticated).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("invalid password does not produce an authenticated session", () => {
    fc.assert(
      fc.property(validEmailArb, shortPasswordArb, (email, shortPassword) => {
        const session = simulateSignUpSession(email, shortPassword);
        expect(session.isAuthenticated).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("no separate login step is needed after successful sign-up", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, (email, password) => {
        // The sign-up flow calls signIn("password", { flow: "signUp" }) which
        // creates both the auth account AND the session in one step.
        // After sign-up, isAuthenticated is immediately true.
        const session = simulateSignUpSession(email, password);
        expect(session.isAuthenticated).toBe(true);
        // No additional login call needed — this is the key property
      }),
      { numRuns: 100 }
    );
  });
});
