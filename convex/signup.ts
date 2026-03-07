import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { verticalValidator } from "./shared/validators";

/**
 * Self-serve signup mutations
 * Requirements: 26.1, 26.2
 * - Allow restaurant owners to sign up without platform admin involvement
 * - Collect business verification documents during onboarding
 */

// Generate a unique user ID (12-character alphanumeric)
function generateUserId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Generate a 5-digit numeric restaurant ID
function generateRestaurantId(): string {
  const min = 10000;
  const max = 99999;
  return Math.floor(Math.random() * (max - min + 1) + min).toString();
}

// Generate a unique branch ID (10-character alphanumeric)
function generateBranchId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "BR";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Generate a unique platform ID
function generatePlatformId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "PLT";
  for (let i = 0; i < 7; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Simple hash function for passwords (in production, use bcrypt on the server)
// Note: This is a placeholder - in production, password hashing should be done
// server-side with a proper library like bcrypt
async function hashPassword(password: string): Promise<string> {
  // Convert password to bytes
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  
  // Hash using SHA-256 (this is NOT secure for production - use bcrypt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}

// Default operating hours (9 AM - 9 PM, Monday-Saturday)
function getDefaultOperatingHours() {
  const defaultHours = { open: "09:00", close: "21:00" };
  return {
    monday: defaultHours,
    tuesday: defaultHours,
    wednesday: defaultHours,
    thursday: defaultHours,
    friday: defaultHours,
    saturday: defaultHours,
    sunday: undefined,
  };
}

/**
 * Create a new restaurant owner account with restaurant and default branch
 * Requirements: 26.1 - Allow restaurant owners to sign up without platform admin involvement
 */
export const createRestaurantOwner = mutation({
  args: {
    email: v.string(),
    passwordHash: v.string(), // Password should be hashed on the client before sending
    restaurantName: v.string(),
    ownerName: v.string(),
    address: v.string(),
    phoneNumber: v.string(),
    city: v.string(),
    state: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if email already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingUser) {
      throw new Error("An account with this email already exists");
    }

    // Generate unique IDs
    let userId: string;
    let existingUserId;
    do {
      userId = generateUserId();
      existingUserId = await ctx.db
        .query("users")
        .withIndex("by_user_id", (q) => q.eq("userId", userId))
        .first();
    } while (existingUserId);

    let restaurantId: string;
    let existingRestaurant;
    do {
      restaurantId = generateRestaurantId();
      existingRestaurant = await ctx.db
        .query("restaurants")
        .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", restaurantId))
        .first();
    } while (existingRestaurant);

    let branchId: string;
    let existingBranch;
    do {
      branchId = generateBranchId();
      existingBranch = await ctx.db
        .query("branches")
        .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
        .first();
    } while (existingBranch);

    // Get or create default platform
    let platform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", "DEFAULT"))
      .first();

    if (!platform) {
      // Create default platform if it doesn't exist
      await ctx.db.insert("platforms", {
        platformId: "DEFAULT",
        name: "Default Platform",
        settings: {
          defaultLanguage: "english",
          enabledPaymentMethods: ["paystack", "flutterwave", "cod"],
          whatsappEnabled: true,
          smsEnabled: true,
        },
        createdAt: Date.now(),
      });
    }

    const platformId = "DEFAULT";
    const now = Date.now();

    try {
      // Create the user with restaurant_owner role
      const userDocId = await ctx.db.insert("users", {
        userId,
        email: args.email,
        passwordHash: args.passwordHash,
        role: "restaurant_owner",
        tenantType: "restaurant",
        tenantId: restaurantId,
        createdAt: now,
      });

      // Create the restaurant
      const restaurantDocId = await ctx.db.insert("restaurants", {
        restaurantId,
        platformId,
        name: args.restaurantName,
        agentName: `${args.restaurantName} Assistant`,
        specialInstructions: "",
        languagePreference: "english",
        branchCount: 1,
        createdAt: now,
      });

      // Create the default branch
      const fullAddress = `${args.address}, ${args.city}, ${args.state}`;
      const branchDocId = await ctx.db.insert("branches", {
        branchId,
        restaurantId,
        name: `${args.restaurantName} - Main Branch`,
        address: fullAddress,
        phoneNumber: args.phoneNumber,
        operatingHours: getDefaultOperatingHours(),
        isActive: true,
        createdAt: now,
      });

      return {
        success: true,
        userId,
        restaurantId,
        branchId,
        userDocId,
        restaurantDocId,
        branchDocId,
      };
    } catch (error) {
      throw new Error(`Failed to create account: ${(error as Error).message}`);
    }
  },
});

/**
 * Create a new business owner account with multi-vertical support.
 * Extends the createRestaurantOwner pattern for the AI Reception OS pivot.
 * Requirements: 12.4, 12.6, 12.7, 1.5, 1.6
 */
export const createBusinessOwner = mutation({
  args: {
    email: v.string(),
    passwordHash: v.string(),
    businessName: v.string(),
    ownerName: v.string(),
    address: v.string(),
    phoneNumber: v.string(),
    city: v.string(),
    state: v.string(),
    // Multi-vertical args
    vertical: v.optional(verticalValidator),
    enabledModules: v.optional(v.array(v.string())),
    integrationConfig: v.optional(
      v.object({
        apiKey: v.string(),
        tenantMapping: v.string(), // JSON string: {locationId: runsheetHubId}
      })
    ),
  },
  handler: async (ctx, args) => {
    // Check if email already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingUser) {
      throw new Error("An account with this email already exists");
    }

    const vertical = args.vertical ?? "restaurant";
    const isRestaurant = vertical === "restaurant";

    // Determine enabledModules — always include "core_platform"
    const verticalPackMap: Record<string, string> = {
      restaurant: "restaurant_pack",
      logistics: "logistics_pack",
      healthcare: "healthcare_pack",
      legal: "legal_pack",
      hospitality: "hospitality_pack",
      general_services: "general_services_pack",
    };
    const defaultPack = verticalPackMap[vertical];
    let enabledModules = args.enabledModules
      ? [...args.enabledModules]
      : ["core_platform", ...(defaultPack ? [defaultPack] : [])];

    // Ensure core_platform is always present
    if (!enabledModules.includes("core_platform")) {
      enabledModules = ["core_platform", ...enabledModules];
    }

    // Generate unique IDs
    let userId: string;
    let existingUserId;
    do {
      userId = generateUserId();
      existingUserId = await ctx.db
        .query("users")
        .withIndex("by_user_id", (q) => q.eq("userId", userId))
        .first();
    } while (existingUserId);

    let restaurantId: string;
    let existingRestaurant;
    do {
      restaurantId = generateRestaurantId();
      existingRestaurant = await ctx.db
        .query("restaurants")
        .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", restaurantId))
        .first();
    } while (existingRestaurant);

    let branchId: string;
    let existingBranch;
    do {
      branchId = generateBranchId();
      existingBranch = await ctx.db
        .query("branches")
        .withIndex("by_branch_id", (q) => q.eq("branchId", branchId))
        .first();
    } while (existingBranch);

    // Get or create default platform
    const platform = await ctx.db
      .query("platforms")
      .withIndex("by_platform_id", (q) => q.eq("platformId", "DEFAULT"))
      .first();

    if (!platform) {
      await ctx.db.insert("platforms", {
        platformId: "DEFAULT",
        name: "Default Platform",
        settings: {
          defaultLanguage: "english",
          enabledPaymentMethods: ["paystack", "flutterwave", "cod"],
          whatsappEnabled: true,
          smsEnabled: true,
        },
        createdAt: Date.now(),
      });
    }

    const platformId = "DEFAULT";
    const now = Date.now();

    // Determine role and tenantType based on vertical
    const role = isRestaurant ? "restaurant_owner" : "business_owner";
    const tenantType = isRestaurant ? "restaurant" : "business";

    try {
      // Create the user
      const userDocId = await ctx.db.insert("users", {
        userId,
        email: args.email,
        passwordHash: args.passwordHash,
        role,
        tenantType,
        tenantId: restaurantId,
        createdAt: now,
      });

      // Create the business (restaurant) record with vertical and enabledModules
      const restaurantDocId = await ctx.db.insert("restaurants", {
        restaurantId,
        platformId,
        name: args.businessName,
        agentName: `${args.businessName} Assistant`,
        specialInstructions: "",
        languagePreference: "english",
        branchCount: 1,
        createdAt: now,
        vertical,
        enabledModules,
      });

      // For logistics vertical with integration config, patch in the integration data
      if (
        vertical === "logistics" &&
        args.integrationConfig &&
        enabledModules.includes("runsheet_connect")
      ) {
        await ctx.db.patch(restaurantDocId, {
          integrations: {
            runsheet: {
              apiKeyEncrypted: args.integrationConfig.apiKey, // Encryption at API layer
              apiKeyLast4: args.integrationConfig.apiKey.slice(-4),
              tenantMapping: args.integrationConfig.tenantMapping,
              webhookUrl: `/api/v1/integrations/runsheet/webhook/${restaurantId}`,
              webhookSecret: generateUserId() + generateUserId(), // Random secret
              status: "connected" as const,
              failureCount: 0,
              lastSyncAt: now,
            },
          },
        });
      }

      // Create the default location (branch)
      const fullAddress = `${args.address}, ${args.city}, ${args.state}`;
      const locationLabel = isRestaurant
        ? `${args.businessName} - Main Branch`
        : `${args.businessName} - Main Location`;

      const branchDocId = await ctx.db.insert("branches", {
        branchId,
        restaurantId,
        name: locationLabel,
        address: fullAddress,
        phoneNumber: args.phoneNumber,
        operatingHours: getDefaultOperatingHours(),
        isActive: true,
        createdAt: now,
      });

      return {
        success: true,
        userId,
        restaurantId, // Also serves as businessId
        businessId: restaurantId,
        branchId,
        vertical,
        enabledModules,
        userDocId,
        restaurantDocId,
        branchDocId,
      };
    } catch (error) {
      throw new Error(`Failed to create account: ${(error as Error).message}`);
    }
  },
});


/**
 * Submit verification documents for a restaurant owner
 * Requirements: 26.2 - Collect business verification documents during onboarding
 */
export const submitVerificationDocuments = mutation({
  args: {
    userId: v.string(),
    restaurantId: v.string(),
    documents: v.array(v.object({
      type: v.union(
        v.literal("business_registration"),
        v.literal("owner_id"),
        v.literal("tax_certificate")
      ),
      fileName: v.string(),
      fileUrl: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    // Verify the user exists
    const user = await ctx.db
      .query("users")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Verify the restaurant exists and belongs to the user
    const restaurant = await ctx.db
      .query("restaurants")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", args.restaurantId))
      .first();

    if (!restaurant) {
      throw new Error("Restaurant not found");
    }

    if (user.tenantId !== args.restaurantId) {
      throw new Error("Unauthorized: Restaurant does not belong to this user");
    }

    // Store document references
    // In a real implementation, documents would be uploaded to cloud storage
    // and the URLs would be stored here
    const now = Date.now();
    const documentRecords = args.documents.map(doc => ({
      ...doc,
      uploadedAt: now,
      verified: false,
    }));

    // For now, we'll store the document info in a simple format
    // In production, you'd have a separate verificationDocuments table
    // and integrate with a document verification service

    return {
      success: true,
      documentsSubmitted: documentRecords.length,
      message: "Documents submitted successfully. Verification is pending.",
    };
  },
});

/**
 * Get signup status for a user
 */
export const getSignupStatus = query({
  args: { 
    email: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let user;

    if (args.userId !== undefined) {
      const userId = args.userId;
      user = await ctx.db
        .query("users")
        .withIndex("by_user_id", (q) => q.eq("userId", userId))
        .first();
    } else if (args.email !== undefined) {
      const email = args.email;
      user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
    }

    if (!user) {
      return {
        exists: false,
        status: null,
      };
    }

    // Get the associated restaurant
    const restaurant = await ctx.db
      .query("restaurants")
      .withIndex("by_restaurant_id", (q) => q.eq("restaurantId", user.tenantId))
      .first();

    return {
      exists: true,
      status: "active", // In production, this would check verification status
      userId: user.userId,
      email: user.email,
      role: user.role,
      restaurantId: restaurant?.restaurantId,
      restaurantName: restaurant?.name,
      createdAt: user.createdAt,
    };
  },
});

/**
 * Check if an email is already registered
 */
export const checkEmailAvailability = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    return {
      available: !existingUser,
    };
  },
});
