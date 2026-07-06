import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  verticalValidator,
  deliveryStatusValidator,
  serviceTypeValidator,
  riderStatusValidator,
  logisticsPaymentMethodValidator,
  paymentStatusValidator,
  actorTypeValidator,
  addressValidator,
  parcelValidator,
  proofOfDeliveryValidator,
  conversationTypeValidator,
} from "./shared/validators";

export default defineSchema({
  // Auth tables required by @convex-dev/auth
  ...authTables,
  // Platform (multi-tenant support)
  platforms: defineTable({
    platformId: v.string(),
    name: v.string(),
    settings: v.object({
      defaultLanguage: v.union(
        v.literal("english"),
        v.literal("nigerian_english"),
        v.literal("pidgin"),
        v.literal("spanish"),
        v.literal("french")
      ),
      enabledPaymentMethods: v.array(
        v.union(
          v.literal("paystack"),
          v.literal("flutterwave"),
          v.literal("cod"),
          v.literal("stripe")
        )
      ),
      whatsappEnabled: v.boolean(),
      smsEnabled: v.boolean(),
    }),
    createdAt: v.number(),
    // Logistics vertical: enabled verticals for this platform
    enabledVerticals: v.optional(v.array(verticalValidator)),
  }).index("by_platform_id", ["platformId"]),

  // Users (role-based access control + @convex-dev/auth required fields)
  users: defineTable({
    // @convex-dev/auth required optional fields
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // Custom app fields (all optional so auth-created users work)
    userId: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
    role: v.optional(v.union(
      v.literal("platform_admin"),
      v.literal("restaurant_owner"),
      v.literal("business_owner"),
      v.literal("branch_manager"),
      v.literal("supervisor"),
      // NEW — additive member for Control Plane partner self-service
      // (platform-control-plane Req 5.2, 4.5, 5.6). Existing rows validate as-is.
      v.literal("partner")
    )),
    // NEW — optional explicit Authorization_Scope override for a partner
    // (platform-control-plane Req 5.2). When absent, a partner's scope is
    // derived from tenantId. Optional so existing users validate unchanged.
    authorizationScope: v.optional(v.array(v.object({
      platformId: v.string(),
      tenantId: v.string(),
    }))),
    tenantType: v.optional(v.union(
      v.literal("platform"),
      v.literal("restaurant"),
      v.literal("business"),
      v.literal("branch")
    )),
    tenantId: v.optional(v.string()),
    lastLoginAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    // @convex-dev/auth required indexes
    .index("email", ["email"])
    .index("phone", ["phone"])
    // Custom app indexes
    .index("by_user_id", ["userId"])
    .index("by_tenant", ["tenantType", "tenantId"]),

  // Branches (physical locations of restaurants)
  branches: defineTable({
    branchId: v.string(),
    restaurantId: v.string(),
    name: v.string(),
    address: v.string(),
    phoneNumber: v.string(),
    operatingHours: v.object({
      monday: v.optional(v.object({ open: v.string(), close: v.string() })),
      tuesday: v.optional(v.object({ open: v.string(), close: v.string() })),
      wednesday: v.optional(v.object({ open: v.string(), close: v.string() })),
      thursday: v.optional(v.object({ open: v.string(), close: v.string() })),
      friday: v.optional(v.object({ open: v.string(), close: v.string() })),
      saturday: v.optional(v.object({ open: v.string(), close: v.string() })),
      sunday: v.optional(v.object({ open: v.string(), close: v.string() })),
    }),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_branch_id", ["branchId"])
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_phone_number", ["phoneNumber"]),

  // Restaurant (extended for multi-tenancy and multi-vertical)
  restaurants: defineTable({
    restaurantId: v.string(), // 5-digit numeric restaurant ID
    platformId: v.string(), // Foreign key to platforms table
    name: v.string(),
    agentName: v.string(),
    specialInstructions: v.string(),
    languagePreference: v.union(
      v.literal("english"),
      v.literal("nigerian_english"),
      v.literal("pidgin"),
      v.literal("spanish"),
      v.literal("french")
    ),
    branchCount: v.optional(v.number()), // Count of branches for this restaurant
    createdAt: v.number(),

    // NEW: Country/region for multi-region support (NG | US). Optional for
    // backward compat; absent is treated as "NG" (DEFAULT_COUNTRY) in app logic.
    // Drives currency, payment providers, phone format, states, and telecom.
    country: v.optional(v.union(v.literal("NG"), v.literal("US"))),

    // NEW: Vertical classification (Req 1.2)
    vertical: v.optional(verticalValidator), // optional for backward compat; defaults "restaurant" in app logic

    // NEW: Active module packs (Req 1.3)
    enabledModules: v.optional(v.array(v.string())),

    // NEW: Integration configurations (Req 1.4)
    integrations: v.optional(v.object({
      runsheet: v.optional(v.object({
        apiKeyEncrypted: v.string(),
        apiKeyLast4: v.string(),
        tenantMapping: v.string(), // JSON: {locationId: runsheetHubId}
        webhookUrl: v.string(),
        webhookSecret: v.string(),
        lastSyncAt: v.optional(v.number()),
        status: v.union(
          v.literal("connected"),
          v.literal("disconnected"),
          v.literal("error")
        ),
        failureCount: v.optional(v.number()),
        credentialExpiresAt: v.optional(v.number()),
      })),
    })),
  })
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_platform_id", ["platformId"])
    .index("by_vertical", ["vertical"]),

  // Menu items (extended for multi-tenancy)
  menuItems: defineTable({
    restaurantId: v.string(),
    branchId: v.optional(v.string()), // Branch-specific menus
    name: v.string(),
    price: v.string(),
    priceNumeric: v.optional(v.number()), // For calculations
    description: v.optional(v.string()),
    category: v.optional(v.string()), // Menu category
    modifiers: v.optional(v.array(v.object({
      name: v.string(),
      price: v.number(),
    }))), // Item modifiers with prices
    isAvailable: v.optional(v.boolean()), // Availability status
  })
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_branch_id", ["branchId"]),

  // Calls (extended for multi-tenancy)
  calls: defineTable({
    callId: v.string(), // callSid from Twilio
    orderId: v.optional(v.string()), // order id
    restaurantId: v.optional(v.string()),
    branchId: v.optional(v.string()), // Branch-specific calls
    phoneNumber: v.optional(v.string()),
    callStartTime: v.optional(v.number()),
    callEndTime: v.optional(v.number()), // When call ended
    duration: v.optional(v.number()), // Call duration in seconds
    status: v.optional(v.union(v.literal("active"), v.literal("completed"))),
    asrConfidence: v.optional(v.number()), // ASR confidence score
    languageDetected: v.optional(v.string()), // Detected language
    fallbackTriggered: v.optional(v.boolean()), // Whether fallback was triggered
    // Logistics vertical: vertical discriminator
    vertical: v.optional(verticalValidator),
    // Conversation type for voice agent routing (Req 11.1, 11.2, 11.3, 11.4)
    conversationType: v.optional(conversationTypeValidator),
    // Req 17.7: Voice session correlation ID for end-to-end tracing (Req 7.1: v.optional for backward compat)
    correlationId: v.optional(v.string()),
    // NEW: Active prompt pack identifier (Req 11.1)
    workflow_type: v.optional(v.string()),
    // NEW: Integration-specific metadata (Req 11.2)
    integration_context: v.optional(v.object({
      runsheetSessionId: v.optional(v.string()),
      externalReferenceIds: v.optional(v.array(v.string())),
    })),
    // NEW: Attribution fields (REQ-4.4)
    source_platform: v.optional(v.string()),
    source_tenant: v.optional(v.string()),
    external_reference_id: v.optional(v.string()),
  })
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_branch_id", ["branchId"])
    .index("by_call_and_order_id", ["callId", "orderId"]),

  // Orders (extended for multi-tenancy, payments, and delivery)
  orders: defineTable({
    // This order id is given to the cx and used to track the order 
    orderId: v.string(),
    // Human-readable 6-char code for customer-facing references (voice readback, dashboard display)
    publicOrderCode: v.optional(v.string()),
    restaurantId: v.string(),
    branchId: v.optional(v.string()), // Branch-specific orders
    callId: v.optional(v.string()), // callSid from Twilio
    customerName: v.string(),
    customerPhone: v.optional(v.string()), // Customer phone number
    items: v.array(v.object({
      name: v.string(),
      quantity: v.number(),
      price: v.number(),
      modifiers: v.optional(v.array(v.object({
        name: v.string(),
        price: v.number(),
      }))), // Item modifiers
    })),
    specialInstructions: v.optional(v.string()),
    totalAmount: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("preparing"), // Order being prepared
      v.literal("ready"), // Order ready for pickup/delivery
      v.literal("completed"),
      v.literal("cancelled")
    ),
    // Payment fields
    paymentMethod: v.optional(v.union(
      v.literal("paystack"),
      v.literal("flutterwave"),
      v.literal("cod"),
      v.literal("stripe")
    )),
    paymentStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("refunded")
    )),
    paymentReference: v.optional(v.string()),
    paymentTimestamp: v.optional(v.number()),
    // Delivery fields
    deliveryStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("assigned"),
      v.literal("dispatched"),
      v.literal("in_transit"),
      v.literal("delivered"),
      v.literal("failed")
    )),
    riderId: v.optional(v.string()),
    riderName: v.optional(v.string()),
    dispatchedAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    deliveryFailureReason: v.optional(v.string()),
    // WhatsApp fields
    whatsappOptIn: v.optional(v.boolean()),
    whatsappMessageIds: v.optional(v.array(v.string())),
    // Routing decision (for multi-location order routing)
    // Requirements: 27.7, 27.8
    routingDecision: v.optional(v.object({
      selectedBranchId: v.string(),
      selectedBranchName: v.string(),
      reason: v.union(
        v.literal("nearest_branch"),
        v.literal("same_city"),
        v.literal("same_state"),
        v.literal("fallback_any_active"),
        v.literal("customer_selected"),
        v.literal("only_branch_available")
      ),
      customerLocation: v.optional(v.object({
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        areaCode: v.string(),
        confidence: v.union(
          v.literal("high"),
          v.literal("medium"),
          v.literal("low")
        ),
      })),
      timestamp: v.number(),
      warnings: v.optional(v.array(v.string())),
    })),
    // Timestamps
    orderPlacementTime: v.optional(v.number()),
    cancellationReason: v.optional(v.string()),
    // Logistics vertical: vertical discriminator and location reference
    vertical: v.optional(verticalValidator),
    locationId: v.optional(v.string()),
    // NEW: Attribution fields (REQ-4.4)
    source_platform: v.optional(v.string()),
    source_tenant: v.optional(v.string()),
    external_reference_id: v.optional(v.string()),
  })
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_branch_id", ["branchId"])
    .index("by_order_and_restaurant_id", ["orderId", "restaurantId"])
    .index("by_order_id", ["orderId"])
    .index("by_payment_status", ["paymentStatus"])
    .index("by_delivery_status", ["deliveryStatus"])
    .index("by_public_order_code_and_restaurant", ["publicOrderCode", "restaurantId"]),

  // Transcripts
  transcripts: defineTable({
    callId: v.string(),
    dialogue: v.string(),
    speaker: v.union(v.literal("human"), v.literal("ai")),
    // Req 17.9: Voice session correlation ID for end-to-end tracing (Req 7.1: v.optional for backward compat)
    correlationId: v.optional(v.string()),
  })
    .index("by_call_id", ["callId"]),

  // Menu Imports (tracking import operations)
  menuImports: defineTable({
    importId: v.string(),
    branchId: v.string(),
    restaurantId: v.string(),
    source: v.union(v.literal("csv"), v.literal("google_sheets")),
    sourceUrl: v.optional(v.string()), // For Google Sheets imports
    fileName: v.optional(v.string()), // For CSV imports
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    totalRows: v.number(),
    successCount: v.number(),
    failedCount: v.number(),
    failedRows: v.array(v.object({
      row: v.number(),
      error: v.string(),
      data: v.optional(v.string()),
    })),
    retryCount: v.optional(v.number()),
    lastRetryAt: v.optional(v.number()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_import_id", ["importId"])
    .index("by_branch_id", ["branchId"])
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_status", ["status"]),

  // Webhook Events (logging webhook events from payment providers and WhatsApp)
  webhookEvents: defineTable({
    eventId: v.string(),
    provider: v.union(
      v.literal("paystack"),
      v.literal("flutterwave"),
      v.literal("whatsapp"),
      v.literal("stripe")
    ),
    eventType: v.string(),
    payload: v.string(),
    signature: v.optional(v.string()),
    verified: v.boolean(),
    processed: v.boolean(),
    orderId: v.optional(v.string()),
    // Logistics vertical: polymorphic webhook event fields
    shipmentId: v.optional(v.string()),
    resourceType: v.optional(v.union(v.literal("order"), v.literal("shipment"))),
    resourceId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_order_id", ["orderId"])
    .index("by_shipment_id", ["shipmentId"]),

  // Customer Preferences (WhatsApp/SMS opt-in management)
  customerPreferences: defineTable({
    phoneNumber: v.string(),
    whatsappOptIn: v.boolean(),
    smsOptIn: v.boolean(),
    preferredLanguage: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_phone", ["phoneNumber"]),

  // Partner API - Partners/Organizations
  partners: defineTable({
    partnerId: v.string(),
    name: v.string(),
    email: v.string(),
    isActive: v.boolean(),
    platformId: v.string(),
    restaurantIds: v.optional(v.array(v.string())),
    // Logistics vertical: organization access list
    organizationIds: v.optional(v.array(v.string())),
    createdAt: v.number(),
  })
    .index("by_partner_id", ["partnerId"])
    .index("by_platform_id", ["platformId"])
    .index("by_email", ["email"]),

  // Partner API - API Keys
  apiKeys: defineTable({
    keyId: v.string(),
    keyHash: v.string(),
    keyPrefix: v.string(),
    name: v.string(),
    partnerId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("expired")
    ),
    scopes: v.array(v.string()),
    rateLimitOverride: v.optional(v.number()),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    ipWhitelist: v.optional(v.array(v.string())),
  })
    .index("by_key_id", ["keyId"])
    .index("by_key_hash", ["keyHash"])
    .index("by_partner_id", ["partnerId"]),

  // Partner API - OAuth Clients
  oauthClients: defineTable({
    clientId: v.string(),
    clientSecretHash: v.string(),
    name: v.string(),
    partnerId: v.string(),
    redirectUris: v.array(v.string()),
    grantTypes: v.array(v.string()),
    scopes: v.array(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_client_id", ["clientId"])
    .index("by_partner_id", ["partnerId"]),

  // Partner API - Webhook Subscriptions
  webhookSubscriptions: defineTable({
    subscriptionId: v.string(),
    partnerId: v.string(),
    url: v.string(),
    events: v.array(v.string()),
    secret: v.string(),
    isActive: v.boolean(),
    // Delivery mode: "partner" (default) or "runsheet"
    mode: v.optional(v.union(v.literal("partner"), v.literal("runsheet"))),
    // Authoritative tenant ID for runsheet envelope stamping
    tenantId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_subscription_id", ["subscriptionId"])
    .index("by_partner_id", ["partnerId"]),

  // Partner API - Webhook Deliveries
  webhookDeliveries: defineTable({
    deliveryId: v.string(),
    subscriptionId: v.string(),
    eventType: v.string(),
    payload: v.string(),
    statusCode: v.optional(v.number()),
    responseBody: v.optional(v.string()),
    attemptCount: v.number(),
    success: v.boolean(),
    error: v.optional(v.string()),
    nextRetryAt: v.optional(v.number()),
    createdAt: v.number(),
    lastAttemptAt: v.optional(v.number()),
  })
    .index("by_delivery_id", ["deliveryId"])
    .index("by_subscription_id", ["subscriptionId"])
    .index("by_success", ["success"])
    .index("by_next_retry_at", ["nextRetryAt"]),

  // Partner API - API Usage Logs
  apiUsageLogs: defineTable({
    logId: v.string(),
    partnerId: v.string(),
    apiKeyId: v.string(),
    endpoint: v.string(),
    method: v.string(),
    statusCode: v.number(),
    responseTimeMs: v.number(),
    ipAddress: v.string(),
    userAgent: v.optional(v.string()),
    requestId: v.string(),
    createdAt: v.number(),
  })
    .index("by_partner_id", ["partnerId"])
    .index("by_api_key_id", ["apiKeyId"])
    .index("by_created_at", ["createdAt"]),

  // Upsell/Cross-sell Prompts Library
  prompts: defineTable({
    promptId: v.string(),
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    triggerCondition: v.union(
      v.literal("order_total_below"),
      v.literal("item_category"),
      v.literal("time_of_day"),
      v.literal("customer_history")
    ),
    triggerValue: v.string(),
    promptText: v.string(),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_prompt_id", ["promptId"])
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_branch_id", ["branchId"]),

  // Prompt Deliveries (tracking prompt delivery and acceptance)
  // Requirements: 24.3, 24.6
  promptDeliveries: defineTable({
    deliveryId: v.string(),
    promptId: v.string(),
    orderId: v.string(),
    callId: v.optional(v.string()),
    restaurantId: v.string(),
    branchId: v.optional(v.string()),
    // Delivery status
    delivered: v.boolean(),
    deliveredAt: v.number(),
    // Acceptance tracking
    accepted: v.optional(v.boolean()),
    acceptedAt: v.optional(v.number()),
    // Context at time of delivery
    triggerCondition: v.string(),
    triggerValue: v.string(),
    orderContext: v.object({
      orderTotal: v.optional(v.number()),
      itemCategories: v.optional(v.array(v.string())),
      currentHour: v.optional(v.number()),
      customerOrderCount: v.optional(v.number()),
    }),
  })
    .index("by_delivery_id", ["deliveryId"])
    .index("by_prompt_id", ["promptId"])
    .index("by_order_id", ["orderId"])
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_call_id", ["callId"]),

  // Fraud Signals (fraud and abuse detection)
  // Requirements: 25.1, 25.3
  // Tracks signals: repeated failed payments, high cancellation rate, unusual order patterns
  // Maintains blocklist of phone numbers with confirmed fraud
  fraudSignals: defineTable({
    phoneNumber: v.string(),
    signalType: v.union(
      v.literal("repeated_failed_payments"),
      v.literal("high_cancellation_rate"),
      v.literal("unusual_order_pattern")
    ),
    signalCount: v.number(),
    lastOccurrence: v.number(),
    isBlocked: v.boolean(),
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    disposition: v.optional(v.union(
      v.literal("cleared"),
      v.literal("blocked"),
      v.literal("monitoring")
    )),
  })
    .index("by_phone", ["phoneNumber"])
    .index("by_blocked", ["isBlocked"]),

  // Subscriptions (subscription billing for restaurants)
  // Requirements: 26.3, 26.4
  // Defines subscription plans with feature tiers
  // Integrates with Paystack/Flutterwave for billing
  subscriptions: defineTable({
    subscriptionId: v.string(),
    restaurantId: v.string(),
    planId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("pending"),
      v.literal("cancelled"),
      v.literal("past_due"),
      v.literal("trialing")
    ),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    // Optional: a free trial started at onboarding has NO payment provider until
    // the tenant adds one via the dashboard checkout. Existing rows keep theirs.
    paymentProvider: v.optional(
      v.union(
        v.literal("paystack"),
        v.literal("flutterwave"),
        v.literal("stripe")
      )
    ),
    paymentReference: v.optional(v.string()),
    createdAt: v.number(),
    cancelledAt: v.optional(v.number()),
    // Billing cycle
    billingCycle: v.union(
      v.literal("monthly"),
      v.literal("yearly")
    ),
    // Trial information
    trialEndsAt: v.optional(v.number()),
    // Payment failure tracking
    failedPaymentCount: v.optional(v.number()),
    lastPaymentAttempt: v.optional(v.number()),
    lastPaymentError: v.optional(v.string()),

    // NEW: Vertical classification (Req 14.6)
    vertical: v.optional(verticalValidator),

    // NEW: Active paid add-ons (Req 14.6)
    // e.g. ["restaurant_pack", "runsheet_connect"]
    addOns: v.optional(v.array(v.string())),

    // Billing integration: scheduled downgrade and cancellation (Req 6.4)
    pendingPlanId: v.optional(v.string()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
  })
    .index("by_subscription_id", ["subscriptionId"])
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_status", ["status"]),

  // Subscription Invoices (billing history)
  // Requirements: 26.5
  subscriptionInvoices: defineTable({
    invoiceId: v.string(),
    subscriptionId: v.string(),
    restaurantId: v.string(),
    amount: v.number(),
    currency: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("refunded")
    ),
    paymentProvider: v.union(
      v.literal("paystack"),
      v.literal("flutterwave"),
      v.literal("stripe")
    ),
    paymentReference: v.optional(v.string()),
    periodStart: v.number(),
    periodEnd: v.number(),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
    description: v.optional(v.string()),
  })
    .index("by_invoice_id", ["invoiceId"])
    .index("by_subscription_id", ["subscriptionId"])
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_status", ["status"]),

  // Feature Flags (gradual migration support)
  // Requirements: 28.5, 28.6
  // Supports gradual migration with feature flags
  // Maintains backward compatible API endpoints
  featureFlags: defineTable({
    flagId: v.string(),
    name: v.string(),
    enabled: v.boolean(),
    scope: v.union(
      v.literal("global"),
      v.literal("platform"),
      v.literal("restaurant"),
      v.literal("business"),
      v.literal("branch")
    ),
    scopeId: v.optional(v.string()), // platformId, restaurantId, or branchId
    reason: v.optional(v.string()), // Override reason for audit
    setBy: v.optional(v.string()), // Who set this override
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_flag_id", ["flagId"])
    .index("by_name", ["name"])
    .index("by_scope", ["scope"])
    .index("by_scope_id", ["scopeId"]),

  // Migration Snapshots (rollback support)
  // Requirements: 28.7
  // Stores pre-migration state for rollback capability within 30 days
  migrationSnapshots: defineTable({
    snapshotId: v.string(),
    migrationType: v.union(
      v.literal("structure"), // Platform/branch creation
      v.literal("data"), // Menu items, calls, orders migration
      v.literal("complete") // Full migration
    ),
    // Snapshot of restaurant state before migration
    restaurantSnapshots: v.array(v.object({
      restaurantId: v.string(),
      originalPlatformId: v.optional(v.string()),
      originalBranchCount: v.optional(v.number()),
    })),
    // Snapshot of created branches (for deletion on rollback)
    createdBranchIds: v.array(v.string()),
    // Snapshot of migrated data (for reverting branchId assignments)
    migratedMenuItemIds: v.array(v.string()),
    migratedCallIds: v.array(v.string()),
    migratedOrderIds: v.array(v.string()),
    // Metadata
    status: v.union(
      v.literal("active"), // Can be rolled back
      v.literal("rolled_back"), // Already rolled back
      v.literal("expired") // Past 30-day window
    ),
    createdAt: v.number(),
    expiresAt: v.number(), // 30 days from creation
    rolledBackAt: v.optional(v.number()),
    rolledBackBy: v.optional(v.string()),
  })
    .index("by_snapshot_id", ["snapshotId"])
    .index("by_status", ["status"])
    .index("by_expires_at", ["expiresAt"]),

  // Feature Notifications (new feature announcements)
  // Requirements: 28.8
  // Notifies users of new features without requiring immediate action
  featureNotifications: defineTable({
    notificationId: v.string(),
    // Target scope
    scope: v.union(
      v.literal("global"), // All users
      v.literal("platform"), // Platform-specific
      v.literal("restaurant"), // Restaurant-specific
      v.literal("branch") // Branch-specific
    ),
    scopeId: v.optional(v.string()),
    // Notification content
    title: v.string(),
    message: v.string(),
    featureName: v.string(), // Feature flag name this relates to
    type: v.union(
      v.literal("new_feature"), // New feature available
      v.literal("migration"), // Migration-related
      v.literal("deprecation"), // Feature being deprecated
      v.literal("update") // Feature update
    ),
    // Display settings
    priority: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high")
    ),
    dismissible: v.boolean(),
    actionUrl: v.optional(v.string()), // Link to learn more
    actionLabel: v.optional(v.string()), // Button text
    // Lifecycle
    isActive: v.boolean(),
    startsAt: v.number(),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_notification_id", ["notificationId"])
    .index("by_scope", ["scope"])
    .index("by_scope_id", ["scopeId"])
    .index("by_feature_name", ["featureName"])
    .index("by_is_active", ["isActive"]),

  // User Notification Dismissals (tracking which users dismissed notifications)
  // Requirements: 28.8
  userNotificationDismissals: defineTable({
    notificationId: v.string(),
    userId: v.string(),
    dismissedAt: v.number(),
  })
    .index("by_notification_id", ["notificationId"])
    .index("by_user_id", ["userId"])
    .index("by_notification_and_user", ["notificationId", "userId"]),

  // Branch Capacity (for order routing)
  // Tracks real-time capacity status for each branch
  branchCapacity: defineTable({
    branchId: v.string(),
    status: v.union(
      v.literal("available"),
      v.literal("busy"),
      v.literal("at_capacity")
    ),
    activeOrders: v.number(),
    maxCapacity: v.number(),
    lastUpdated: v.number(),
  })
    .index("by_branch_id", ["branchId"])
    .index("by_status", ["status"]),

  // Monitoring Metrics (for MonitoringService)
  // Stores API, database, and external service metrics
  monitoringMetrics: defineTable({
    metricId: v.string(),
    type: v.union(
      v.literal("api_response_time"),
      v.literal("database_query_latency"),
      v.literal("external_service_response_time"),
      v.literal("uptime_check"),
      v.literal("error_rate")
    ),
    timestamp: v.number(),
    // API response time fields
    endpoint: v.optional(v.string()),
    method: v.optional(v.string()),
    responseTimeMs: v.optional(v.number()),
    statusCode: v.optional(v.number()),
    // Database query fields
    queryType: v.optional(v.string()),
    tableName: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
    // External service fields
    service: v.optional(v.string()),
    // Uptime check fields
    target: v.optional(v.string()),
    isUp: v.optional(v.boolean()),
    // Error rate fields
    errorRate: v.optional(v.number()),
    // Common fields
    success: v.optional(v.boolean()),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.string()), // JSON string for additional data
  })
    .index("by_metric_id", ["metricId"])
    .index("by_type", ["type"])
    .index("by_timestamp", ["timestamp"])
    .index("by_type_and_timestamp", ["type", "timestamp"]),

  // Monitoring Alerts (for MonitoringService and AlertingService)
  // Stores alert history and active alerts
  monitoringAlerts: defineTable({
    alertId: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical")
    ),
    title: v.string(),
    message: v.string(),
    metricType: v.union(
      v.literal("api_response_time"),
      v.literal("database_query_latency"),
      v.literal("external_service_response_time"),
      v.literal("uptime_check"),
      v.literal("error_rate")
    ),
    currentValue: v.number(),
    threshold: v.number(),
    timestamp: v.number(),
    acknowledged: v.boolean(),
    acknowledgedAt: v.optional(v.number()),
    acknowledgedBy: v.optional(v.string()),
    resolved: v.boolean(),
    resolvedAt: v.optional(v.number()),
    context: v.optional(v.string()), // JSON string for additional context
  })
    .index("by_alert_id", ["alertId"])
    .index("by_severity", ["severity"])
    .index("by_resolved", ["resolved"])
    .index("by_timestamp", ["timestamp"])
    .index("by_acknowledged", ["acknowledged"]),

  // Alert Rule Breaches (for tracking consecutive breaches and cooldowns)
  alertRuleBreaches: defineTable({
    ruleId: v.string(),
    breachCount: v.number(),
    lastAlertTime: v.number(),
    lastBreachTime: v.number(),
  })
    .index("by_rule_id", ["ruleId"]),

  // Uptime Tracking (for calculating uptime percentages)
  uptimeTracking: defineTable({
    target: v.string(),
    upCount: v.number(),
    totalCount: v.number(),
    lastUpdated: v.number(),
  })
    .index("by_target", ["target"]),

  // Callback Sessions (persistent callback context store)
  // Replaces in-memory pendingCallbacks Map for restart-safe callback handoff
  callbackSessions: defineTable({
    sessionId: v.string(),       // UUID generated at callback initiation
    phoneNumber: v.string(),
    reason: v.optional(v.string()),
    data: v.optional(v.string()),
    isCallback: v.boolean(),
    createdAt: v.number(),
    expiresAt: v.number(),       // TTL: createdAt + 5 minutes
    consumed: v.boolean(),       // Set true after media-stream-callback reads it
  })
    .index("by_session_id", ["sessionId"])
    .index("by_expires_at", ["expiresAt"]),

  // Logistics: Organizations (multi-vertical tenant entities)
  // Requirements: 2.1, 2.2
  organizations: defineTable({
    organizationId: v.string(),
    platformId: v.string(),
    vertical: verticalValidator,
    name: v.string(),
    settings: v.object({}),
    createdAt: v.number(),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_platform_id", ["platformId"])
    .index("by_vertical", ["vertical"]),

  // Logistics: Locations (physical sites — hubs, warehouses, branches)
  // Requirements: 3.1, 3.2
  locations: defineTable({
    locationId: v.string(),
    organizationId: v.string(),
    name: v.string(),
    address: v.string(),
    city: v.string(),
    state: v.string(),
    geo: v.object({ lat: v.number(), lng: v.number() }),
    isActive: v.boolean(),
    operatingHours: v.object({}),
    // Phone number for inbound call routing (Req 11.3)
    phoneNumber: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_location_id", ["locationId"])
    .index("by_organization_id", ["organizationId"])
    .index("by_city_state", ["city", "state"])
    .index("by_phone_number", ["phoneNumber"]),

  // Logistics: Shipments (parcel lifecycle tracking)
  // Requirements: 4.1, 4.2, 4.9
  shipments: defineTable({
    shipmentId: v.string(),
    trackingCode: v.string(),
    organizationId: v.string(),
    locationId: v.optional(v.string()),
    customerId: v.optional(v.string()),
    sender: addressValidator,
    recipient: addressValidator,
    parcel: parcelValidator,
    serviceType: serviceTypeValidator,
    paymentMethod: v.optional(logisticsPaymentMethodValidator),
    paymentStatus: v.optional(paymentStatusValidator),
    deliveryStatus: deliveryStatusValidator,
    failureReason: v.optional(v.string()),
    etaMinutes: v.optional(v.number()),
    assignedRiderId: v.optional(v.string()),
    proofOfDelivery: v.optional(proofOfDeliveryValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_shipment_id", ["shipmentId"])
    .index("by_tracking_code", ["trackingCode"])
    .index("by_organization_id", ["organizationId"])
    .index("by_delivery_status", ["deliveryStatus"])
    .index("by_assigned_rider_id", ["assignedRiderId"])
    .index("by_org_and_status", ["organizationId", "deliveryStatus"]),

  // Logistics: Riders (delivery personnel)
  // Requirements: 5.1, 5.2
  riders: defineTable({
    riderId: v.string(),
    organizationId: v.string(),
    name: v.string(),
    phone: v.string(),
    vehicleType: v.string(),
    status: riderStatusValidator,
    lastLocation: v.optional(v.object({
      lat: v.number(),
      lng: v.number(),
      updatedAt: v.number(),
    })),
    isActive: v.boolean(),
  })
    .index("by_rider_id", ["riderId"])
    .index("by_organization_id", ["organizationId"])
    .index("by_status", ["status"]),

  // Logistics: Shipment Events (immutable audit log)
  // Requirements: 6.1, 6.2
  shipmentEvents: defineTable({
    eventId: v.string(),
    shipmentId: v.string(),
    eventType: v.string(),
    actorType: actorTypeValidator,
    actorId: v.string(),
    payload: v.string(),
    // Req 17.8: Voice session correlation ID for end-to-end tracing (Req 7.1: v.optional for backward compat)
    correlationId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_shipment_id", ["shipmentId"])
    .index("by_event_type", ["eventType"]),

  // Logistics: Idempotency Keys (replay protection for write endpoints)
  // Requirements: 21.1, 21.2, 21.5
  // Req 3.8, 3.9: status field tracks mutation outcome for failed-state recovery
  // Existing records without status are treated as "success" for backward compatibility (Req 7.1)
  idempotencyKeys: defineTable({
    key: v.string(),
    partnerId: v.string(),
    requestHash: v.string(),
    responseStatus: v.number(),
    responseBody: v.string(),
    // Req 3.8, 3.9: Tracks whether the original mutation succeeded or failed.
    // When "failed", retries re-execute the mutation instead of replaying the error.
    status: v.optional(v.union(v.literal("success"), v.literal("failed"))),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_key_and_partner", ["key", "partnerId"])
    .index("by_expires_at", ["expiresAt"]),

  // KPI Snapshots (Req 15.6)
  // Stores periodic KPI metric snapshots with vertical dimension for historical trend analysis
  kpiSnapshots: defineTable({
    snapshotId: v.string(),
    metricName: v.string(),
    vertical: verticalValidator,
    periodType: v.union(v.literal("day"), v.literal("week"), v.literal("month")),
    periodStart: v.number(),
    periodEnd: v.number(),
    value: v.number(),
    metadata: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_snapshot_id", ["snapshotId"])
    .index("by_metric_and_vertical", ["metricName", "vertical"])
    .index("by_period", ["periodType", "periodStart"]),

  // Integration Audit Log (Req 18.9)
  // Immutable audit trail for integration credential lifecycle events
  integrationAuditLog: defineTable({
    entryId: v.string(),
    businessId: v.string(),
    integrationName: v.string(),
    actionType: v.union(
      v.literal("create"),
      v.literal("rotate"),
      v.literal("revoke"),
      v.literal("expire"),
      v.literal("connect"),
      v.literal("disconnect")
    ),
    actorUserId: v.string(),
    actorRole: v.string(),
    details: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_entry_id", ["entryId"])
    .index("by_business_id", ["businessId"])
    .index("by_integration", ["integrationName"]),

  // Billing Events (REQ-5.1)
  // Per-call/per-order billing events for usage aggregation
  billingEvents: defineTable({
    eventId: v.string(),
    businessId: v.string(),
    vertical: verticalValidator,
    eventType: v.union(v.literal("call_completed"), v.literal("order_placed")),
    durationSeconds: v.optional(v.number()),
    outcome: v.optional(v.string()),
    sourcePlatform: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_business_id", ["businessId"])
    .index("by_vertical", ["vertical"])
    .index("by_created_at", ["createdAt"]),

  // Webhook Deduplication (Req 8.7)
  // Tracks processed webhook event IDs for idempotent processing
  webhookDeduplication: defineTable({
    eventId: v.string(),
    provider: v.string(),
    processedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_event_and_provider", ["eventId", "provider"])
    .index("by_expires_at", ["expiresAt"]),

  // Invitations (team member invites with role assignment)
  // Requirements: 5.2, 9.1
  invitations: defineTable({
    email: v.string(),
    role: v.union(
      v.literal("branch_manager"),
      v.literal("supervisor")
    ),
    tenantId: v.string(),
    invitedBy: v.string(),
    inviteToken: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired"),
      v.literal("revoked")
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_invite_token", ["inviteToken"])
    .index("by_email", ["email"])
    .index("by_tenant_id", ["tenantId"])
    .index("by_status", ["status"]),

  // Password Reset Tokens (time-limited reset tokens)
  // Requirements: 5.2, 9.1
  passwordResetTokens: defineTable({
    email: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
    used: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_email", ["email"])
    .index("by_expires_at", ["expiresAt"]),

  // Phone Numbers (dedicated per-branch phone number provisioning)
  // Requirements: 1.1, 1.2, 1.3, 1.4
  phoneNumbers: defineTable({
    numberId: v.string(),
    phoneNumber: v.string(),
    provider: v.string(),
    status: v.union(
      v.literal("available"),
      v.literal("assigned"),
      v.literal("releasing"),
      v.literal("released"),
      v.literal("quarantined"),
      v.literal("failed")
    ),
    capabilities: v.array(v.union(
      v.literal("voice"),
      v.literal("sms"),
      v.literal("mms"),
      v.literal("fax")
    )),
    region: v.string(),
    countryCode: v.string(),
    createdAt: v.number(),
    // Assignment fields (optional)
    assignedToType: v.optional(v.union(v.literal("branch"), v.literal("location"))),
    assignedToId: v.optional(v.string()),
    assignedAt: v.optional(v.number()),
    releasedAt: v.optional(v.number()),
    // Lifecycle fields (optional)
    quarantineExpiresAt: v.optional(v.number()),
    providerNumberSid: v.optional(v.string()),
    monthlyCost: v.optional(v.number()),
    currency: v.optional(v.string()),
    lastHealthCheckAt: v.optional(v.number()),
    healthStatus: v.optional(v.union(
      v.literal("healthy"),
      v.literal("degraded"),
      v.literal("unreachable")
    )),
  })
    .index("by_number_id", ["numberId"])
    .index("by_phone_number", ["phoneNumber"])
    .index("by_status", ["status"])
    .index("by_assigned_to", ["assignedToType", "assignedToId"])
    .index("by_provider", ["provider"])
    .index("by_quarantine_expires", ["quarantineExpiresAt"]),

  // Provisioning Requests (tracking in-flight number acquisition attempts)
  // Requirements: 1.5, 1.6
  provisioningRequests: defineTable({
    requestId: v.string(),
    branchId: v.optional(v.string()),
    locationId: v.optional(v.string()),
    targetType: v.union(v.literal("branch"), v.literal("location")),
    provider: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed")
    ),
    region: v.string(),
    countryCode: v.string(),
    attemptCount: v.number(),
    maxAttempts: v.number(),
    lastError: v.optional(v.string()),
    phoneNumberId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_request_id", ["requestId"])
    .index("by_branch_id", ["branchId"])
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),

  // Runsheet integration configuration (Dinee-owned)
  // Per-tenant Runsheet integration configuration. Kept as a dedicated table
  // (rather than nesting under restaurants.integrations) because Runsheet
  // tenants are platform tenants, not restaurants. This is configuration Dinee
  // owns; it is NOT order-of-record data (that lives in the Runsheet backend).
  // Requirements: 8.1, 8.4, 9.1, 9.2 (dinee-voice-platform)
  runsheetIntegrations: defineTable({
    // Dinee platform tenant that owns this integration
    tenantId: v.string(),
    // Intake_Contract target base URL (Req 8.1)
    baseUrl: v.string(),
    // Runsheet-side tenant identifier used for tenant match (Req 8.1, 11.4)
    runsheetTenantId: v.string(),
    // API key stored AES-256-GCM encrypted (Req 8.1, 8.2)
    apiKeyEncrypted: v.string(),
    // Last 4 chars of the API key for masked display (Req 8.3)
    apiKeyLast4: v.string(),
    // HMAC secret for signing the Intake_Contract, encrypted (Req 8.1, 11.1)
    webhookSecretEncrypted: v.string(),
    // Default review mode; exactly one of the two allowed values (Req 8.4)
    defaultReviewMode: v.union(
      v.literal("always_review"),
      v.literal("auto_submit_low_risk")
    ),
    // Conversation types this tenant is allowed to use (Req 8.1, 9.5)
    allowedConversationTypes: v.array(v.string()),
    // Auto_Submit config stored internally in MVP; no UI toggle surfaced (Req 9.2)
    autoSubmitEnabled: v.boolean(),
    // Confidence threshold for auto-submit-low-risk (Req 13.1, later phase)
    confidenceThreshold: v.optional(v.number()),
    // Per-tenant purchase-order requirement. Feeds the fuel-intake slot
    // builder's RunsheetTenantConfig so the po_number slot is required for this
    // tenant when true (Req 5.6). Optional for backward compatibility with
    // integrations stored before this field existed.
    requiresPurchaseOrder: v.optional(v.boolean()),
    // Escalation target: exactly one of phone, email, or webhook (Req 9.4)
    escalationTarget: v.optional(
      v.object({
        kind: v.union(
          v.literal("phone"),
          v.literal("email"),
          v.literal("webhook")
        ),
        value: v.string(),
      })
    ),
    // Connection status of the integration
    status: v.union(
      v.literal("connected"),
      v.literal("disconnected"),
      v.literal("error")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant_id", ["tenantId"])
    .index("by_runsheet_tenant_id", ["runsheetTenantId"]),

  // Runsheet phone-number -> conversation-type mapping (Dinee-owned)
  // The routing mapping Dinee owns (Req 20.1). A tenant can map multiple numbers.
  // Requirements: 9.1, 9.2 (dinee-voice-platform)
  runsheetNumberAssignments: defineTable({
    // Dinee platform tenant that owns this assignment
    tenantId: v.string(),
    // Dinee-managed phone number being assigned
    phoneNumber: v.string(),
    // Conversation type; must be in the tenant's allowedConversationTypes (Req 9.5, 9.6)
    conversationType: v.string(),
    createdAt: v.number(),
  })
    .index("by_tenant_id", ["tenantId"])
    .index("by_phone_number", ["phoneNumber"]),

  // Generic multi-platform integration configuration (Dinee-owned)
  // Supersedes runsheetIntegrations as the config-driven, multi-platform store.
  // Kept ADDITIVELY alongside runsheetIntegrations during the staged rollout so
  // live Runsheet traffic is never disrupted. Keyed by (platformId, tenantId).
  // Credentials are stored as AES-256-GCM ciphertext in a name-keyed map so any
  // platform's credential set fits without schema changes. This is integration
  // CONFIGURATION Dinee owns; it is NOT order-of-record data.
  // Requirements: 2.1, 8.2, 8.3 (multi-platform-voice-integrations)
  integrations: defineTable({
    platformId: v.string(), // Req 2.1 — registered Platform_Id
    tenantId: v.string(), // Req 2.1 — Dinee tenant
    baseUrl: v.string(), // Req 2.1
    platformTenantId: v.string(), // platform-side tenant id (e.g. Runsheet tenant)
    // AES-256-GCM ciphertext keyed by credential name (Req 2.2). For Runsheet:
    // { api_key: <ct>, webhook_secret: <ct> } — migrated ciphertext preserved as-is.
    credentialsEncrypted: v.record(v.string(), v.string()),
    // Last-4 preview per credential for masked display + audit (Req 2.8, 12.4).
    credentialsLast4: v.record(v.string(), v.string()),
    allowedConversationTypes: v.array(v.string()), // Req 4.3
    // Arbitrary platform config (defaultReviewMode, autoSubmitEnabled,
    // confidenceThreshold, requiresPurchaseOrder, escalationTarget, ...).
    config: v.any(),
    status: v.union( // Req 2.6, 8.2, 8.3
      v.literal("connected"),
      v.literal("disconnected"),
      v.literal("error")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_platform_tenant", ["platformId", "tenantId"])
    .index("by_tenant_id", ["tenantId"]),

  // Generic phone-number -> route mapping (Dinee-owned)
  // Supersedes runsheetNumberAssignments. Maps an inbound "To" number to a
  // (platformId, tenantId, conversationType). Kept ADDITIVELY during rollout.
  // Requirements: 4.1, 4.3 (multi-platform-voice-integrations)
  phoneRoutes: defineTable({
    phoneNumber: v.string(), // inbound "To" number
    platformId: v.string(), // Req 4.1
    tenantId: v.string(), // Req 4.1
    conversationType: v.string(), // Req 4.1 — must be in tenant's allowed set (Req 4.3)
    createdAt: v.number(),
  })
    .index("by_phone_number", ["phoneNumber"])
    .index("by_platform_tenant", ["platformId", "tenantId"]),

  // Append-only credential-test history (Dinee-owned, Control Plane)
  //
  // One row is appended per completed Credential_Test, recording the outcome and
  // completion timestamp for an integration identified by (platformId, tenantId)
  // ONLY. No credential value is ever stored (platform-control-plane Req 8.2,
  // 8.3, 8.4, 11). Append-only: no update/delete mutations are exposed. Reads
  // take the <=100 most-recent rows via the time index in descending order.
  credentialTestHistory: defineTable({
    platformId: v.string(), // reference by pair only (Req 8.4)
    tenantId: v.string(),
    outcome: v.union(v.literal("success"), v.literal("failure")), // Req 8.2
    completedAt: v.number(), // epoch ms; whole-second UTC for display (Req 8.2)
  })
    .index("by_platform_tenant", ["platformId", "tenantId"])
    // Enables most-recent-first pagination without an in-memory sort (Req 8.3).
    .index("by_platform_tenant_time", ["platformId", "tenantId", "completedAt"]),

  // Per-agent monitoring metrics (Dinee-owned, later phase — Requirement 16)
  //
  // One row is written per completed call by the Monitoring_Service (Req 16.1).
  // Storing per-call rows (rather than pre-aggregated counters) keeps the write
  // path append-only and lets the windowed rate computation (Req 16.2) derive
  // tool-failure / fallback / review-required / Auto_Submit rates by scanning
  // rows over a reporting window. This is Dinee-owned monitoring data — it is
  // NOT order-of-record data (that lives in the Runsheet backend).
  //
  // Requirements: 16.1 (dinee-voice-platform)
  agentMetrics: defineTable({
    // Dinee platform tenant that owns this metric row. Enables tenant-scoped
    // metrics for a Runsheet_Admin (Req 16.3) and all-tenant metrics for a
    // platform operator (Req 16.4).
    tenantId: v.string(),
    // The active agent identity. Agents are identified by conversation type in
    // this platform, so `conversationType` is the per-agent grouping key
    // (Req 16.1, 16.2).
    conversationType: v.string(),
    // The completed call this metric row describes (Twilio callSid).
    callId: v.string(),
    // Calls-received count contributed by this row (normally 1). Kept explicit
    // so windowed aggregation can sum received vs. completed (Req 16.1, 16.2).
    callsReceived: v.number(),
    // Calls-completed count contributed by this row (1 when the call reached a
    // completed state, 0 otherwise) (Req 16.1).
    callsCompleted: v.number(),
    // Call duration in milliseconds (Req 16.1).
    durationMs: v.number(),
    // Number of successful tool invocations during the call (Req 16.1).
    toolSuccessCount: v.number(),
    // Number of failed tool invocations during the call (Req 16.1).
    toolFailureCount: v.number(),
    // Whether a fallback behavior occurred during the call (Req 16.1).
    fallbackOccurred: v.boolean(),
    // Whether the call's outcome required dispatcher review (Req 16.1).
    reviewRequired: v.boolean(),
    // The Auto_Submit outcome for the call (Req 16.1). `auto_submitted` when the
    // draft was auto-submitted, `not_eligible` when auto-submit was considered
    // but the eligibility conjunction failed, and `not_applicable` when the
    // tenant/agent is in review-only mode (the MVP default).
    autoSubmitOutcome: v.union(
      v.literal("auto_submitted"),
      v.literal("not_eligible"),
      v.literal("not_applicable")
    ),
    createdAt: v.number(),
  })
    .index("by_tenant_id", ["tenantId"])
    .index("by_agent", ["tenantId", "conversationType"])
    .index("by_created_at", ["createdAt"]),

  // Per-agent alerting (Dinee-owned, later phase — Requirement 17).
  //
  // The Monitoring_Service raises an alert row when a monitored condition
  // breaches its configured threshold over the reporting window. Five alert
  // conditions are covered:
  //   - `dependency_failure`   — a dependency on OpenAI, Twilio, or the
  //                              Runsheet_Backend is unreachable (Req 17.1).
  //   - `low_confidence_rate`  — the low-confidence rate exceeds its threshold
  //                              over the window (Req 17.2).
  //   - `review_required_rate` — the review-required rate exceeds its
  //                              threshold over the window (Req 17.3).
  //   - `tool_rejection_rate`  — a tenant's tool-rejection rate exceeds its
  //                              threshold over the window (Req 17.4).
  //   - `auth_failure_rate`    — a tenant's authentication-failure rate
  //                              exceeds its threshold over the window
  //                              (Req 17.5).
  //
  // The rate-based rows are the persisted output of the pure evaluator in
  // `src/lib/monitoring/alertRules.ts`, which is fed the windowed rates derived
  // from `agentMetrics` (Req 16 / task 15.1). This is Dinee-owned monitoring
  // data — it is NOT order-of-record data (that lives in the Runsheet backend).
  //
  // Requirements: 17.1, 17.2, 17.3, 17.4, 17.5 (dinee-voice-platform)
  agentAlerts: defineTable({
    // Dinee platform tenant this alert is scoped to. Tenant-level threshold
    // breaches (tool-rejection, auth-failure) identify the tenant (Req 17.4,
    // 17.5); platform-wide conditions (dependency failure, low-confidence,
    // review-required) may use a platform sentinel tenant id.
    tenantId: v.string(),
    // Which monitored condition breached (Req 17.1–17.5).
    alertType: v.union(
      v.literal("dependency_failure"),
      v.literal("low_confidence_rate"),
      v.literal("review_required_rate"),
      v.literal("tool_rejection_rate"),
      v.literal("auth_failure_rate")
    ),
    // Alert severity. Dependency failures are `critical`; rate-threshold
    // breaches are `warning` by default.
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical")
    ),
    // Human-readable subject of the alert — the failed dependency name for a
    // dependency failure, or the breached rate name for a rate rule.
    subject: v.string(),
    // The specific failed dependency, set only for `dependency_failure`
    // (Req 17.1).
    dependency: v.optional(
      v.union(
        v.literal("openai"),
        v.literal("twilio"),
        v.literal("runsheet")
      )
    ),
    // The configured threshold that was breached, set for rate rules
    // (Req 17.2–17.5). Absent for dependency failures, which are not
    // rate-based.
    threshold: v.optional(v.number()),
    // The observed value over the window that breached the threshold, set for
    // rate rules (Req 17.2–17.5).
    observedValue: v.optional(v.number()),
    // Start of the reporting window (epoch ms) the alert was evaluated over.
    windowStart: v.number(),
    // End of the reporting window (epoch ms) the alert was evaluated over.
    windowEnd: v.number(),
    // Human-readable alert message identifying the failed dependency or the
    // breached rate (and the tenant, for tenant-scoped rates).
    message: v.string(),
    createdAt: v.number(),
    // Whether the alert has been resolved. Defaults to unresolved (false/absent)
    // on creation.
    resolved: v.optional(v.boolean()),
  })
    .index("by_tenant_id", ["tenantId"])
    .index("by_type", ["alertType"])
    .index("by_created_at", ["createdAt"]),
});
