import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
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
        v.union(v.literal("paystack"), v.literal("flutterwave"), v.literal("cod"))
      ),
      whatsappEnabled: v.boolean(),
      smsEnabled: v.boolean(),
    }),
    createdAt: v.number(),
  }).index("by_platform_id", ["platformId"]),

  // Users (role-based access control)
  users: defineTable({
    userId: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    role: v.union(
      v.literal("platform_admin"),
      v.literal("restaurant_owner"),
      v.literal("branch_manager"),
      v.literal("supervisor")
    ),
    tenantType: v.union(
      v.literal("platform"),
      v.literal("restaurant"),
      v.literal("branch")
    ),
    tenantId: v.string(),
    lastLoginAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user_id", ["userId"])
    .index("by_email", ["email"])
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
    .index("by_restaurant_id", ["restaurantId"]),

  // Restaurant (extended for multi-tenancy)
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
  })
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_platform_id", ["platformId"]),

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
      v.literal("cod")
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
    speaker: v.union(v.literal("human"), v.literal("ai"))
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
      v.literal("whatsapp")
    ),
    eventType: v.string(),
    payload: v.string(),
    signature: v.optional(v.string()),
    verified: v.boolean(),
    processed: v.boolean(),
    orderId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_order_id", ["orderId"]),

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
    .index("by_success", ["success"]),

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
      v.literal("cancelled"),
      v.literal("past_due"),
      v.literal("trialing")
    ),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    paymentProvider: v.union(
      v.literal("paystack"),
      v.literal("flutterwave")
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
      v.literal("flutterwave")
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
});
