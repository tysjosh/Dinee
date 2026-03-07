# KPI Metric Definitions

All metrics are computed per-vertical and stored via `kpiSnapshots.storeSnapshot`.

| Metric | Numerator | Denominator | Time Window | Data Source | Filters | Edge Cases |
|--------|-----------|-------------|-------------|-------------|---------|------------|
| `active_tenant_count` | Businesses with ≥1 call in window | N/A | 30 days rolling | `restaurants` + `calls` | Join restaurants by vertical, cross-ref calls by restaurantId with callStartTime in window | Businesses with no calls ever → excluded. Calls without restaurantId → excluded. |
| `call_volume` | Count of calls created in period | N/A | Per day | `calls` | Filter by `callStartTime` within snapshot day; group by restaurant's vertical | Calls missing `callStartTime` use `_creationTime`. Calls without `restaurantId` → excluded from vertical grouping. |
| `call_minutes` | Sum of `calls.duration` / 60 | N/A | Per day | `calls` | Same as `call_volume` | Calls with `null`/`undefined` duration → treated as 0. Partial seconds rounded to 2 decimal places. |
| `call_to_outcome_conversion` | Orders created from calls (orders with `callId` set) | Completed calls (status = "completed") | Per day | `orders` + `calls` | Orders with `callId` in period / calls with status "completed" in period, per vertical | If 0 completed calls → conversion = 0 (avoid division by zero). Orders without `callId` → excluded from numerator. |
| `integration_attach_rate` | Businesses with `integrations.runsheet.status === "connected"` | Total businesses per vertical | Snapshot (point-in-time) | `restaurants` | Group by vertical; count those with connected runsheet / total per vertical | Businesses without `integrations` field → not connected. Rate capped at 1.0. |
| `arpa` | Sum of paid `subscriptionInvoices.amount` in period | Count of active subscriptions | Per month | `subscriptionInvoices` + `subscriptions` | Invoices with status "paid" and `paidAt` in period; subscriptions with status "active" per vertical | If 0 active subscriptions → ARPA = 0. Invoices without matching subscription vertical → use subscription's vertical lookup. |
| `churn_rate` | Subscriptions cancelled in period | Active subscriptions at period start | Per month | `subscriptions` | Cancelled: `cancelledAt` in period; Active at start: status was "active" with `currentPeriodStart` ≤ period start | If 0 active at start → churn = 0. Subscriptions that were created and cancelled within the same period count toward churn. |
