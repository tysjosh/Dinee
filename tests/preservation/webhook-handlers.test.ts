/**
 * Preservation Test — Webhook Handlers
 *
 * **Validates: Requirements 3.6**
 *
 * This test establishes the baseline behavior of Paystack and Flutterwave
 * webhook handlers that MUST be preserved after fixes are applied. It uses
 * static analysis to verify:
 *   1. Both webhook handler files exist and export POST handlers
 *   2. Paystack verifies signatures via crypto.createHmac (in PaystackProvider)
 *   3. Flutterwave verifies webhooks via verifyWebhookSignature / verifyTransaction
 *   4. Both check for duplicate events via atomic idempotency (atomicInsertWebhookEvent)
 *   5. Both process payment status updates via Convex mutations
 *   6. Both return NextResponse.json with status 200 for valid webhooks
 *
 * EXPECTED OUTCOME: All tests PASS on unfixed code (confirms baseline).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import fc from 'fast-check';

// ============================================================================
// Constants
// ============================================================================

const PAYSTACK_HANDLER = 'src/app/client/api/v1/webhooks/paystack/route.ts';
const FLUTTERWAVE_HANDLER = 'src/app/client/api/v1/webhooks/flutterwave/route.ts';
const PAYSTACK_PROVIDER = 'src/lib/payment/PaystackProvider.ts';
const FLUTTERWAVE_PROVIDER = 'src/lib/payment/FlutterwaveProvider.ts';
const WEBHOOK_EVENTS_MODULE = 'convex/webhookEvents.ts';
const SCHEMA_FILE = 'convex/schema.ts';

// ============================================================================
// Observed Baseline — Webhook handler characteristics
// ============================================================================

interface WebhookHandlerBaseline {
  /** File path relative to project root */
  filePath: string;
  /** Provider name */
  provider: 'paystack' | 'flutterwave';
  /** Expected export: async POST function */
  hasPostExport: boolean;
  /** Uses idempotency check via webhookEvents query */
  hasIdempotencyCheck: boolean;
  /** Processes payment via Convex mutation (api.orders.updatePaymentStatus) */
  hasPaymentProcessing: boolean;
  /** Returns NextResponse.json with 200 on success */
  hasSuccessResponse: boolean;
  /** Signature header name used */
  signatureHeader: string;
  /** Event ID generation function name */
  eventIdGenerator: string;
}

const WEBHOOK_HANDLERS: WebhookHandlerBaseline[] = [
  {
    filePath: PAYSTACK_HANDLER,
    provider: 'paystack',
    hasPostExport: true,
    hasIdempotencyCheck: true,
    hasPaymentProcessing: true,
    hasSuccessResponse: true,
    signatureHeader: 'x-paystack-signature',
    eventIdGenerator: 'generateEventId',
  },
  {
    filePath: FLUTTERWAVE_HANDLER,
    provider: 'flutterwave',
    hasPostExport: true,
    hasIdempotencyCheck: true,
    hasPaymentProcessing: true,
    hasSuccessResponse: true,
    signatureHeader: 'verif-hash',
    eventIdGenerator: 'generateEventId',
  },
];

// ============================================================================
// Helpers
// ============================================================================

function readSourceFile(relativePath: string): string {
  const fullPath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

function fileExists(relativePath: string): boolean {
  const fullPath = path.resolve(process.cwd(), relativePath);
  return fs.existsSync(fullPath);
}

// ============================================================================
// Tests
// ============================================================================

describe('Webhook Handler Preservation — Baseline Behavior', () => {
  // ---- 1. Both webhook handler files exist and export POST handlers ----
  describe('1. Webhook handler files exist with POST exports', () => {
    for (const handler of WEBHOOK_HANDLERS) {
      it(`${handler.provider} handler file exists at ${handler.filePath}`, () => {
        expect(
          fileExists(handler.filePath),
          `${handler.provider} webhook handler not found at ${handler.filePath}`
        ).toBe(true);
      });

      it(`${handler.provider} handler exports async POST function`, () => {
        const source = readSourceFile(handler.filePath);
        const hasPostExport = /export\s+async\s+function\s+POST\s*\(/.test(source);
        expect(
          hasPostExport,
          `${handler.provider} handler does not export an async POST function`
        ).toBe(true);
      });
    }
  });

  // ---- 2. Signature verification ----
  describe('2. Webhook signature verification', () => {
    it('Paystack handler reads x-paystack-signature header', () => {
      const source = readSourceFile(PAYSTACK_HANDLER);
      expect(
        source.includes('x-paystack-signature'),
        'Paystack handler does not reference x-paystack-signature header'
      ).toBe(true);
    });

    it('Paystack handler calls verifyWebhookSignature on the provider', () => {
      const source = readSourceFile(PAYSTACK_HANDLER);
      expect(
        /verifyWebhookSignature\s*\(/.test(source),
        'Paystack handler does not call verifyWebhookSignature'
      ).toBe(true);
    });

    it('PaystackProvider uses crypto.createHmac for signature verification', () => {
      const source = readSourceFile(PAYSTACK_PROVIDER);
      expect(
        source.includes('crypto'),
        'PaystackProvider does not import crypto'
      ).toBe(true);
      expect(
        /createHmac\s*\(\s*["']sha512["']/.test(source),
        'PaystackProvider does not use createHmac with sha512'
      ).toBe(true);
    });

    it('Flutterwave handler reads verif-hash header', () => {
      const source = readSourceFile(FLUTTERWAVE_HANDLER);
      expect(
        source.includes('verif-hash'),
        'Flutterwave handler does not reference verif-hash header'
      ).toBe(true);
    });

    it('Flutterwave handler calls verifyWebhookSignature on the provider', () => {
      const source = readSourceFile(FLUTTERWAVE_HANDLER);
      expect(
        /verifyWebhookSignature\s*\(/.test(source),
        'Flutterwave handler does not call verifyWebhookSignature'
      ).toBe(true);
    });

    it('Flutterwave handler calls verifyTransaction for server-side verification', () => {
      const source = readSourceFile(FLUTTERWAVE_HANDLER);
      expect(
        /verifyTransaction\s*\(/.test(source),
        'Flutterwave handler does not call verifyTransaction'
      ).toBe(true);
    });
  });

  // ---- 3. Duplicate event checking via atomic idempotency ----
  // NOTE: Updated to reflect atomic idempotency pattern (atomicInsertWebhookEvent)
  // introduced in Fix 9 (task 11.5-11.7), replacing the racy query-then-insert pattern.
  // The behavioral guarantee is the same: duplicate events are detected and skipped.
  describe('3. Duplicate event checking (idempotency)', () => {
    for (const handler of WEBHOOK_HANDLERS) {
      it(`${handler.provider} handler uses atomic idempotency check via atomicInsertWebhookEvent`, () => {
        const source = readSourceFile(handler.filePath);
        // Handlers now use atomicInsertWebhookEvent for TOCTOU-safe idempotency
        expect(
          source.includes('atomicInsertWebhookEvent'),
          `${handler.provider} handler does not use atomicInsertWebhookEvent`
        ).toBe(true);
      });

      it(`${handler.provider} handler checks insertResult.inserted for deduplication`, () => {
        const source = readSourceFile(handler.filePath);
        expect(
          /insertResult\.inserted/.test(source) || /!insertResult\.inserted/.test(source),
          `${handler.provider} handler does not check insertResult.inserted`
        ).toBe(true);
      });

      it(`${handler.provider} handler generates event IDs via ${handler.eventIdGenerator}`, () => {
        const source = readSourceFile(handler.filePath);
        const hasGenerator = new RegExp(
          `function\\s+${handler.eventIdGenerator}\\s*\\(`
        ).test(source);
        expect(
          hasGenerator,
          `${handler.provider} handler does not define ${handler.eventIdGenerator} function`
        ).toBe(true);
      });
    }

    it('webhookEvents module uses by_event_id index for lookups', () => {
      const source = readSourceFile(WEBHOOK_EVENTS_MODULE);
      expect(
        /withIndex\s*\(\s*["']by_event_id["']/.test(source),
        'webhookEvents module does not use by_event_id index'
      ).toBe(true);
    });

    it('schema defines by_event_id index on webhookEvents table', () => {
      const source = readSourceFile(SCHEMA_FILE);
      // Find webhookEvents section and check for by_event_id index
      const webhookSection = source.substring(
        source.indexOf('webhookEvents:')
      );
      expect(
        /\.index\s*\(\s*["']by_event_id["']\s*,\s*\[["']eventId["']\]/.test(webhookSection),
        'Schema does not define by_event_id index on webhookEvents'
      ).toBe(true);
    });
  });

  // ---- 4. Payment status updates via Convex mutations ----
  describe('4. Payment processing via Convex mutations', () => {
    for (const handler of WEBHOOK_HANDLERS) {
      it(`${handler.provider} handler calls api.orders.updatePaymentStatus`, () => {
        const source = readSourceFile(handler.filePath);
        expect(
          source.includes('api.orders.updatePaymentStatus'),
          `${handler.provider} handler does not call api.orders.updatePaymentStatus`
        ).toBe(true);
      });

      it(`${handler.provider} handler logs events via api.webhookEvents.atomicInsertWebhookEvent`, () => {
        const source = readSourceFile(handler.filePath);
        expect(
          source.includes('api.webhookEvents.atomicInsertWebhookEvent'),
          `${handler.provider} handler does not call atomicInsertWebhookEvent`
        ).toBe(true);
      });

      it(`${handler.provider} handler marks events processed via markWebhookEventAsProcessed`, () => {
        const source = readSourceFile(handler.filePath);
        expect(
          source.includes('markWebhookEventAsProcessed'),
          `${handler.provider} handler does not call markWebhookEventAsProcessed`
        ).toBe(true);
      });
    }
  });

  // ---- 5. Success response with status 200 ----
  describe('5. Returns NextResponse.json with status 200 for valid webhooks', () => {
    for (const handler of WEBHOOK_HANDLERS) {
      it(`${handler.provider} handler returns 200 on successful processing`, () => {
        const source = readSourceFile(handler.filePath);
        // Check for NextResponse.json with status: 200 pattern
        expect(
          /NextResponse\.json\s*\(\s*\{[^}]*message[^}]*\}\s*,\s*\{\s*status:\s*200\s*\}/.test(source),
          `${handler.provider} handler does not return NextResponse.json with status 200`
        ).toBe(true);
      });

      it(`${handler.provider} handler returns "Webhook processed successfully" message`, () => {
        const source = readSourceFile(handler.filePath);
        expect(
          source.includes('Webhook processed successfully'),
          `${handler.provider} handler does not return "Webhook processed successfully" message`
        ).toBe(true);
      });

      it(`${handler.provider} handler imports NextResponse from next/server`, () => {
        const source = readSourceFile(handler.filePath);
        expect(
          /import\s*\{[^}]*NextResponse[^}]*\}\s*from\s*["']next\/server["']/.test(source),
          `${handler.provider} handler does not import NextResponse`
        ).toBe(true);
      });
    }
  });

  // ---- 6. Error handling for invalid signatures ----
  describe('6. Invalid signature rejection', () => {
    for (const handler of WEBHOOK_HANDLERS) {
      it(`${handler.provider} handler returns 422 for invalid signatures`, () => {
        const source = readSourceFile(handler.filePath);
        expect(
          /status:\s*422/.test(source),
          `${handler.provider} handler does not return 422 for invalid signatures`
        ).toBe(true);
      });
    }
  });

  // ---- 7. Property-based: all webhook handlers preserve structural invariants ----
  describe('7. Property: all webhook handlers preserve structural invariants', () => {
    /**
     * **Validates: Requirements 3.6**
     *
     * Property: For all webhook handlers (Paystack, Flutterwave), the
     * following invariants hold simultaneously:
     *   - Handler file exists and exports async POST function
     *   - Handler reads the correct signature header
     *   - Handler calls verifyWebhookSignature on the provider
     *   - Handler checks for duplicate events via webhookEvents query
     *   - Handler processes payments via api.orders.updatePaymentStatus
     *   - Handler returns NextResponse.json with status 200 on success
     *   - Handler returns 422 for invalid signatures
     */
    const handlerArbitrary = fc.constantFrom(...WEBHOOK_HANDLERS);

    it('all structural invariants hold for any webhook handler', () => {
      fc.assert(
        fc.property(handlerArbitrary, (handler) => {
          // File exists
          expect(fileExists(handler.filePath)).toBe(true);

          const source = readSourceFile(handler.filePath);

          // Exports async POST
          expect(/export\s+async\s+function\s+POST\s*\(/.test(source)).toBe(true);

          // Reads correct signature header
          expect(source.includes(handler.signatureHeader)).toBe(true);

          // Calls verifyWebhookSignature
          expect(/verifyWebhookSignature\s*\(/.test(source)).toBe(true);

          // Checks for duplicate events via atomic idempotency
          expect(source.includes('atomicInsertWebhookEvent')).toBe(true);
          expect(/insertResult\.inserted/.test(source) || /!insertResult\.inserted/.test(source)).toBe(true);

          // Processes payments via Convex mutation
          expect(source.includes('api.orders.updatePaymentStatus')).toBe(true);

          // Logs webhook events via atomic insert
          expect(source.includes('api.webhookEvents.atomicInsertWebhookEvent')).toBe(true);

          // Marks events as processed
          expect(source.includes('markWebhookEventAsProcessed')).toBe(true);

          // Returns 200 on success
          expect(
            /NextResponse\.json\s*\(\s*\{[^}]*message[^}]*\}\s*,\s*\{\s*status:\s*200\s*\}/.test(source)
          ).toBe(true);

          // Returns 422 for invalid signatures
          expect(/status:\s*422/.test(source)).toBe(true);

          // Has event ID generator
          expect(
            new RegExp(`function\\s+${handler.eventIdGenerator}\\s*\\(`).test(source)
          ).toBe(true);
        }),
        { numRuns: WEBHOOK_HANDLERS.length * 3 }
      );
    });
  });
});
