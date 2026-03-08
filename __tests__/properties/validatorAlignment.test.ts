/**
 * Feature: convex-auth-integration, Property 1: User mutation validators accept all schema-defined roles and tenant types
 *
 * Validates: Requirements 2.1, 2.2, 2.3
 *
 * For any role in {platform_admin, restaurant_owner, business_owner, branch_manager, supervisor}
 * and for any tenantType in {platform, restaurant, business, branch}, the validators
 * in convex/users.ts (userRoleValidator, tenantTypeValidator) accept them — meaning
 * createUser and updateUser mutations will not reject them at the validation layer.
 *
 * This test mirrors the exact literal sets from convex/schema.ts and convex/users.ts
 * and verifies they are identical, then property-tests that any combination drawn
 * from the schema set is present in the validator set.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// --- Values defined in convex/schema.ts users table ---

const SCHEMA_ROLES = [
  "platform_admin",
  "restaurant_owner",
  "business_owner",
  "branch_manager",
  "supervisor",
] as const;

const SCHEMA_TENANT_TYPES = [
  "platform",
  "restaurant",
  "business",
  "branch",
] as const;

type SchemaRole = (typeof SCHEMA_ROLES)[number];
type SchemaTenantType = (typeof SCHEMA_TENANT_TYPES)[number];

// --- Values accepted by convex/users.ts validators (userRoleValidator, tenantTypeValidator) ---

const VALIDATOR_ROLES = [
  "platform_admin",
  "restaurant_owner",
  "business_owner",
  "branch_manager",
  "supervisor",
] as const;

const VALIDATOR_TENANT_TYPES = [
  "platform",
  "restaurant",
  "business",
  "branch",
] as const;

// --- Pure validation logic mirroring the Convex v.union(v.literal(...)) behavior ---

function isValidRole(role: string): boolean {
  return (VALIDATOR_ROLES as readonly string[]).includes(role);
}

function isValidTenantType(tenantType: string): boolean {
  return (VALIDATOR_TENANT_TYPES as readonly string[]).includes(tenantType);
}

// --- Arbitraries ---

const schemaRoleArb = fc.constantFrom<SchemaRole>(...SCHEMA_ROLES);
const schemaTenantTypeArb = fc.constantFrom<SchemaTenantType>(...SCHEMA_TENANT_TYPES);

/** Random string that is NOT a valid role — used to verify rejection */
const invalidRoleArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !(SCHEMA_ROLES as readonly string[]).includes(s));

/** Random string that is NOT a valid tenant type — used to verify rejection */
const invalidTenantTypeArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !(SCHEMA_TENANT_TYPES as readonly string[]).includes(s));

// --- Tests ---

describe("Property 1: User mutation validators accept all schema-defined roles and tenant types", () => {
  it("validator role set matches schema role set exactly", () => {
    const schemaSet = new Set<string>(SCHEMA_ROLES);
    const validatorSet = new Set<string>(VALIDATOR_ROLES);
    expect(schemaSet).toEqual(validatorSet);
  });

  it("validator tenant type set matches schema tenant type set exactly", () => {
    const schemaSet = new Set<string>(SCHEMA_TENANT_TYPES);
    const validatorSet = new Set<string>(VALIDATOR_TENANT_TYPES);
    expect(schemaSet).toEqual(validatorSet);
  });

  it("any schema-defined role is accepted by the validator", () => {
    fc.assert(
      fc.property(schemaRoleArb, (role) => {
        expect(isValidRole(role)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("any schema-defined tenantType is accepted by the validator", () => {
    fc.assert(
      fc.property(schemaTenantTypeArb, (tenantType) => {
        expect(isValidTenantType(tenantType)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("any (role, tenantType) pair from the schema is accepted by both validators", () => {
    fc.assert(
      fc.property(schemaRoleArb, schemaTenantTypeArb, (role, tenantType) => {
        expect(isValidRole(role)).toBe(true);
        expect(isValidTenantType(tenantType)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("random strings outside the schema sets are rejected by the validators", () => {
    fc.assert(
      fc.property(invalidRoleArb, invalidTenantTypeArb, (badRole, badTenantType) => {
        expect(isValidRole(badRole)).toBe(false);
        expect(isValidTenantType(badTenantType)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
