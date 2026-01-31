# Dinee Nigeria Pivot — Task Breakdown

This task list maps to the phases in `ROADMAP_NIGERIA.md` and is structured for execution.

## Phase 1 (Weeks 1–4): Platform Core & Multi-Tenancy

### Architecture & Data Model
- [ ] Define tenant hierarchy: Platform → Restaurant → Branch.
- [ ] Add tenant-aware IDs to all core tables (restaurants, branches, users, orders, calls).
- [ ] Implement data access guards to enforce tenant isolation.
- [ ] Add role-based access control (platform admin, restaurant owner, branch manager, supervisor).

### Onboarding & Menu Import
- [ ] Build restaurant onboarding flow (create restaurant, branch, roles).
- [ ] Implement CSV/Google Sheet menu import pipeline.
- [ ] Add menu validation (required fields, price formats, modifiers).
- [ ] Create error report + retry workflow for failed imports.

### Platform Dashboard v1
- [ ] Dashboard: total calls, orders, missed calls, conversion rate.
- [ ] Filters: platform / restaurant / branch / date range.
- [ ] Export: CSV report for call and order metrics.

### QA & Release
- [ ] Tenant isolation tests (cross-tenant access blocked).
- [ ] Menu import tests with sample menus.
- [ ] Pilot onboarding for 3–5 restaurants.

## Phase 2 (Weeks 5–8): Nigeria-Ready Commerce & Messaging

### Payments Integration
- [ ] Integrate Paystack (webhooks + verification).
- [ ] Integrate Flutterwave (webhooks + verification).
- [ ] Record payment status on orders (paid, pending, failed).
- [ ] Support cash-on-delivery (COD) order flow.

### WhatsApp Workflows
- [ ] Send WhatsApp order confirmation.
- [ ] Send WhatsApp order status updates (prep, dispatched, delivered).
- [ ] Add opt-in/opt-out management for WhatsApp communications.

### Delivery Handoff
- [ ] Add delivery status tracking fields.
- [ ] Support rider/dispatch updates via API or dashboard.

### QA & Release
- [ ] End-to-end order flow test with WhatsApp + payments.
- [ ] COD scenario test for manual confirmation.

## Phase 3 (Weeks 9–12): Localization & Operational Scaling

### Voice Localization
- [ ] Evaluate Nigerian English + Pidgin ASR options.
- [ ] Build language selection and fallback prompts.
- [ ] Add confidence-based fallback to WhatsApp/SMS.

### Telephony Optimization
- [ ] Evaluate local telecom providers for call quality and cost.
- [ ] Add provider routing rules (fallback on failure).

### Reliability & Observability
- [ ] Add uptime/latency monitoring dashboards.
- [ ] Define SLA and alert thresholds.

### QA & Release
- [ ] Pilot with 1–2 platforms and 10–50 restaurants.
- [ ] Measure call completion uplift and missed-call reduction.

## 6–12 Month Scale Tasks

### Platform API & Integrations
- [ ] Publish partner API + webhook specs.
- [ ] Build OAuth or API key management for platforms.

### Advanced Analytics
- [ ] Order funnel analytics (call → order → payment → delivery).
- [ ] SLA tracking and agent performance dashboards.

### Automation & AI
- [ ] Upsell/cross-sell prompt library.
- [ ] Fraud and abuse detection signals.

### Merchant Growth
- [ ] Self-serve onboarding and billing.
- [ ] Multi-location order routing logic.

## Dependencies & Risks
- [ ] Finalize WhatsApp Business API provider.
- [ ] Confirm payment provider requirements (KYC, webhooks).
- [ ] Validate ASR performance with Nigerian accents.
