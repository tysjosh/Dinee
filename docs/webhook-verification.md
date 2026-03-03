# Webhook Signature Verification Guide

## Overview

All outbound webhook payloads from the Dinee platform are signed using HMAC-SHA256. You should verify the signature on every incoming webhook to confirm it originated from the platform and was not tampered with in transit.

## Headers

Each webhook delivery includes two headers:

| Header | Description |
|--------|-------------|
| `X-Webhook-Signature` | HMAC-SHA256 hex digest of the signed payload |
| `X-Webhook-Timestamp` | Unix timestamp (seconds) of when the webhook was dispatched |

## Signature Algorithm

The signature is computed as:

```
HMAC-SHA256(secret, "${timestamp}.${body}")
```

Where:
- `secret` — your webhook secret (provided when you register a subscription)
- `timestamp` — the value from the `X-Webhook-Timestamp` header
- `body` — the raw JSON request body string (do not parse and re-serialize)

## Verification Steps

1. Extract `X-Webhook-Signature` and `X-Webhook-Timestamp` from the request headers
2. Read the raw request body as a string
3. Compute `HMAC-SHA256(your_secret, "${timestamp}.${body}")`
4. Compare the computed signature to `X-Webhook-Signature` using a constant-time comparison
5. Optionally, reject requests where `X-Webhook-Timestamp` is more than 5 minutes old to prevent replay attacks

## Example Code

### TypeScript (Node.js)

```typescript
import crypto from "crypto";

function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  secret: string,
  toleranceSeconds: number = 300
): boolean {
  // Reject stale timestamps
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > toleranceSeconds) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// Usage in an Express/Next.js handler:
// const rawBody = await request.text();
// const sig = request.headers.get("X-Webhook-Signature");
// const ts = request.headers.get("X-Webhook-Timestamp");
// const valid = verifyWebhookSignature(rawBody, sig, ts, YOUR_SECRET);
```

### Python

```python
import hmac
import hashlib
import time

def verify_webhook_signature(
    raw_body: str,
    signature: str,
    timestamp: str,
    secret: str,
    tolerance_seconds: int = 300,
) -> bool:
    # Reject stale timestamps
    now = int(time.time())
    if abs(now - int(timestamp)) > tolerance_seconds:
        return False

    expected = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{raw_body}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(signature, expected)

# Usage in a Flask/FastAPI handler:
# raw_body = request.get_data(as_text=True)
# sig = request.headers.get("X-Webhook-Signature")
# ts = request.headers.get("X-Webhook-Timestamp")
# valid = verify_webhook_signature(raw_body, sig, ts, YOUR_SECRET)
```

### Go

```go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"strconv"
	"time"
)

func verifyWebhookSignature(
	rawBody, signature, timestamp, secret string,
	toleranceSeconds int64,
) bool {
	// Reject stale timestamps
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	now := time.Now().Unix()
	if int64(math.Abs(float64(now-ts))) > toleranceSeconds {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%s.%s", timestamp, rawBody)))
	expected := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(signature), []byte(expected))
}

// Usage in an HTTP handler:
// body, _ := io.ReadAll(r.Body)
// sig := r.Header.Get("X-Webhook-Signature")
// ts := r.Header.Get("X-Webhook-Timestamp")
// valid := verifyWebhookSignature(string(body), sig, ts, yourSecret, 300)
```

## Timestamp Tolerance

We recommend rejecting webhooks where `X-Webhook-Timestamp` is more than 5 minutes (300 seconds) from your server's current time. This prevents replay attacks where an attacker re-sends a previously captured webhook payload.

Make sure your server's clock is synchronized via NTP.

## Troubleshooting

| Symptom | Likely Cause |
|---------|--------------|
| Signature mismatch on every request | Wrong secret, or body was parsed/re-serialized before verification |
| Intermittent mismatches | Body middleware modifying the raw payload (e.g., JSON parsing middleware running before signature check) |
| Timestamp rejection | Server clock drift — ensure NTP is configured |
| Empty signature header | Webhook subscription may not have a secret configured |

Always verify against the **raw request body string**, not a parsed-and-re-serialized version. JSON serialization is not guaranteed to be stable across libraries.
