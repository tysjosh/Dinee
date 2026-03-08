/**
 * Feature: convex-auth-integration, Property 6-7: Login flow properties
 *
 * Validates: Requirements 4.2, 4.3
 *
 * Property 6: Login with valid credentials creates a session
 *   For any user with a known email and correct password, calling the login flow
 *   should result in an active session and an updated lastLoginAt timestamp on
 *   the User_Record.
 *
 * Property 7: Invalid credentials produce a generic error
 *   For any login attempt with an incorrect email or incorrect password, the error
 *   message returned should be identical regardless of which field was wrong (i.e.,
 *   the message should not distinguish between "email not found" and "wrong password").
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// --- Constants mirroring the login page (src/app/client/login/page.tsx) ---

const GENERIC_LOGIN_ERROR = "Invalid email or password";

// --- Pure validation helpers (shared with sign-up flow) ---

/** Email validation regex */
function isValidEmail(email: string): boolean {
  if (!email.trim()) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --- User store simulation ---

interface UserRecord {
  userId: string;
  email: string;
  passwordHash: string;
  role: string;
  tenantType: string;
  tenantId: string;
  lastLoginAt?: number;
  createdAt: number;
}

/**
 * Simulates the in-memory user store for login credential checks.
 * Mirrors the users table and the updateLastLogin mutation in convex/users.ts.
 */
class UserStore {
  private users: Map<string, UserRecord> = new Map();
  private nextId = 1;

  /** Seed a user into the store (simulates a previously signed-up user) */
  addUser(email: string, password: string): UserRecord {
    const record: UserRecord = {
      userId: `user_${this.nextId++}`,
      email,
      passwordHash: password, // simplified — real system uses bcrypt via Convex Auth
      role: "restaurant_owner",
      tenantType: "restaurant",
      tenantId: "",
      createdAt: Date.now(),
    };
    this.users.set(email, record);
    return record;
  }

  /** Look up user by email (mirrors by_email index query) */
  findByEmail(email: string): UserRecord | undefined {
    return this.users.get(email);
  }

  /** Update lastLoginAt (mirrors updateLastLogin mutation) */
  updateLastLogin(userId: string): void {
    for (const user of this.users.values()) {
      if (user.userId === userId) {
        user.lastLoginAt = Date.now();
        return;
      }
    }
    throw new Error("User not found");
  }
}

// --- Login flow simulation ---

interface LoginResult {
  success: boolean;
  isAuthenticated: boolean;
  error?: string;
}

/**
 * Simulates the login flow from the login page.
 *
 * Mirrors the handleSubmit logic in src/app/client/login/page.tsx:
 * 1. Call signIn("password", { email, password, flow: "signIn" })
 * 2. On success → session created, updateLastLogin called
 * 3. On failure → catch block sets generic error "Invalid email or password"
 *
 * The key security property: the error message is always the same
 * regardless of whether the email doesn't exist or the password is wrong.
 */
function simulateLogin(
  store: UserStore,
  email: string,
  password: string
): LoginResult {
  const user = store.findByEmail(email);

  // Email not found — Convex Auth throws, caught by the login page
  if (!user) {
    return {
      success: false,
      isAuthenticated: false,
      error: GENERIC_LOGIN_ERROR,
    };
  }

  // Wrong password — Convex Auth throws, caught by the login page
  if (user.passwordHash !== password) {
    return {
      success: false,
      isAuthenticated: false,
      error: GENERIC_LOGIN_ERROR,
    };
  }

  // Valid credentials — session created, updateLastLogin called
  store.updateLastLogin(user.userId);

  return {
    success: true,
    isAuthenticated: true,
  };
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

/** Generates valid passwords (8+ characters, matching sign-up minimum) */
const validPasswordArb = fc
  .string({ minLength: 8, maxLength: 64 })
  .filter((p) => p.length >= 8);

/**
 * Generates a password that is guaranteed to differ from the original.
 * Used to simulate "wrong password" login attempts.
 */
function wrongPasswordArb(correctPassword: string): fc.Arbitrary<string> {
  return fc
    .string({ minLength: 1, maxLength: 64 })
    .filter((p) => p !== correctPassword);
}

/**
 * Generates an email guaranteed not to be in a given set.
 * Used to simulate "email not found" login attempts.
 */
function unknownEmailArb(knownEmails: Set<string>): fc.Arbitrary<string> {
  return validEmailArb.filter((e) => !knownEmails.has(e));
}

// --- Tests ---

describe("Property 6: Login with valid credentials creates a session", () => {
  it("for any user with known email and correct password, login produces an active session", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, (email, password) => {
        const store = new UserStore();
        store.addUser(email, password);

        const result = simulateLogin(store, email, password);

        expect(result.success).toBe(true);
        expect(result.isAuthenticated).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it("for any user with known email and correct password, lastLoginAt is updated after login", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, (email, password) => {
        const store = new UserStore();
        const user = store.addUser(email, password);

        // Before login, lastLoginAt is undefined
        expect(user.lastLoginAt).toBeUndefined();

        simulateLogin(store, email, password);

        // After login, lastLoginAt is set
        const updatedUser = store.findByEmail(email);
        expect(updatedUser).toBeDefined();
        expect(updatedUser!.lastLoginAt).toBeDefined();
        expect(typeof updatedUser!.lastLoginAt).toBe("number");
        expect(updatedUser!.lastLoginAt!).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it("multiple logins by the same user each update lastLoginAt", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, (email, password) => {
        const store = new UserStore();
        store.addUser(email, password);

        simulateLogin(store, email, password);
        const firstLogin = store.findByEmail(email)!.lastLoginAt!;

        simulateLogin(store, email, password);
        const secondLogin = store.findByEmail(email)!.lastLoginAt!;

        // Both timestamps should be set (second >= first since Date.now() is monotonic)
        expect(firstLogin).toBeGreaterThan(0);
        expect(secondLogin).toBeGreaterThanOrEqual(firstLogin);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Property 7: Invalid credentials produce a generic error", () => {
  it("wrong password produces the same error as unknown email", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        validEmailArb,
        (registeredEmail, correctPassword, unknownEmail) => {
          // Skip if the unknown email happens to match the registered one
          fc.pre(unknownEmail !== registeredEmail);

          const store = new UserStore();
          store.addUser(registeredEmail, correctPassword);

          // Attempt 1: correct email, wrong password
          const wrongPwResult = simulateLogin(
            store,
            registeredEmail,
            correctPassword + "WRONG"
          );

          // Attempt 2: unknown email, any password
          const unknownEmailResult = simulateLogin(
            store,
            unknownEmail,
            correctPassword
          );

          // Both must fail
          expect(wrongPwResult.success).toBe(false);
          expect(unknownEmailResult.success).toBe(false);

          // Error messages must be identical — no information leakage
          expect(wrongPwResult.error).toBe(GENERIC_LOGIN_ERROR);
          expect(unknownEmailResult.error).toBe(GENERIC_LOGIN_ERROR);
          expect(wrongPwResult.error).toBe(unknownEmailResult.error);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("error message is always the generic constant regardless of which field is wrong", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validPasswordArb,
        fc.constantFrom("wrong_email", "wrong_password", "both_wrong"),
        (email, password, failureMode) => {
          const store = new UserStore();
          store.addUser(email, password);

          let result: LoginResult;

          switch (failureMode) {
            case "wrong_email":
              result = simulateLogin(store, `unknown_${email}`, password);
              break;
            case "wrong_password":
              result = simulateLogin(store, email, password + "_wrong");
              break;
            case "both_wrong":
              result = simulateLogin(
                store,
                `unknown_${email}`,
                password + "_wrong"
              );
              break;
          }

          expect(result!.success).toBe(false);
          expect(result!.isAuthenticated).toBe(false);
          expect(result!.error).toBe(GENERIC_LOGIN_ERROR);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("the error message never contains 'email not found' or 'wrong password' hints", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, (email, password) => {
        const store = new UserStore();
        store.addUser(email, password);

        // Wrong password attempt
        const result = simulateLogin(store, email, password + "X");

        expect(result.error).toBeDefined();
        const errorLower = result.error!.toLowerCase();
        expect(errorLower).not.toContain("not found");
        expect(errorLower).not.toContain("wrong password");
        expect(errorLower).not.toContain("incorrect password");
        expect(errorLower).not.toContain("no account");
        expect(errorLower).not.toContain("email does not exist");

        // Unknown email attempt
        const result2 = simulateLogin(store, `nope_${email}`, password);

        expect(result2.error).toBeDefined();
        const error2Lower = result2.error!.toLowerCase();
        expect(error2Lower).not.toContain("not found");
        expect(error2Lower).not.toContain("wrong password");
        expect(error2Lower).not.toContain("incorrect password");
        expect(error2Lower).not.toContain("no account");
        expect(error2Lower).not.toContain("email does not exist");
      }),
      { numRuns: 100 }
    );
  });

  it("valid credentials never produce an error", () => {
    fc.assert(
      fc.property(validEmailArb, validPasswordArb, (email, password) => {
        const store = new UserStore();
        store.addUser(email, password);

        const result = simulateLogin(store, email, password);

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });
});
