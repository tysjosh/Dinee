# Requirements Document

## Introduction

This document defines the requirements for evolving the restaurant call management platform to support the Nigerian restaurant market. The pivot introduces multi-tenancy architecture, Nigerian payment integrations (Paystack, Flutterwave, COD), WhatsApp messaging workflows, Nigerian language support (Pidgin, Nigerian English), delivery tracking, and platform-level analytics. The implementation spans three phases over 12 weeks, with additional scale tasks for 6-12 month horizons.

## Glossary

- **Platform**: The top-level entity managing multiple restaurants across the system
- **Restaurant**: A business entity that may have one or more physical locations (branches)
- **Branch**: A physical location of a restaurant with its own menu, staff, and operations
- **Tenant**: Any entity in the hierarchy (Platform, Restaurant, or Branch) that owns data
- **Platform_Admin**: User with full system access across all restaurants and branches
- **Restaurant_Owner**: User who manages a restaurant and all its branches
- **Branch_Manager**: User who manages a single branch location
- **Supervisor**: Staff member with limited operational access within a branch
- **Paystack**: Nigerian payment gateway for card and bank transfer payments
- **Flutterwave**: Nigerian payment gateway supporting multiple payment methods
- **COD**: Cash-on-delivery payment method where customer pays upon order delivery
- **WhatsApp_Business_API**: Meta's API for sending transactional messages to customers
- **ASR**: Automatic Speech Recognition for converting voice to text
- **Pidgin**: Nigerian Pidgin English, a widely spoken creole language in Nigeria
- **Nigerian_English**: English with Nigerian accent patterns and local expressions
- **Naira**: Nigerian currency (₦) used for all pricing and transactions
- **Rider**: Delivery personnel responsible for transporting orders to customers
- **SLA**: Service Level Agreement defining performance and uptime targets

## Requirements

### Requirement 1: Multi-Tenant Data Architecture

**User Story:** As a platform administrator, I want a hierarchical tenant structure (Platform → Restaurant → Branch), so that I can manage multiple restaurant businesses with multiple locations from a single platform.

#### Acceptance Criteria

1. THE Schema SHALL define a `platforms` table with platformId, name, settings, and createdAt fields
2. THE Schema SHALL extend the `restaurants` table with platformId foreign key and branchCount field
3. THE Schema SHALL define a `branches` table with branchId, restaurantId, name, address, phoneNumber, operatingHours, and isActive fields
4. WHEN a new restaurant is created, THE System SHALL automatically create a default branch for that restaurant
5. THE Schema SHALL add tenantId (platformId, restaurantId, or branchId) to calls, orders, menuItems, and transcripts tables
6. WHEN querying data, THE System SHALL enforce tenant isolation by filtering on the appropriate tenantId
7. THE Schema SHALL define indexes on all tenantId fields for efficient querying
8. IF a tenant hierarchy violation is detected, THEN THE System SHALL reject the operation and return an authorization error

### Requirement 2: Role-Based Access Control

**User Story:** As a platform administrator, I want to assign different roles to users, so that each user has appropriate access levels for their responsibilities.

#### Acceptance Criteria

1. THE Schema SHALL define a `users` table with userId, email, passwordHash, role, tenantType, tenantId, and lastLoginAt fields
2. THE System SHALL support four roles: platform_admin, restaurant_owner, branch_manager, and supervisor
3. WHEN a platform_admin authenticates, THE System SHALL grant access to all restaurants and branches
4. WHEN a restaurant_owner authenticates, THE System SHALL grant access only to their restaurant and its branches
5. WHEN a branch_manager authenticates, THE System SHALL grant access only to their assigned branch
6. WHEN a supervisor authenticates, THE System SHALL grant read access to orders and calls within their branch
7. THE System SHALL validate role permissions before executing any data mutation
8. IF a user attempts an unauthorized action, THEN THE System SHALL return a 403 Forbidden response

### Requirement 3: Restaurant Onboarding with Branch Support

**User Story:** As a restaurant owner, I want to onboard my restaurant with multiple branch locations, so that I can manage all my locations from a single account.

#### Acceptance Criteria

1. WHEN a restaurant owner starts onboarding, THE Onboarding_Flow SHALL collect restaurant name, owner details, and primary branch information
2. THE Onboarding_Flow SHALL allow adding multiple branches during initial setup
3. WHEN adding a branch, THE System SHALL require branch name, address, phone number, and operating hours
4. THE Onboarding_Flow SHALL validate that all required fields are provided before proceeding
5. WHEN onboarding completes, THE System SHALL create the restaurant record and all branch records in a single transaction
6. THE Onboarding_Flow SHALL display a progress indicator showing completion percentage
7. IF onboarding fails, THEN THE System SHALL preserve entered data and allow retry from the failure point

### Requirement 4: CSV/Google Sheet Menu Import

**User Story:** As a restaurant owner, I want to import my menu from CSV or Google Sheets, so that I can quickly set up my menu without manual entry.

#### Acceptance Criteria

1. THE Menu_Import_Pipeline SHALL accept CSV files with columns: name, price, description, category, modifiers, isAvailable
2. THE Menu_Import_Pipeline SHALL accept Google Sheets URLs and fetch data via Google Sheets API
3. WHEN importing menu data, THE System SHALL validate that name and price fields are present for each item
4. WHEN importing prices, THE System SHALL validate Naira format (numeric value, optionally prefixed with ₦)
5. THE Menu_Import_Pipeline SHALL parse modifier strings in format "modifier1:price1,modifier2:price2"
6. WHEN validation fails for a row, THE System SHALL add the row to an error report with specific error messages
7. THE System SHALL display an error report showing failed rows, error reasons, and a retry option
8. WHEN retry is triggered, THE System SHALL re-process only the previously failed rows
9. THE Menu_Import_Pipeline SHALL support batch imports of up to 500 menu items per operation
10. WHEN import completes successfully, THE System SHALL display a summary of imported items by category

### Requirement 5: Menu Validation Rules

**User Story:** As a restaurant owner, I want the system to validate my menu data, so that I can ensure data quality and prevent errors.

#### Acceptance Criteria

1. THE Menu_Validator SHALL require name field with minimum 2 characters and maximum 100 characters
2. THE Menu_Validator SHALL require price field as positive numeric value
3. THE Menu_Validator SHALL validate price format accepts: "500", "500.00", "₦500", "₦500.00"
4. THE Menu_Validator SHALL validate category field against predefined categories or allow custom categories
5. THE Menu_Validator SHALL validate modifier prices are non-negative numeric values
6. IF duplicate menu item names exist within a branch, THEN THE Menu_Validator SHALL flag as warning (not error)
7. THE Menu_Validator SHALL validate description field does not exceed 500 characters
8. WHEN validation completes, THE System SHALL return a validation report with errors, warnings, and valid item count

### Requirement 6: Platform Dashboard Metrics

**User Story:** As a platform administrator, I want to view aggregated metrics across all restaurants, so that I can monitor platform health and business performance.

#### Acceptance Criteria

1. THE Platform_Dashboard SHALL display total calls count for the selected time period
2. THE Platform_Dashboard SHALL display total orders count and total order value in Naira
3. THE Platform_Dashboard SHALL display missed calls count (calls without associated orders)
4. THE Platform_Dashboard SHALL calculate and display conversion rate (orders / calls × 100)
5. THE Platform_Dashboard SHALL display average order value in Naira
6. THE Platform_Dashboard SHALL support filtering by: platform-wide, specific restaurant, specific branch
7. THE Platform_Dashboard SHALL support date range filtering with presets: today, yesterday, last 7 days, last 30 days, custom range
8. WHEN filters change, THE Dashboard SHALL update metrics within 2 seconds
9. THE Platform_Dashboard SHALL display a trend indicator (up/down arrow with percentage) comparing to previous period

### Requirement 7: Dashboard Export Functionality

**User Story:** As a platform administrator, I want to export dashboard data to CSV, so that I can perform offline analysis and share reports.

#### Acceptance Criteria

1. THE Export_Function SHALL generate CSV files for calls data with columns: callId, restaurantName, branchName, phoneNumber, startTime, duration, status, orderId
2. THE Export_Function SHALL generate CSV files for orders data with columns: orderId, restaurantName, branchName, customerName, items, totalAmount, status, paymentStatus, timestamp
3. WHEN export is triggered, THE System SHALL apply current dashboard filters to the exported data
4. THE Export_Function SHALL include a header row with column names
5. THE Export_Function SHALL format timestamps in ISO 8601 format
6. THE Export_Function SHALL format currency values with ₦ prefix
7. IF export data exceeds 10,000 rows, THEN THE System SHALL split into multiple files or offer compressed download
8. WHEN export completes, THE System SHALL trigger browser download with filename format: {dataType}_{dateRange}_{timestamp}.csv

### Requirement 8: Paystack Payment Integration

**User Story:** As a restaurant owner, I want to accept payments via Paystack, so that customers can pay for orders using cards and bank transfers.

#### Acceptance Criteria

1. THE Schema SHALL extend the `orders` table with paymentMethod, paymentStatus, paymentReference, and paymentTimestamp fields
2. THE System SHALL support paymentStatus values: pending, paid, failed, refunded
3. WHEN an order is created with Paystack payment, THE System SHALL initialize a Paystack transaction and return payment URL
4. THE System SHALL implement a webhook endpoint to receive Paystack payment notifications
5. WHEN a Paystack webhook is received, THE System SHALL verify the webhook signature using Paystack secret key
6. WHEN payment is successful, THE System SHALL update order paymentStatus to "paid" and store paymentReference
7. WHEN payment fails, THE System SHALL update order paymentStatus to "failed" and notify the branch
8. THE System SHALL support Paystack test mode for development and staging environments
9. IF webhook verification fails, THEN THE System SHALL log the attempt and reject the webhook

### Requirement 9: Flutterwave Payment Integration

**User Story:** As a restaurant owner, I want to accept payments via Flutterwave, so that customers have alternative payment options.

#### Acceptance Criteria

1. WHEN an order is created with Flutterwave payment, THE System SHALL initialize a Flutterwave transaction and return payment URL
2. THE System SHALL implement a webhook endpoint to receive Flutterwave payment notifications
3. WHEN a Flutterwave webhook is received, THE System SHALL verify the webhook using Flutterwave verification endpoint
4. WHEN payment is successful, THE System SHALL update order paymentStatus to "paid" and store transaction reference
5. WHEN payment fails, THE System SHALL update order paymentStatus to "failed" and notify the branch
6. THE System SHALL support Flutterwave sandbox mode for development and staging environments
7. THE System SHALL store the payment provider (paystack or flutterwave) in the order record

### Requirement 10: Cash-on-Delivery Payment Flow

**User Story:** As a customer, I want to pay cash when my order is delivered, so that I can order without needing online payment.

#### Acceptance Criteria

1. WHEN an order is created with COD payment, THE System SHALL set paymentMethod to "cod" and paymentStatus to "pending"
2. THE Order_Dashboard SHALL display COD orders with a distinct visual indicator
3. WHEN a rider marks an order as delivered, THE System SHALL prompt for payment collection confirmation
4. WHEN payment collection is confirmed, THE System SHALL update paymentStatus to "paid"
5. IF payment collection fails, THEN THE System SHALL allow marking as "payment_failed" with a reason
6. THE System SHALL track COD collection amounts for daily reconciliation
7. THE Branch_Dashboard SHALL display daily COD collection summary

### Requirement 11: WhatsApp Order Confirmation

**User Story:** As a customer, I want to receive order confirmation via WhatsApp, so that I have a record of my order details.

#### Acceptance Criteria

1. THE Schema SHALL extend the `orders` table with whatsappOptIn boolean field
2. WHEN an order is placed and customer has opted in, THE System SHALL send a WhatsApp confirmation message
3. THE Confirmation_Message SHALL include: order ID, restaurant name, items ordered, total amount, estimated delivery time
4. THE System SHALL use WhatsApp Business API message templates for order confirmation
5. WHEN WhatsApp delivery fails, THE System SHALL retry up to 3 times with exponential backoff
6. IF all retries fail, THEN THE System SHALL log the failure and fall back to SMS if phone number is valid
7. THE System SHALL track WhatsApp message delivery status (sent, delivered, read, failed)

### Requirement 12: WhatsApp Order Status Updates

**User Story:** As a customer, I want to receive order status updates via WhatsApp, so that I know when my order is being prepared and delivered.

#### Acceptance Criteria

1. WHEN order status changes to "preparing", THE System SHALL send a WhatsApp message indicating preparation has started
2. WHEN order status changes to "dispatched", THE System SHALL send a WhatsApp message with rider name and estimated arrival
3. WHEN order status changes to "delivered", THE System SHALL send a WhatsApp message confirming delivery
4. WHEN order is cancelled, THE System SHALL send a WhatsApp message with cancellation reason
5. THE Status_Messages SHALL use approved WhatsApp Business API templates
6. THE System SHALL respect customer opt-in preferences before sending any messages
7. THE System SHALL rate-limit WhatsApp messages to comply with Meta's messaging policies

### Requirement 13: WhatsApp Opt-In/Opt-Out Management

**User Story:** As a customer, I want to control whether I receive WhatsApp messages, so that I can manage my communication preferences.

#### Acceptance Criteria

1. THE Schema SHALL define a `customer_preferences` table with phoneNumber, whatsappOptIn, smsOptIn, and updatedAt fields
2. WHEN a customer places their first order, THE System SHALL prompt for WhatsApp opt-in consent
3. THE System SHALL provide a WhatsApp keyword command "STOP" to opt out of messages
4. WHEN "STOP" is received, THE System SHALL update whatsappOptIn to false and send confirmation
5. THE System SHALL provide a WhatsApp keyword command "START" to opt back in
6. WHEN "START" is received, THE System SHALL update whatsappOptIn to true and send confirmation
7. THE Customer_Preferences SHALL be checked before sending any WhatsApp message
8. THE System SHALL maintain an audit log of all opt-in/opt-out changes

### Requirement 14: Delivery Status Tracking

**User Story:** As a branch manager, I want to track delivery status, so that I can monitor order fulfillment and rider performance.

#### Acceptance Criteria

1. THE Schema SHALL extend the `orders` table with deliveryStatus, riderId, riderName, dispatchedAt, and deliveredAt fields
2. THE System SHALL support deliveryStatus values: pending, assigned, dispatched, in_transit, delivered, failed
3. WHEN a rider is assigned, THE System SHALL update deliveryStatus to "assigned" and store riderId and riderName
4. WHEN order is dispatched, THE System SHALL update deliveryStatus to "dispatched" and record dispatchedAt timestamp
5. WHEN order is delivered, THE System SHALL update deliveryStatus to "delivered" and record deliveredAt timestamp
6. THE Branch_Dashboard SHALL display orders grouped by delivery status
7. THE System SHALL calculate and display average delivery time per branch
8. IF delivery fails, THEN THE System SHALL allow recording failure reason and triggering re-dispatch

### Requirement 15: Rider/Dispatch API Updates

**User Story:** As a delivery rider, I want to update order status via API, so that the system reflects real-time delivery progress.

#### Acceptance Criteria

1. THE System SHALL expose a REST API endpoint for riders to update delivery status
2. THE API SHALL require authentication via API key or JWT token
3. WHEN status update is received, THE System SHALL validate the rider is assigned to the order
4. THE API SHALL accept status updates: dispatched, in_transit, delivered, failed
5. WHEN status is "failed", THE API SHALL require a failureReason field
6. THE API SHALL return updated order details in the response
7. IF unauthorized rider attempts update, THEN THE API SHALL return 403 Forbidden
8. THE System SHALL log all API calls for audit purposes

### Requirement 16: Nigerian English Voice Support

**User Story:** As a restaurant owner, I want the AI agent to understand Nigerian English accents, so that customers can interact naturally.

#### Acceptance Criteria

1. THE System SHALL integrate with ASR providers that support Nigerian English accent recognition
2. THE Language_Settings SHALL include "nigerian_english" as a language preference option
3. WHEN Nigerian English is selected, THE System SHALL configure ASR with Nigerian English acoustic model
4. THE System SHALL measure and log ASR confidence scores for Nigerian English transcriptions
5. WHEN confidence score falls below 70%, THE System SHALL trigger fallback behavior
6. THE System SHALL support common Nigerian English expressions and vocabulary in the AI agent prompts
7. THE System SHALL allow restaurant owners to add custom vocabulary for their specific menu items

### Requirement 17: Nigerian Pidgin Voice Support

**User Story:** As a restaurant owner, I want the AI agent to understand Nigerian Pidgin, so that customers who prefer Pidgin can place orders.

#### Acceptance Criteria

1. THE System SHALL evaluate and integrate ASR providers with Pidgin language support
2. THE Language_Settings SHALL include "pidgin" as a language preference option
3. WHEN Pidgin is selected, THE System SHALL configure ASR with Pidgin language model
4. THE System SHALL maintain a Pidgin phrase dictionary for common ordering expressions
5. THE AI_Agent SHALL respond in Pidgin when the customer speaks Pidgin
6. WHEN Pidgin ASR confidence is low, THE System SHALL offer to switch to English
7. THE System SHALL log Pidgin interaction metrics for model improvement

### Requirement 18: Confidence-Based Fallback

**User Story:** As a customer, I want the system to offer alternative communication when voice recognition fails, so that I can still complete my order.

#### Acceptance Criteria

1. WHEN ASR confidence falls below configurable threshold (default 60%), THE System SHALL trigger fallback
2. THE Fallback_System SHALL offer to continue via WhatsApp text ordering
3. THE Fallback_System SHALL offer to continue via SMS if WhatsApp is unavailable
4. WHEN fallback is triggered, THE System SHALL transfer conversation context to the new channel
5. THE System SHALL log fallback events with original confidence score and selected fallback channel
6. THE Branch_Dashboard SHALL display fallback rate metrics
7. IF customer declines all fallback options, THEN THE System SHALL offer to connect to human agent

### Requirement 19: Local Telecom Provider Routing

**User Story:** As a platform administrator, I want to route calls through optimal telecom providers, so that call quality is maximized and costs are minimized.

#### Acceptance Criteria

1. THE System SHALL support configuration of multiple telecom providers per region
2. THE Routing_Rules SHALL define primary and fallback providers for each region
3. WHEN a call is initiated, THE System SHALL select provider based on routing rules
4. WHEN primary provider fails, THE System SHALL automatically failover to secondary provider
5. THE System SHALL log provider selection and call quality metrics for each call
6. THE Platform_Dashboard SHALL display call quality metrics by provider
7. THE System SHALL support A/B testing of providers for quality comparison
8. THE Routing_Configuration SHALL be updatable without system restart

### Requirement 20: Uptime and Latency Monitoring

**User Story:** As a platform administrator, I want to monitor system uptime and latency, so that I can ensure service reliability.

#### Acceptance Criteria

1. THE Monitoring_System SHALL track API endpoint response times
2. THE Monitoring_System SHALL track database query latencies
3. THE Monitoring_System SHALL track external service (Paystack, Flutterwave, WhatsApp) response times
4. THE System SHALL define SLA thresholds: 99.9% uptime, <500ms API response time
5. WHEN latency exceeds threshold, THE System SHALL trigger an alert
6. WHEN uptime falls below threshold, THE System SHALL trigger an alert
7. THE Monitoring_Dashboard SHALL display real-time and historical metrics
8. THE System SHALL support alert notifications via email and Slack

### Requirement 21: Partner API and Webhooks

**User Story:** As a third-party developer, I want to integrate with the platform via API, so that I can build complementary services.

#### Acceptance Criteria

1. THE System SHALL expose a REST API for partner integrations
2. THE API SHALL support OAuth 2.0 authentication for partner applications
3. THE System SHALL provide API key management for partners in the dashboard
4. THE API SHALL expose endpoints for: restaurants, branches, menus, orders, calls
5. THE System SHALL implement webhook delivery for events: order.created, order.updated, order.completed, call.started, call.ended
6. THE Webhook_System SHALL retry failed deliveries up to 5 times with exponential backoff
7. THE Partner_Dashboard SHALL display API usage metrics and webhook delivery status
8. THE System SHALL enforce rate limits: 1000 requests per minute per API key

### Requirement 22: Order Funnel Analytics

**User Story:** As a platform administrator, I want to analyze the order funnel, so that I can identify conversion bottlenecks.

#### Acceptance Criteria

1. THE Analytics_System SHALL track funnel stages: call_started, order_initiated, payment_started, payment_completed, delivery_completed
2. THE Analytics_Dashboard SHALL display conversion rates between each funnel stage
3. THE Analytics_Dashboard SHALL display drop-off counts at each stage
4. THE System SHALL segment funnel data by: restaurant, branch, time period, payment method
5. THE Analytics_Dashboard SHALL display average time spent at each funnel stage
6. THE System SHALL identify and highlight stages with highest drop-off rates
7. THE Analytics_Dashboard SHALL support comparison between time periods
8. THE System SHALL export funnel data in CSV format

### Requirement 23: Agent Performance Dashboard

**User Story:** As a restaurant owner, I want to view AI agent performance metrics, so that I can optimize agent configuration.

#### Acceptance Criteria

1. THE Agent_Dashboard SHALL display total calls handled per agent
2. THE Agent_Dashboard SHALL display average call duration
3. THE Agent_Dashboard SHALL display order conversion rate per agent
4. THE Agent_Dashboard SHALL display customer satisfaction indicators (if feedback collected)
5. THE Agent_Dashboard SHALL display ASR accuracy metrics
6. THE Agent_Dashboard SHALL display fallback trigger rate
7. THE System SHALL compare agent performance across branches
8. THE Agent_Dashboard SHALL support filtering by date range and branch

### Requirement 24: Upsell/Cross-sell Prompt Library

**User Story:** As a restaurant owner, I want to configure upsell prompts for the AI agent, so that I can increase average order value.

#### Acceptance Criteria

1. THE Schema SHALL define a `prompts` table with promptId, restaurantId, triggerCondition, promptText, and isActive fields
2. THE System SHALL support trigger conditions: order_total_below, item_category, time_of_day, customer_history
3. WHEN trigger condition is met, THE AI_Agent SHALL deliver the configured prompt
4. THE Prompt_Library SHALL include pre-built templates for common upsell scenarios
5. THE Restaurant_Dashboard SHALL allow creating, editing, and deactivating prompts
6. THE System SHALL track prompt delivery and acceptance rates
7. THE Analytics_Dashboard SHALL display upsell revenue attribution
8. THE System SHALL A/B test prompt variations and report performance

### Requirement 25: Fraud and Abuse Detection

**User Story:** As a platform administrator, I want to detect fraudulent or abusive behavior, so that I can protect the platform and merchants.

#### Acceptance Criteria

1. THE System SHALL track signals: repeated failed payments, high cancellation rate, unusual order patterns
2. WHEN fraud signals exceed threshold, THE System SHALL flag the customer for review
3. THE System SHALL maintain a blocklist of phone numbers with confirmed fraud
4. WHEN a blocklisted number calls, THE System SHALL reject the call or require human verification
5. THE Fraud_Dashboard SHALL display flagged customers and fraud signal details
6. THE System SHALL allow manual review and disposition of flagged cases
7. THE System SHALL log all fraud detection events for audit
8. THE System SHALL support configurable fraud thresholds per restaurant

### Requirement 26: Self-Serve Onboarding and Billing

**User Story:** As a restaurant owner, I want to sign up and manage billing myself, so that I can get started without manual intervention.

#### Acceptance Criteria

1. THE Onboarding_Flow SHALL allow restaurant owners to sign up without platform admin involvement
2. THE System SHALL collect business verification documents during onboarding
3. THE Billing_System SHALL support subscription plans with different feature tiers
4. THE System SHALL integrate with Paystack/Flutterwave for subscription billing
5. THE Restaurant_Dashboard SHALL display current plan, usage, and billing history
6. THE System SHALL send billing reminders before subscription renewal
7. WHEN payment fails, THE System SHALL retry and notify the restaurant owner
8. IF payment fails after retries, THEN THE System SHALL downgrade to limited functionality

### Requirement 27: Multi-Location Order Routing

**User Story:** As a restaurant owner with multiple branches, I want orders to be routed to the appropriate branch, so that customers are served by the nearest location.

#### Acceptance Criteria

1. THE System SHALL determine customer location from phone number area code or explicit input
2. WHEN customer location is known, THE System SHALL route to the nearest active branch
3. THE Routing_Logic SHALL consider branch operating hours when selecting destination
4. THE Routing_Logic SHALL consider branch capacity and current order load
5. IF nearest branch is unavailable, THEN THE System SHALL offer alternative branches
6. THE System SHALL allow manual branch selection override by customer
7. THE Order_Record SHALL store the routing decision and reason
8. THE Analytics_Dashboard SHALL display routing distribution across branches

### Requirement 28: Backward Compatibility

**User Story:** As an existing single-restaurant user, I want my current setup to continue working, so that the platform upgrade doesn't disrupt my operations.

#### Acceptance Criteria

1. THE Migration_System SHALL automatically assign existing restaurants to a default platform
2. THE Migration_System SHALL create a default branch for each existing restaurant
3. THE Migration_System SHALL preserve all existing menu items, calls, orders, and transcripts
4. THE Migration_System SHALL map existing restaurantId references to new tenant structure
5. WHEN existing API endpoints are called, THE System SHALL maintain backward compatibility
6. THE System SHALL support gradual migration with feature flags for new functionality
7. THE Migration_System SHALL provide rollback capability within 30 days of migration
8. THE System SHALL notify existing users of new features without requiring immediate action

