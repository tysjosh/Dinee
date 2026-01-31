# Dinee Nigeria Pivot — Product Roadmap

## Purpose
Position Dinee as a platform-grade order intake and customer communications layer for Nigerian food platforms and multi-branch restaurants, extending the existing voice AI agent into a multi-tenant, WhatsApp-first, payments-integrated product.

## Target Customers
- Food delivery platforms operating multiple restaurant partners.
- Multi-branch restaurant groups and cloud kitchens.
- Call-center teams and delivery fleets supporting food platforms.

## Success Metrics (North Star + Supporting)
- **North Star:** % of inbound orders captured without human intervention.
- Missed-call reduction rate.
- Order conversion uplift during peak hours.
- Average order processing time (call to confirmed order).
- NPS/CSAT from restaurants and platform ops teams.
- GMV per restaurant enabled by Dinee.

## Assumptions to Validate
- WhatsApp is a preferred channel for confirmations and updates.
- Nigerian English + Pidgin support improves completion rates.
- Platforms will pay for a per-order or per-restaurant pricing model.
- Local payment rails (Paystack/Flutterwave) reduce drop-off.

## 90-Day Roadmap (MVP → Pilot)

### Phase 1 (Weeks 1–4): Platform Core & Multi-Tenancy
**Goals**
- Platform-ready architecture for multiple restaurants/branches.

**Key Deliverables**
- Multi-tenant data model: Platform → Restaurant → Branch.
- Role-based access: platform admin, restaurant owner, branch manager, supervisor.
- Restaurant onboarding flow with CSV/Sheet menu import.
- Platform dashboard v1: calls, orders, and missed-call analytics.

**Acceptance Criteria**
- Platform admin can onboard 10+ restaurants with separated data.
- Menu import works for 3+ real restaurant menus.

### Phase 2 (Weeks 5–8): Nigeria-Ready Commerce & Messaging
**Goals**
- Integrate local payments and WhatsApp workflows.

**Key Deliverables**
- Paystack/Flutterwave payment confirmation hooks.
- Cash-on-delivery order flows.
- WhatsApp order confirmation and status updates.
- Basic delivery handoff status tracking.

**Acceptance Criteria**
- Orders can be confirmed via WhatsApp with payment status recorded.
- Cash-on-delivery orders go through without blocking.

### Phase 3 (Weeks 9–12): Localization & Operational Scaling
**Goals**
- Improve completion rates and reliability in Nigeria.

**Key Deliverables**
- Nigerian English + Pidgin speech recognition tuning.
- Fallback from voice to WhatsApp/SMS if confidence is low.
- Local telephony providers exploration for cost/reliability.
- SLA monitoring and uptime alerts.

**Acceptance Criteria**
- 10–20% improvement in successful call completions.
- 1+ pilot platform reports reduced missed-call rates.

## 6–12 Month Roadmap (Scale)

### Platform Expansion
- Partner API for platforms to integrate programmatically.
- Advanced analytics: order funnels, agent performance, and SLA trends.
- Automated dispute handling and refund workflows.

### Merchant Growth
- Self-serve onboarding for restaurants.
- Menu normalization and SKU/variant mapping for cross-platform consistency.
- Multi-location order routing and kitchen load balancing.

### AI & Automation
- Intent-based upsell/cross-sell prompts.
- Intelligent customer segmentation (repeat buyers, high-value orders).
- Automated fraud/abuse signals for repeated cancellations.

## Risks & Mitigations
- **Voice reliability across accents:** Add WhatsApp fallback and test with regional accents.
- **Payment failures:** Provide COD flow and retry mechanisms.
- **Operational trust:** Early pilots with clear SLAs and escalation to human agents.
- **Platform integration complexity:** Publish a stable API + webhook specs early.

## Go-To-Market (GTM) Plan
- **Pilot** with 1–2 platforms and 10–50 restaurants.
- Publish case studies focusing on missed-call reduction and conversion uplift.
- Scale to chain restaurants and cloud kitchens after platform success.

## Pricing Direction
- **Platforms:** per-order fee + volume-based discount.
- **Restaurants:** monthly subscription tiers based on call volume.

## Open Questions
- Which platform partner should be the first pilot (largest volume vs. fastest integration)?
- Which local telco partner gives the best reliability for call routing?
- WhatsApp pricing impact on margins at scale?
