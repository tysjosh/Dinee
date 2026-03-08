/**
 * Feature: convex-auth-integration, Property 15-17: Invitation system properties
 *
 * Validates: Requirements 9.3, 9.5, 9.7, 9.8
 *
 * Property 15: Invitation creation by authorized owner
 *   For any user with role restaurant_owner, creating an invitation should produce
 *   an Invitation record with the correct email, role, tenantId (matching the
 *   owner's), and a unique inviteToken. For any user with a role other than
 *   restaurant_owner, creating an invitation should fail.
 *
 * Property 16: Invitation sign-up assigns correct role and tenant
 *   For any valid (non-expired, non-used) invitation token, signing up via that
 *   token should create a User_Record with the role and tenantId specified in the
 *   Invitation record, rather than the default restaurant_owner role.
 *
 * Property 17: Invitation token expiry
 *   For any invitation, if more than 7 days have elapsed since creation, the
 *   invitation token should be rejected when used for sign-up.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// --- Constants mirroring convex/invitations.ts ---

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Roles that can be assigned via invitation */
const INVITATION_ROLES = ["branch_manager", "supervisor"] as const;
type InvitationRole = (typeof INVITATION_ROLES)[number];

/** All user roles defined in the schema */
const ALL_ROLES = [
  "platform_admin",
  "restaurant_owner",
  "business_owner",
  "branch_manager",
  "supervisor",
] as const;
type UserRole = (typeof ALL_ROLES)[number];

/** Roles that are NOT restaurant_owner — should be denied invitation creation */
const NON_OWNER_ROLES = ALL_ROLES.filter((r) => r !== "restaurant_owner");

// --- Sign-up defaults (from src/app/client/signup/page.tsx) ---

const SIGNUP_DEFAULT_ROLE = "restaurant_owner" as const;
const SIGNUP_DEFAULT_TENANT_TYPE = "restaurant" as const;
const SIGNUP_DEFAULT_TENANT_ID = "";

// --- Token generation mirroring convex/invitations.ts ---

/**
 * Generate a unique invite token (64 hex chars).
 * Mirrors generateInviteToken() in convex/invitations.ts.
 */
function generateInviteToken(): string {
  const chars = "abcdef0123456789";
  let token = "";
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}


// --- Simulated stores ---

interface UserRecord {
  userId: string;
  email: string;
  role: UserRole;
  tenantType: string;
  tenantId: string;
}

interface InvitationRecord {
  email: string;
  role: InvitationRole;
  tenantId: string;
  invitedBy: string;
  inviteToken: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  createdAt: number;
  expiresAt: number;
  acceptedAt?: number;
}

/**
 * Simulates the invitation system, mirroring the Convex DB operations
 * in convex/invitations.ts and the sign-up flow in src/app/client/signup/page.tsx.
 */
class InvitationStore {
  private users: Map<string, UserRecord> = new Map();
  private invitations: Map<string, InvitationRecord> = new Map();
  private tokenSet: Set<string> = new Set();
  private nextUserId = 1;
  private currentTime: number;

  constructor(initialTime: number = Date.now()) {
    this.currentTime = initialTime;
  }

  advanceTime(ms: number): void {
    this.currentTime += ms;
  }

  setTime(time: number): void {
    this.currentTime = time;
  }

  now(): number {
    return this.currentTime;
  }

  /** Seed a user into the store */
  addUser(email: string, role: UserRole, tenantId: string): UserRecord {
    const normalizedEmail = email.toLowerCase().trim();
    const record: UserRecord = {
      userId: `user_${this.nextUserId++}`,
      email: normalizedEmail,
      role,
      tenantType: role === "platform_admin" ? "platform" : "restaurant",
      tenantId,
    };
    this.users.set(normalizedEmail, record);
    return record;
  }

  findUserByUserId(userId: string): UserRecord | undefined {
    for (const user of this.users.values()) {
      if (user.userId === userId) return user;
    }
    return undefined;
  }

  findUserByEmail(email: string): UserRecord | undefined {
    return this.users.get(email.toLowerCase().trim());
  }

  /**
   * Create an invitation.
   * Mirrors createInvitation mutation in convex/invitations.ts.
   * Enforces that the caller has restaurant_owner role.
   */
  createInvitation(args: {
    email: string;
    role: InvitationRole;
    tenantId: string;
    invitedBy: string;
  }): { inviteToken: string } {
    const caller = this.findUserByUserId(args.invitedBy);

    if (!caller) {
      throw new Error("Inviting user not found");
    }

    if (caller.role !== "restaurant_owner") {
      throw new Error("Only restaurant owners can create invitations");
    }

    const inviteToken = generateInviteToken();
    const now = this.currentTime;

    const record: InvitationRecord = {
      email: args.email.toLowerCase().trim(),
      role: args.role,
      tenantId: args.tenantId,
      invitedBy: args.invitedBy,
      inviteToken,
      status: "pending",
      createdAt: now,
      expiresAt: now + SEVEN_DAYS_MS,
    };

    this.invitations.set(inviteToken, record);
    this.tokenSet.add(inviteToken);

    return { inviteToken };
  }

  /**
   * Look up an invitation by token and check validity.
   * Mirrors getInvitationByToken query in convex/invitations.ts.
   */
  getInvitationByToken(
    inviteToken: string
  ): (InvitationRecord & { isExpired: boolean; isValid: boolean }) | null {
    const invitation = this.invitations.get(inviteToken);
    if (!invitation) return null;

    const isExpired = invitation.expiresAt < this.currentTime;
    const isValid = invitation.status === "pending" && !isExpired;

    return { ...invitation, isExpired, isValid };
  }

  /**
   * Sign up via an invitation token.
   * Mirrors the sign-up page logic when ?invite={token} is present:
   * - Validates the token (not expired, not used)
   * - Creates a user with the invitation's role and tenantId
   * - Marks the invitation as accepted
   *
   * Without a token, creates a user with default role/tenantId.
   */
  signUpWithInvitation(
    email: string,
    inviteToken: string
  ): { success: boolean; user?: UserRecord; error?: string } {
    const invitation = this.getInvitationByToken(inviteToken);

    if (!invitation) {
      return { success: false, error: "Invitation not found" };
    }

    if (!invitation.isValid) {
      if (invitation.isExpired) {
        return { success: false, error: "Invitation has expired" };
      }
      return {
        success: false,
        error: `Invitation has already been ${invitation.status}`,
      };
    }

    // Create user with invitation's role and tenantId
    const user = this.addUser(email, invitation.role as UserRole, invitation.tenantId);

    // Mark invitation as accepted
    const record = this.invitations.get(inviteToken)!;
    record.status = "accepted";
    record.acceptedAt = this.currentTime;

    return { success: true, user };
  }

  /**
   * Sign up without an invitation (default flow).
   */
  signUpDefault(email: string): UserRecord {
    return this.addUser(email, SIGNUP_DEFAULT_ROLE, SIGNUP_DEFAULT_TENANT_ID);
  }

  /** Check if a token is unique across all invitations */
  isTokenUnique(token: string): boolean {
    return this.tokenSet.has(token);
  }

  /** Get the total number of unique tokens generated */
  get tokenCount(): number {
    return this.tokenSet.size;
  }
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
  .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

/** Generates a valid invitation role */
const invitationRoleArb = fc.constantFrom<InvitationRole>(
  ...INVITATION_ROLES
);

/** Generates a non-owner role (should be denied invitation creation) */
const nonOwnerRoleArb = fc.constantFrom<UserRole>(
  ...(NON_OWNER_ROLES as UserRole[])
);

/** Generates a 5-digit restaurant ID (matching the schema pattern) */
const tenantIdArb = fc.stringMatching(/^[0-9]{5}$/);

/** Generates a time offset strictly greater than 7 days (expired) */
const expiredOffsetArb = fc.integer({
  min: SEVEN_DAYS_MS + 1,
  max: SEVEN_DAYS_MS * 4, // up to 28 days past
});

/** Generates a time offset within the 7-day window (valid) */
const validOffsetArb = fc.integer({
  min: 0,
  max: SEVEN_DAYS_MS - 1,
});

// --- Tests ---

describe("Property 15: Invitation creation by authorized owner", () => {
  it("for any restaurant_owner, creating an invitation produces a record with correct email, role, tenantId, and unique token", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        invitationRoleArb,
        tenantIdArb,
        (ownerEmail, inviteeEmail, inviteeRole, tenantId) => {
          const store = new InvitationStore();
          const owner = store.addUser(ownerEmail, "restaurant_owner", tenantId);

          const { inviteToken } = store.createInvitation({
            email: inviteeEmail,
            role: inviteeRole,
            tenantId: owner.tenantId,
            invitedBy: owner.userId,
          });

          const invitation = store.getInvitationByToken(inviteToken);
          expect(invitation).not.toBeNull();
          expect(invitation!.email).toBe(inviteeEmail.toLowerCase().trim());
          expect(invitation!.role).toBe(inviteeRole);
          expect(invitation!.tenantId).toBe(tenantId);
          expect(invitation!.inviteToken).toBe(inviteToken);
          expect(invitation!.status).toBe("pending");
          expect(invitation!.inviteToken.length).toBe(64);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any user with a role other than restaurant_owner, creating an invitation fails", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        nonOwnerRoleArb,
        invitationRoleArb,
        tenantIdArb,
        (callerEmail, inviteeEmail, callerRole, inviteeRole, tenantId) => {
          const store = new InvitationStore();
          const caller = store.addUser(callerEmail, callerRole, tenantId);

          expect(() =>
            store.createInvitation({
              email: inviteeEmail,
              role: inviteeRole,
              tenantId: caller.tenantId,
              invitedBy: caller.userId,
            })
          ).toThrow("Only restaurant owners can create invitations");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("each invitation gets a unique inviteToken", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        tenantIdArb,
        fc.array(
          fc.tuple(validEmailArb, invitationRoleArb),
          { minLength: 2, maxLength: 10 }
        ),
        (ownerEmail, tenantId, invitees) => {
          const store = new InvitationStore();
          const owner = store.addUser(ownerEmail, "restaurant_owner", tenantId);

          const tokens = new Set<string>();
          for (const [email, role] of invitees) {
            const { inviteToken } = store.createInvitation({
              email,
              role,
              tenantId: owner.tenantId,
              invitedBy: owner.userId,
            });
            tokens.add(inviteToken);
          }

          // All tokens should be unique
          expect(tokens.size).toBe(invitees.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("invitation tenantId always matches the owner's tenantId", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        invitationRoleArb,
        tenantIdArb,
        (ownerEmail, inviteeEmail, inviteeRole, tenantId) => {
          const store = new InvitationStore();
          const owner = store.addUser(ownerEmail, "restaurant_owner", tenantId);

          const { inviteToken } = store.createInvitation({
            email: inviteeEmail,
            role: inviteeRole,
            tenantId: owner.tenantId,
            invitedBy: owner.userId,
          });

          const invitation = store.getInvitationByToken(inviteToken);
          expect(invitation!.tenantId).toBe(owner.tenantId);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 16: Invitation sign-up assigns correct role and tenant", () => {
  it("for any valid invitation, signing up via token creates a user with the invitation's role and tenantId", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        invitationRoleArb,
        tenantIdArb,
        (ownerEmail, inviteeEmail, inviteeRole, tenantId) => {
          const store = new InvitationStore();
          const owner = store.addUser(ownerEmail, "restaurant_owner", tenantId);

          const { inviteToken } = store.createInvitation({
            email: inviteeEmail,
            role: inviteeRole,
            tenantId: owner.tenantId,
            invitedBy: owner.userId,
          });

          const result = store.signUpWithInvitation(inviteeEmail, inviteToken);

          expect(result.success).toBe(true);
          expect(result.user).toBeDefined();
          expect(result.user!.role).toBe(inviteeRole);
          expect(result.user!.tenantId).toBe(tenantId);
          // Should NOT be the default restaurant_owner role
          expect(result.user!.role).not.toBe(SIGNUP_DEFAULT_ROLE);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("signing up without an invitation creates a user with default role and empty tenantId", () => {
    fc.assert(
      fc.property(validEmailArb, (email) => {
        const store = new InvitationStore();
        const user = store.signUpDefault(email);

        expect(user.role).toBe(SIGNUP_DEFAULT_ROLE);
        expect(user.tenantId).toBe(SIGNUP_DEFAULT_TENANT_ID);
      }),
      { numRuns: 100 }
    );
  });

  it("invitation role overrides the default — branch_manager and supervisor are both correctly assigned", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        invitationRoleArb,
        tenantIdArb,
        (ownerEmail, inviteeEmail, assignedRole, tenantId) => {
          const store = new InvitationStore();
          const owner = store.addUser(ownerEmail, "restaurant_owner", tenantId);

          const { inviteToken } = store.createInvitation({
            email: inviteeEmail,
            role: assignedRole,
            tenantId: owner.tenantId,
            invitedBy: owner.userId,
          });

          const result = store.signUpWithInvitation(inviteeEmail, inviteToken);
          expect(result.success).toBe(true);

          // The user's role matches exactly what the invitation specified
          expect(result.user!.role).toBe(assignedRole);
          expect(INVITATION_ROLES).toContain(result.user!.role);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("after sign-up via invitation, the invitation status is 'accepted'", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        invitationRoleArb,
        tenantIdArb,
        (ownerEmail, inviteeEmail, inviteeRole, tenantId) => {
          const store = new InvitationStore();
          const owner = store.addUser(ownerEmail, "restaurant_owner", tenantId);

          const { inviteToken } = store.createInvitation({
            email: inviteeEmail,
            role: inviteeRole,
            tenantId: owner.tenantId,
            invitedBy: owner.userId,
          });

          store.signUpWithInvitation(inviteeEmail, inviteToken);

          const invitation = store.getInvitationByToken(inviteToken);
          expect(invitation!.status).toBe("accepted");
          expect(invitation!.acceptedAt).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a used (accepted) invitation token cannot be reused for another sign-up", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        validEmailArb,
        invitationRoleArb,
        tenantIdArb,
        (ownerEmail, invitee1Email, invitee2Email, inviteeRole, tenantId) => {
          const store = new InvitationStore();
          const owner = store.addUser(ownerEmail, "restaurant_owner", tenantId);

          const { inviteToken } = store.createInvitation({
            email: invitee1Email,
            role: inviteeRole,
            tenantId: owner.tenantId,
            invitedBy: owner.userId,
          });

          // First sign-up succeeds
          const result1 = store.signUpWithInvitation(invitee1Email, inviteToken);
          expect(result1.success).toBe(true);

          // Second sign-up with same token fails
          const result2 = store.signUpWithInvitation(invitee2Email, inviteToken);
          expect(result2.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 17: Invitation token expiry", () => {
  it("for any invitation, if more than 7 days have elapsed, the token is rejected", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        invitationRoleArb,
        tenantIdArb,
        expiredOffsetArb,
        (ownerEmail, inviteeEmail, inviteeRole, tenantId, elapsedMs) => {
          const baseTime = 1700000000000;
          const store = new InvitationStore(baseTime);
          const owner = store.addUser(ownerEmail, "restaurant_owner", tenantId);

          const { inviteToken } = store.createInvitation({
            email: inviteeEmail,
            role: inviteeRole,
            tenantId: owner.tenantId,
            invitedBy: owner.userId,
          });

          // Advance time past the 7-day expiry
          store.advanceTime(elapsedMs);

          // Token should be rejected
          const result = store.signUpWithInvitation(inviteeEmail, inviteToken);
          expect(result.success).toBe(false);
          expect(result.error).toBe("Invitation has expired");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any invitation, if less than 7 days have elapsed, the token is accepted", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        invitationRoleArb,
        tenantIdArb,
        validOffsetArb,
        (ownerEmail, inviteeEmail, inviteeRole, tenantId, elapsedMs) => {
          const baseTime = 1700000000000;
          const store = new InvitationStore(baseTime);
          const owner = store.addUser(ownerEmail, "restaurant_owner", tenantId);

          const { inviteToken } = store.createInvitation({
            email: inviteeEmail,
            role: inviteeRole,
            tenantId: owner.tenantId,
            invitedBy: owner.userId,
          });

          // Advance time within the 7-day window
          store.advanceTime(elapsedMs);

          // Token should be accepted
          const result = store.signUpWithInvitation(inviteeEmail, inviteToken);
          expect(result.success).toBe(true);
          expect(result.user).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a token used just past the 7-day boundary is rejected (strict less-than check)", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        invitationRoleArb,
        tenantIdArb,
        (ownerEmail, inviteeEmail, inviteeRole, tenantId) => {
          const baseTime = 1700000000000;
          const store = new InvitationStore(baseTime);
          const owner = store.addUser(ownerEmail, "restaurant_owner", tenantId);

          const { inviteToken } = store.createInvitation({
            email: inviteeEmail,
            role: inviteeRole,
            tenantId: owner.tenantId,
            invitedBy: owner.userId,
          });

          // Advance exactly 7 days + 1ms past expiry
          // expiresAt = baseTime + SEVEN_DAYS_MS
          // The check is expiresAt < currentTime, so at exactly expiresAt it's not expired.
          // 1ms past triggers the expiry.
          store.advanceTime(SEVEN_DAYS_MS + 1);

          const result = store.signUpWithInvitation(inviteeEmail, inviteToken);
          expect(result.success).toBe(false);
          expect(result.error).toBe("Invitation has expired");
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getInvitationByToken marks expired invitations as invalid", () => {
    fc.assert(
      fc.property(
        validEmailArb,
        validEmailArb,
        invitationRoleArb,
        tenantIdArb,
        expiredOffsetArb,
        (ownerEmail, inviteeEmail, inviteeRole, tenantId, elapsedMs) => {
          const baseTime = 1700000000000;
          const store = new InvitationStore(baseTime);
          const owner = store.addUser(ownerEmail, "restaurant_owner", tenantId);

          const { inviteToken } = store.createInvitation({
            email: inviteeEmail,
            role: inviteeRole,
            tenantId: owner.tenantId,
            invitedBy: owner.userId,
          });

          store.advanceTime(elapsedMs);

          const invitation = store.getInvitationByToken(inviteToken);
          expect(invitation).not.toBeNull();
          expect(invitation!.isExpired).toBe(true);
          expect(invitation!.isValid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a non-existent token returns null regardless of time", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 64 }),
        (fakeToken) => {
          const store = new InvitationStore();
          const result = store.getInvitationByToken(fakeToken);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
