require("ts-node/register");

const { assertPlatformAccess, assertRole } = require("../convex/auth");

const expectThrow = (fn, message) => {
  try {
    fn();
  } catch (error) {
    return;
  }
  throw new Error(message);
};

assertRole("platform_admin", ["platform_admin", "supervisor"]);
expectThrow(
  () => assertRole("branch_manager", ["platform_admin"]),
  "Expected assertRole to throw for disallowed role."
);

assertPlatformAccess({ platformId: "plat-123" }, "plat-123");
expectThrow(
  () => assertPlatformAccess({ platformId: "plat-abc" }, "plat-xyz"),
  "Expected assertPlatformAccess to throw for mismatched platform."
);

console.log("Tenant guard tests passed.");
