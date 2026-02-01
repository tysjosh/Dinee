# Implementation Plan: Nigeria Market Pivot

## Overview

This implementation plan covers the evolution of the restaurant call management platform to support the Nigerian market. The plan is organized into three phases over 12 weeks, with additional scale tasks for 6-12 month horizons. Tasks are structured to build incrementally, with each task building on previous work.

## Tasks

### Phase 1: Platform Core & Multi-Tenancy (Weeks 1-4)

- [x] 1. Extend Convex schema for multi-tenancy
  - [x] 1.1 Add platforms table with platformId, name, settings, createdAt fields
    - Create `convex/platforms.ts` with CRUD operations
    - Add index on platformId
    - _Requirements: 1.1_
  
  - [x] 1.2 Add users table with role-based fields
    - Create `convex/users.ts` with userId, email, passwordHash, role, tenantType, tenantId
    - Add indexes on userId, email, and tenant
    - _Requirements: 2.1, 2.2_
  
  - [x] 1.3 Add branches table with location fields
    - Create `convex/branches.ts` with branchId, restaurantId, name, address, phoneNumber, operatingHours, isActive
    - Add indexes on branchId and restaurantId
    - _Requirements: 1.3_
  
  - [x] 1.4 Extend restaurants table with platformId and branchCount
    - Update `convex/schema.ts` to add platformId foreign key
    - Add index on platformId
    - _Requirements: 1.2_
  
  - [x] 1.5 Extend existing tables with tenant fields
    - Add branchId to calls, orders, menuItems tables
    - Add indexes on branchId fields
    - _Requirements: 1.5, 1.7_

- [x] 2. Implement tenant isolation and RBAC
  - [x] 2.1 Create TenantContext and TenantProvider
    - Create `src/contexts/TenantContext.tsx` with platform, restaurant, branch state
    - Implement tenant scope resolution based on user role
    - _Requirements: 1.6_

  - [x] 2.2 Implement TenantGuard utility
    - Create `src/lib/tenant/TenantGuard.ts` with canAccess and filterQuery methods
    - Implement role permission matrix from design
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7_
  
  - [ ]* 2.3 Write property test for tenant data isolation
    - **Property 1: Tenant Data Isolation**
    - **Validates: Requirements 1.6, 1.8**
  
  - [ ]* 2.4 Write property test for RBAC enforcement
    - **Property 2: Role-Based Access Control Enforcement**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7, 2.8**

- [x] 3. Checkpoint - Ensure tenant isolation tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement restaurant onboarding with branch support
  - [x] 4.1 Create BranchSetup component
    - Create `src/components/onboarding/BranchSetup.tsx`
    - Implement form for branch name, address, phone, operating hours
    - Add validation for required fields
    - _Requirements: 3.1, 3.3_
  
  - [x] 4.2 Extend RestaurantSetup for multi-branch
    - Update `src/components/onboarding/RestaurantSetup.tsx` to support multiple branches
    - Add "Add Branch" functionality during onboarding
    - _Requirements: 3.2_
  
  - [x] 4.3 Implement transactional restaurant+branch creation
    - Update `src/hooks/useRestaurantStorage.ts` to create restaurant and default branch atomically
    - Ensure rollback on failure
    - _Requirements: 1.4, 3.5_
  
  - [ ]* 4.4 Write property test for default branch creation
    - **Property 3: Restaurant Creation Creates Default Branch**
    - **Validates: Requirements 1.4, 3.5**

- [x] 5. Implement menu import pipeline
  - [x] 5.1 Create MenuImportService
    - Create `src/lib/menu/MenuImportService.ts`
    - Implement CSV parsing with Papa Parse or similar
    - Implement Google Sheets URL fetching
    - _Requirements: 4.1, 4.2_
  
  - [x] 5.2 Create MenuValidator
    - Create `src/lib/menu/MenuValidator.ts`
    - Implement validation rules for name, price, description, modifiers
    - Implement Naira price format parsing
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  
  - [ ]* 5.3 Write property test for menu validation
    - **Property 4: Menu Import Validation Completeness**
    - **Validates: Requirements 4.3, 4.4, 5.1, 5.2, 5.3, 5.5, 5.7**
  
  - [ ]* 5.4 Write property test for Naira price parsing
    - **Property 7: Naira Price Format Parsing**
    - **Validates: Requirements 4.4, 5.3**
  
  - [ ]* 5.5 Write property test for modifier string round-trip
    - **Property 8: Modifier String Round-Trip**
    - **Validates: Requirements 4.5**
  
  - [x] 5.6 Create MenuImport UI component
    - Create `src/components/onboarding/MenuImport.tsx`
    - Implement file upload and Google Sheets URL input
    - Display validation errors and retry option
    - _Requirements: 4.7, 4.9, 4.10_
  
  - [x] 5.7 Add menuImports table and retry logic
    - Create `convex/menuImports.ts` for tracking import status
    - Implement retry for failed rows only
    - _Requirements: 4.6, 4.8_
  
  - [ ]* 5.8 Write property test for import retry idempotence
    - **Property 6: Menu Import Retry Idempotence**
    - **Validates: Requirements 4.8**

- [x] 6. Checkpoint - Ensure menu import tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement platform dashboard
  - [x] 7.1 Create AnalyticsService
    - Create `src/lib/analytics/AnalyticsService.ts`
    - Implement getDashboardMetrics with tenant filtering
    - Calculate totalCalls, totalOrders, missedCalls, conversionRate, averageOrderValue
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  
  - [ ]* 7.2 Write property test for dashboard metrics calculation
    - **Property 25: Dashboard Metrics Calculation Accuracy**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
  
  - [x] 7.3 Create PlatformDashboard component
    - Create `src/components/dashboard/PlatformDashboard.tsx`
    - Display metrics cards with trend indicators
    - Implement filter controls for platform/restaurant/branch/date
    - _Requirements: 6.6, 6.7, 6.8, 6.9_
  
  - [x] 7.4 Implement CSV export functionality
    - Create `src/lib/analytics/ExportService.ts`
    - Implement exportToCSV for calls and orders data
    - Format timestamps as ISO 8601, currency with ₦ prefix
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  
  - [ ]* 7.5 Write property test for CSV export format
    - **Property 26: CSV Export Format Compliance**
    - **Validates: Requirements 7.1, 7.2, 7.4, 7.5, 7.6**

- [x] 8. Checkpoint - Phase 1 complete
  - Ensure all tests pass, ask the user if questions arise.


### Phase 2: Nigeria-Ready Commerce & Messaging (Weeks 5-8)

- [x] 9. Implement payment service infrastructure
  - [x] 9.1 Extend orders schema with payment fields
    - Update `convex/schema.ts` to add paymentMethod, paymentStatus, paymentReference, paymentTimestamp
    - Add index on paymentStatus
    - _Requirements: 8.1, 8.2_
  
  - [x] 9.2 Create PaymentService interface and types
    - Create `src/lib/payment/types.ts` with PaymentProvider, PaymentInitResult, PaymentVerifyResult interfaces
    - Define PaymentMethod and PaymentStatus types
    - _Requirements: 8.2_
  
  - [x] 9.3 Create webhookEvents table
    - Create `convex/webhookEvents.ts` for logging webhook events
    - Add indexes on eventId and orderId
    - _Requirements: 8.4_

- [x] 10. Implement Paystack integration
  - [x] 10.1 Create PaystackProvider
    - Create `src/lib/payment/PaystackProvider.ts`
    - Implement initializeTransaction using Paystack API
    - Implement verifyTransaction for payment verification
    - _Requirements: 8.3_
  
  - [x] 10.2 Create Paystack webhook handler
    - Create `src/app/api/webhooks/paystack/route.ts`
    - Implement signature verification using Paystack secret
    - Process payment success/failure events
    - _Requirements: 8.4, 8.5, 8.6, 8.7, 8.9_
  
  - [ ]* 10.3 Write property test for payment status state machine
    - **Property 9: Payment Status State Machine**
    - **Validates: Requirements 8.2, 8.6, 8.7, 9.4, 9.5**
  
  - [ ]* 10.4 Write property test for webhook signature verification
    - **Property 10: Payment Webhook Signature Verification**
    - **Validates: Requirements 8.5, 8.9, 9.3**

- [x] 11. Implement Flutterwave integration
  - [x] 11.1 Create FlutterwaveProvider
    - Create `src/lib/payment/FlutterwaveProvider.ts`
    - Implement initializeTransaction using Flutterwave API
    - Implement verifyTransaction for payment verification
    - _Requirements: 9.1_
  
  - [x] 11.2 Create Flutterwave webhook handler
    - Create `src/app/api/webhooks/flutterwave/route.ts`
    - Implement webhook verification using Flutterwave endpoint
    - Process payment success/failure events
    - _Requirements: 9.2, 9.3, 9.4, 9.5_

- [x] 12. Implement COD payment flow
  - [x] 12.1 Add COD payment method support
    - Update PaymentService to handle COD orders
    - Set initial paymentStatus to "pending" for COD
    - _Requirements: 10.1_
  
  - [x] 12.2 Create COD collection UI
    - Add COD indicator badge to order cards
    - Implement payment collection confirmation dialog
    - _Requirements: 10.2, 10.3, 10.4, 10.5_
  
  - [x] 12.3 Implement COD reconciliation
    - Track daily COD collections per branch
    - Display COD summary in branch dashboard
    - _Requirements: 10.6, 10.7_
  
  - [ ]* 12.4 Write property test for COD collection tracking
    - **Property 11: COD Payment Collection Tracking**
    - **Validates: Requirements 10.4, 10.6**

- [x] 13. Checkpoint - Ensure payment tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement WhatsApp messaging service
  - [x] 14.1 Create customerPreferences table
    - Create `convex/customerPreferences.ts` with phoneNumber, whatsappOptIn, smsOptIn
    - Add index on phoneNumber
    - _Requirements: 13.1_
  
  - [x] 14.2 Create MessagingService
    - Create `src/lib/messaging/MessagingService.ts`
    - Implement WhatsApp Business API integration
    - Implement message template rendering
    - _Requirements: 11.4, 12.5_
  
  - [x] 14.3 Implement order confirmation messages
    - Send WhatsApp confirmation on order creation
    - Include orderId, restaurant name, items, total, estimated time
    - Implement retry with exponential backoff
    - _Requirements: 11.2, 11.3, 11.5, 11.6_
  
  - [x] 14.4 Implement status update messages
    - Send messages on status changes: preparing, dispatched, delivered, cancelled
    - Include relevant details (rider name, cancellation reason)
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  
  - [ ]* 14.5 Write property test for WhatsApp opt-in respect
    - **Property 12: WhatsApp Opt-In Respect**
    - **Validates: Requirements 11.2, 12.1, 12.2, 12.3, 12.4, 13.7**

- [x] 15. Implement opt-in/opt-out management
  - [x] 15.1 Create WhatsApp webhook handler
    - Create `src/app/api/webhooks/whatsapp/route.ts`
    - Handle incoming STOP/START keywords
    - Update customer preferences accordingly
    - _Requirements: 13.3, 13.4, 13.5, 13.6_
  
  - [x] 15.2 Add opt-in prompt to order flow
    - Prompt for WhatsApp consent on first order
    - Store preference in customerPreferences table
    - _Requirements: 13.2_
  
  - [ ]* 15.3 Write property test for opt-out state change
    - **Property 13: WhatsApp Opt-Out State Change**
    - **Validates: Requirements 13.4, 13.6**

- [x] 16. Implement delivery tracking
  - [x] 16.1 Extend orders schema with delivery fields
    - Add deliveryStatus, riderId, riderName, dispatchedAt, deliveredAt, deliveryFailureReason
    - Add index on deliveryStatus
    - _Requirements: 14.1, 14.2_
  
  - [x] 16.2 Create DeliveryService
    - Create `src/lib/delivery/DeliveryService.ts`
    - Implement assignRider, updateStatus, getDeliveryInfo methods
    - _Requirements: 14.3, 14.4, 14.5, 14.7_
  
  - [x] 16.3 Create delivery status UI
    - Display orders grouped by delivery status in branch dashboard
    - Show average delivery time metrics
    - _Requirements: 14.6, 14.7_
  
  - [ ]* 16.4 Write property test for delivery status state machine
    - **Property 14: Delivery Status State Machine**
    - **Validates: Requirements 14.2, 14.3, 14.4, 14.5, 14.8**

- [x] 17. Implement rider API
  - [x] 17.1 Create rider API routes
    - Create `src/app/api/rider/status/route.ts`
    - Implement authentication via API key
    - Implement status update endpoint
    - _Requirements: 15.1, 15.2, 15.4, 15.5_
  
  - [x] 17.2 Implement rider authorization
    - Validate rider is assigned to order before allowing update
    - Return 403 for unauthorized attempts
    - _Requirements: 15.3, 15.7_
  
  - [ ]* 17.3 Write property test for rider API authorization
    - **Property 15: Rider API Authorization**
    - **Validates: Requirements 15.3, 15.7**

- [x] 18. Checkpoint - Phase 2 complete
  - Ensure all tests pass, ask the user if questions arise.


### Phase 3: Localization & Operational Scaling (Weeks 9-12)

- [x] 19. Implement Nigerian voice support
  - [x] 19.1 Create VoiceService abstraction
    - Create `src/lib/voice/VoiceService.ts`
    - Define ASRProvider interface for provider abstraction
    - Implement language preference configuration
    - _Requirements: 16.1, 16.2, 17.1, 17.2_
  
  - [x] 19.2 Add Nigerian English language option
    - Update languagePreference enum to include "nigerian_english"
    - Configure ASR with Nigerian English acoustic model
    - _Requirements: 16.2, 16.3_
  
  - [x] 19.3 Add Pidgin language option
    - Update languagePreference enum to include "pidgin"
    - Configure ASR with Pidgin language model
    - Implement Pidgin phrase dictionary
    - _Requirements: 17.2, 17.3, 17.4_
  
  - [x] 19.4 Implement confidence tracking
    - Log ASR confidence scores for all transcriptions
    - Store languageDetected in calls table
    - _Requirements: 16.4, 16.5_

- [x] 20. Implement confidence-based fallback
  - [x] 20.1 Create FallbackService
    - Create `src/lib/voice/FallbackService.ts`
    - Implement shouldTriggerFallback based on confidence threshold
    - Implement initiateFallback to WhatsApp/SMS
    - _Requirements: 18.1, 18.2, 18.3_
  
  - [x] 20.2 Implement conversation context transfer
    - Transfer call context to messaging channel on fallback
    - Maintain order state across channels
    - _Requirements: 18.4_
  
  - [x] 20.3 Add fallback metrics to dashboard
    - Track fallback rate per branch
    - Display in branch dashboard
    - _Requirements: 18.5, 18.6_
  
  - [ ]* 20.4 Write property test for fallback trigger
    - **Property 16: ASR Confidence Fallback Trigger**
    - **Validates: Requirements 18.1, 18.2**

- [x] 21. Implement telecom provider routing
  - [x] 21.1 Create ProviderRoutingService
    - Create `src/lib/voice/ProviderRoutingService.ts`
    - Implement provider selection based on routing rules
    - Support primary/secondary provider configuration
    - _Requirements: 19.1, 19.2, 19.3_
  
  - [x] 21.2 Implement automatic failover
    - Detect provider failure and switch to secondary
    - Log provider selection and call quality metrics
    - _Requirements: 19.4, 19.5_
  
  - [ ]* 21.3 Write property test for provider failover
    - **Property 17: Telecom Provider Failover**
    - **Validates: Requirements 19.4**
  
  - [x] 21.4 Add provider metrics to dashboard
    - Display call quality metrics by provider
    - Support A/B testing comparison
    - _Requirements: 19.6, 19.7_

- [x] 22. Implement monitoring and observability
  - [x] 22.1 Create MonitoringService
    - Create `src/lib/monitoring/MonitoringService.ts`
    - Track API endpoint response times
    - Track database query latencies
    - Track external service response times
    - _Requirements: 20.1, 20.2, 20.3_
  
  - [x] 22.2 Implement alerting
    - Define SLA thresholds (99.9% uptime, <500ms response)
    - Trigger alerts on threshold breach
    - Support email and Slack notifications
    - _Requirements: 20.4, 20.5, 20.6, 20.8_
  
  - [x] 22.3 Create monitoring dashboard
    - Display real-time and historical metrics
    - Show uptime and latency trends
    - _Requirements: 20.7_

- [x] 23. Checkpoint - Phase 3 complete
  - Ensure all tests pass, ask the user if questions arise.

### Scale Tasks (6-12 Months)

- [x] 24. Implement partner API
  - [x] 24.1 Create API authentication
    - Implement OAuth 2.0 for partner applications
    - Create API key management in dashboard
    - _Requirements: 21.2, 21.3_
  
  - [x] 24.2 Create partner API endpoints
    - Expose REST endpoints for restaurants, branches, menus, orders, calls
    - Implement proper error responses
    - _Requirements: 21.1, 21.4_
  
  - [x] 24.3 Implement rate limiting
    - Enforce 1000 requests per minute per API key
    - Return 429 on rate limit exceeded
    - _Requirements: 21.8_
  
  - [ ]* 24.4 Write property test for rate limiting
    - **Property 18: API Rate Limiting**
    - **Validates: Requirements 21.8**
  
  - [x] 24.5 Implement webhook delivery
    - Create webhook system for order and call events
    - Implement retry with exponential backoff (5 retries)
    - _Requirements: 21.5, 21.6_
  
  - [ ]* 24.6 Write property test for webhook retry
    - **Property 19: Webhook Retry with Exponential Backoff**
    - **Validates: Requirements 21.6**
  
  - [x] 24.7 Create partner dashboard
    - Display API usage metrics
    - Show webhook delivery status
    - _Requirements: 21.7_

- [x] 25. Implement advanced analytics
  - [x] 25.1 Create order funnel tracking
    - Track funnel stages: call_started, order_initiated, payment_started, payment_completed, delivery_completed
    - Calculate conversion rates between stages
    - _Requirements: 22.1, 22.2, 22.3_
  
  - [ ]* 25.2 Write property test for funnel tracking
    - **Property 20: Order Funnel Stage Tracking**
    - **Validates: Requirements 22.1, 22.2, 22.3**
  
  - [x] 25.3 Create funnel analytics dashboard
    - Display drop-off counts and conversion rates
    - Support segmentation by restaurant, branch, time, payment method
    - _Requirements: 22.4, 22.5, 22.6, 22.7_
  
  - [x] 25.4 Implement funnel export
    - Export funnel data in CSV format
    - _Requirements: 22.8_

- [x] 26. Implement agent performance dashboard
  - [x] 26.1 Create AgentMetricsService
    - Calculate calls handled, average duration, conversion rate
    - Calculate ASR accuracy and fallback rate
    - _Requirements: 23.1, 23.2, 23.3, 23.5, 23.6_
  
  - [x] 26.2 Create agent performance UI
    - Display agent metrics with filtering
    - Compare performance across branches
    - _Requirements: 23.7, 23.8_

- [x] 27. Implement upsell prompt library
  - [x] 27.1 Create prompts table and service
    - Create `convex/prompts.ts` with trigger conditions
    - Implement prompt matching logic
    - _Requirements: 24.1, 24.2_
  
  - [x] 27.2 Integrate prompts with AI agent
    - Deliver prompts when trigger conditions match
    - Track prompt delivery and acceptance
    - _Requirements: 24.3, 24.6_
  
  - [ ]* 27.3 Write property test for prompt trigger matching
    - **Property 21: Upsell Prompt Trigger Matching**
    - **Validates: Requirements 24.3**
  
  - [x] 27.4 Create prompt management UI
    - Allow creating, editing, deactivating prompts
    - Include pre-built templates
    - _Requirements: 24.4, 24.5_
  
  - [x] 27.5 Add upsell analytics
    - Display upsell revenue attribution
    - Support A/B testing of prompt variations
    - _Requirements: 24.7, 24.8_

- [x] 28. Implement fraud detection
  - [x] 28.1 Create fraudSignals table
    - Track repeated_failed_payments, high_cancellation_rate, unusual_order_pattern
    - Maintain blocklist of phone numbers
    - _Requirements: 25.1, 25.3_
  
  - [x] 28.2 Implement fraud signal detection
    - Detect and flag suspicious patterns
    - Support configurable thresholds
    - _Requirements: 25.2, 25.8_
  
  - [x] 28.3 Implement call blocking
    - Reject or require verification for blocklisted numbers
    - _Requirements: 25.4_
  
  - [ ]* 28.4 Write property test for fraud blocking
    - **Property 22: Fraud Signal Blocking**
    - **Validates: Requirements 25.4**
  
  - [x] 28.5 Create fraud review dashboard
    - Display flagged customers and signal details
    - Allow manual review and disposition
    - _Requirements: 25.5, 25.6, 25.7_

- [x] 29. Implement self-serve onboarding and billing
  - [x] 29.1 Create self-serve signup flow
    - Allow restaurant owners to sign up without admin
    - Collect business verification documents
    - _Requirements: 26.1, 26.2_
  
  - [x] 29.2 Implement subscription billing
    - Define subscription plans with feature tiers
    - Integrate with Paystack/Flutterwave for billing
    - _Requirements: 26.3, 26.4_
  
  - [x] 29.3 Create billing dashboard
    - Display current plan, usage, billing history
    - Send billing reminders
    - _Requirements: 26.5, 26.6_
  
  - [x] 29.4 Implement payment failure handling
    - Retry failed payments
    - Downgrade on persistent failure
    - _Requirements: 26.7, 26.8_

- [x] 30. Implement multi-location order routing
  - [x] 30.1 Create OrderRoutingService
    - Determine customer location from phone area code
    - Route to nearest active branch
    - _Requirements: 27.1, 27.2_
  
  - [x] 30.2 Implement routing logic
    - Consider operating hours and capacity
    - Offer alternatives if nearest unavailable
    - _Requirements: 27.3, 27.4, 27.5_
  
  - [ ]* 30.3 Write property test for proximity routing
    - **Property 23: Multi-Location Routing by Proximity**
    - **Validates: Requirements 27.2, 27.3, 27.4**
  
  - [x] 30.4 Add routing analytics
    - Display routing distribution across branches
    - Store routing decision in order record
    - _Requirements: 27.7, 27.8_

- [x] 31. Implement backward compatibility
  - [x] 31.1 Create migration utilities
    - Assign existing restaurants to default platform
    - Create default branch for each restaurant
    - _Requirements: 28.1, 28.2_
  
  - [x] 31.2 Migrate existing data
    - Preserve menu items, calls, orders, transcripts
    - Map restaurantId references to new structure
    - _Requirements: 28.3, 28.4_
  
  - [ ]* 31.3 Write property test for data preservation
    - **Property 24: Backward Compatibility Data Preservation**
    - **Validates: Requirements 28.2, 28.3, 28.4**
  
  - [x] 31.4 Implement feature flags
    - Support gradual migration with feature flags
    - Maintain backward compatible API endpoints
    - _Requirements: 28.5, 28.6_
  
  - [x] 31.5 Implement rollback capability
    - Support rollback within 30 days
    - Notify users of new features
    - _Requirements: 28.7, 28.8_

- [x] 32. Final checkpoint - All phases complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Phase 1 establishes the multi-tenant foundation required for all subsequent phases
- Phase 2 can begin once tenant isolation is verified
- Phase 3 can begin once payment and messaging are functional
- Scale tasks can be prioritized based on business needs
