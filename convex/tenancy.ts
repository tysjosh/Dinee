import { Doc } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

type TenantCtx = MutationCtx | QueryCtx;

export async function assertRestaurantPlatform(
  ctx: TenantCtx,
  restaurantId: string,
  platformId: string
) {
  const restaurant = await ctx.db
    .query("restaurants")
    .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", restaurantId))
    .first();

  if (!restaurant) {
    throw new Error("Restaurant not found");
  }

  if (restaurant.platformId && restaurant.platformId !== platformId) {
    throw new Error("Restaurant does not belong to this platform");
  }

  return restaurant;
}

export async function assertBranchPlatform(
  ctx: TenantCtx,
  branchId: string,
  platformId: string
) {
  const branch = await ctx.db
    .query("branches")
    .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
    .first();

  if (!branch) {
    throw new Error("Branch not found");
  }

  if (branch.platformId !== platformId) {
    throw new Error("Branch does not belong to this platform");
  }

  return branch;
}

export function assertOrderBelongsToRestaurant(
  order: Doc<"orders">,
  restaurantId: string
) {
  if (order.restaurantId !== restaurantId) {
    throw new Error("Order does not belong to this restaurant");
  }
}
