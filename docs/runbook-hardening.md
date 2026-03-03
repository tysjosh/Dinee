# Platform Hardening — Production Runbook

## Pre-Deployment Checklist

### Feature Flags

| Flag | Scope | Expected State | Notes |
|------|-------|----------------|-------|
| `logistics_api_enabled` | global | `false` | Enable per-platform after deployment |
| `logistics_voice_enabled` | global | `false` | Enable after ws-server deployment |
| `logistics_webhooks_enabled` | global | `false` | Enable after webhook cron is confirmed running |

Verify flag states via Convex dashboard → `featureFlags` table.

### Database Index Verification

Run `npx convex dev` (or check Convex dashboard → Schema) and confirm these indexes exist:

**shipments**: `by_shipment_id`, `by_tracking_code`, `by_organization_id`, `by_delivery_status`, `by_assigned_rider_id`, `by_org_and_status`
**riders**: `by_rider_id`, `by_organization_id`, `by_status`
**shipmentEvents**: `by_shipment_id`, `by_event_type`
**organizations**: `by_organization_id`, `by_platform_id`, `by_vertical`
**locations**: `by_location_id`, `by_organization_id`, `by_city_state`
**idempotencyKeys**: `by_key_partner`, `by_expires_at`
**webhookDeliveries**: `by_next_retry_at`
**webhookEvents**: `by_event_id`, `by_shipment_id`

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONVEX_DEPLOYMENT` | Yes | Convex deployment URL |
| `CONVEX_DEPLOY_KEY` | Yes | Convex deploy key for schema push |
| `NEXT_PUBLIC_CONVEX_URL` | Yes | Public Convex URL for client |

Validate all env vars are set in the production environment before proceeding.

---

## Deployment Steps

Deploy in this exact order. Do not skip steps.

### Step 1: Schema Deployment

Push schema changes first so indexes and new fields are available before any code references them.

```bash
npx convex deploy
```

Verify in Convex dashboard:
- New fields: `idempotencyKeys.status`, `calls.correlationId`, `shipmentEvents.correlationId`, `webhookEvents.resourceType/resourceId/shipmentId`
- New indexes: `webhookDeliveries.by_next_retry_at`, `shipments.by_org_and_status`
- Cron job `process-webhook-retries` registered (60s interval)

### Step 2: API Route Deployment

Deploy the Next.js application with updated API routes.

```bash
# Build and deploy
npm run build
# Deploy via your CI/CD pipeline or hosting provider
```

Post-deploy checks:
- All logistics endpoints return `400` when `X-Tenant-Id` is missing
- Idempotency key handling returns stored responses on replay
- Public tracking endpoint returns PII-stripped responses

### Step 3: WS-Server Deployment

Deploy the updated ws-server with call-phase gating and correlation ID propagation.

Post-deploy checks:
- New voice sessions generate `correlationId` (prefixed `voice-`)
- Tool calls respect the updated call-phase matrix
- Retry wrapper is active (check logs for retry attempts on transient errors)

### Step 4: Feature Flag Enablement

Enable flags one at a time, per-platform. Wait 5 minutes between each flag to monitor for issues.

1. Enable `logistics_api_enabled` for the target platform
2. Verify API endpoints respond correctly (see Health Checks below)
3. Enable `logistics_voice_enabled` for the target platform
4. Verify voice tool calls work end-to-end
5. Enable `logistics_webhooks_enabled` for the target platform
6. Verify webhook deliveries are dispatched and signed

---

## Health Checks

### API Health

| Endpoint | Method | Expected Response |
|----------|--------|-------------------|
| `GET /api/v1/logistics/shipments?organizationId={orgId}` | GET (authenticated) | `200` with `{ items, page, perPage, totalCount }` |
| `GET /api/v1/logistics/track/{trackingCode}` | GET (public) | `200` with PII-stripped payload or `404` |
| `POST /api/v1/logistics/shipments` | POST (authenticated, with idempotency key) | `201` on first call, same `201` on replay |

### Webhook Health

- Check Convex dashboard → `webhookDeliveries` table for recent entries
- Verify `success: true` deliveries have `X-Webhook-Signature` and `X-Webhook-Timestamp` headers logged
- Verify cron job `process-webhook-retries` is executing every 60 seconds (check Convex cron logs)

### Dead-Letter Monitoring

Query `webhookDeliveries` for dead-letter entries:
- Filter: `success == false AND nextRetryAt == null`
- Any entries here indicate deliveries that exhausted all 5 retry attempts

---

## Rollback Steps

### Immediate: Disable Feature Flags

Fastest rollback — no code changes needed.

1. Set `logistics_webhooks_enabled` → `false` (stops new webhook dispatches)
2. Set `logistics_voice_enabled` → `false` (disables logistics voice tools)
3. Set `logistics_api_enabled` → `false` (returns 403 on all logistics endpoints)

Record `setBy` and `reason` on each flag change for audit trail.

### Code Revert

If flag disablement is insufficient:

1. Revert the Next.js deployment to the previous version
2. Revert the ws-server deployment to the previous version
3. **Do NOT revert the schema** — new optional fields and indexes are backward-compatible and safe to leave in place

### Data Integrity Verification

After rollback, verify:

- **Existing restaurant data**: Query `restaurants`, `orders`, `calls`, `menuItems` tables — all records should be intact and unchanged
- **Idempotency keys**: Check `idempotencyKeys` table for any records with `status: "failed"` that may need cleanup
- **Webhook deliveries**: Check for in-flight deliveries that may have been interrupted — these will be retried by the cron job when re-enabled
- **Correlation IDs**: New `correlationId` fields on `calls`, `shipmentEvents`, `transcripts` are optional and do not affect existing records

---

## Monitoring Dashboards and Alert Thresholds

### Key Metrics to Watch

| Metric | Source | Warning Threshold | Critical Threshold |
|--------|--------|-------------------|--------------------|
| Logistics API error rate (5xx) | Application logs | > 1% of requests | > 5% of requests |
| Webhook delivery failure rate | `webhookDeliveries` table | > 10% failures | > 25% failures |
| Dead-letter queue depth | `webhookDeliveries` (nextRetryAt == null) | > 10 entries/hour | > 50 entries/hour |
| Idempotency failed-state records | `idempotencyKeys` (status == "failed") | > 5 entries/hour | > 20 entries/hour |
| Voice tool retry rate | Application logs (warn-level retry entries) | > 5% of tool calls | > 15% of tool calls |
| API latency p99 | Application logs | > 2s | > 5s |

### Log Queries

Filter structured logs by:
- `vertical: "logistics"` — all logistics operations
- `level: "error"` — failures requiring investigation
- `level: "warn"` — rejected transitions, retry attempts, duplicate idempotency keys
- `correlationId: "voice-*"` — trace a full voice session end-to-end
- `requestId: "{value}"` — trace a full API request lifecycle

---

## Escalation Contacts

| Role | Contact | When to Escalate |
|------|---------|------------------|
| On-call engineer | `[ON_CALL_PAGER]` | Any critical threshold breach |
| Platform team lead | `[TEAM_LEAD_CONTACT]` | Rollback decision needed |
| Team Slack channel | `[TEAM_SLACK_CHANNEL]` | All deployment status updates |
| Incident channel | `[INCIDENT_SLACK_CHANNEL]` | Active incidents only |
| Partner communications | `[PARTNER_COMMS_CONTACT]` | Webhook delivery outages affecting partners |

### Communication Protocol

1. Post deployment start/completion to `[TEAM_SLACK_CHANNEL]`
2. If any health check fails, post to `[TEAM_SLACK_CHANNEL]` with details
3. If rollback is initiated, post to `[INCIDENT_SLACK_CHANNEL]` and page on-call
4. If partner-facing webhooks are affected, notify `[PARTNER_COMMS_CONTACT]` within 15 minutes
