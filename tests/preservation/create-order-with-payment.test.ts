/**
 * Preservation Test — createOrderWithPayment Structure
 *
 * Validates: Requirements 3.10
 *
 * This test establishes the baseline behavior of `createOrderWithPayment` in
 * convex/orders.ts that MUST be preserved after fixes are applied.
 * It uses static analysis to verify:
 *   1. `createOrderWithPayment` is exported from convex/orders.ts
 *   2. It inserts into the "orders" table
 *   3. It sets initial payment and delivery statuses
 *   4. It checks for WhatsApp opt-in and schedules confirmation messages via the messaging module
 *   5. It returns the created order ID
 *
 * EXPECTED OUTCOME: All tests PASS on unfixed code (confirms baseline).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Helpers
// ============================================================================

function readSourceFile(relativePath: string): string {
  const fullPath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

function extractExportedNames(source: string): string[] {
  const names: string[] = [];
  const constRegex = /export\s+const\s+(\w+)\s*=/g;
  let match: RegExpExecArray | null;
  while ((match = constRegex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function extractFunctionBody(source: string, functionName: string): string | null {
  const startPattern = `export const ${functionName}`;
  const startIdx = source.indexOf(startPattern);
  if (startIdx === -1) return null;

  let braceDepth = 0;
  let foundFirstBrace = false;
  let endIdx = startIdx;

  for (let i = startIdx; i < source.length; i++) {
    if (source[i] === '{') {
      braceDepth++;
      foundFirstBrace = true;
    } else if (source[i] === '}') {
      braceDepth--;
      if (foundFirstBrace && braceDepth === 0) {
        const remaining = source.substring(i);
        const closeMatch = remaining.match(/^\}\s*\)\s*;?/);
        if (closeMatch) {
          endIdx = i + closeMatch[0].length;
        } else {
          endIdx = i + 1;
        }
        break;
      }
    }
  }

  return source.substring(startIdx, endIdx);
}

// ============================================================================
// Constants
// ============================================================================

const ORDERS_FILE = 'convex/orders.ts';

// ============================================================================
// Tests
// ============================================================================

describe('createOrderWithPayment Preservation — Scheduling and Initial Status Behavior', () => {
  const ordersSource = readSourceFile(ORDERS_FILE);

  // ---- 1. createOrderWithPayment is exported ----
  describe('1. createOrderWithPayment is exported from convex/orders.ts', () => {
    it('createOrderWithPayment is exported', () => {
      const exportedNames = extractExportedNames(ordersSource);
      expect(
        exportedNames,
        'createOrderWithPayment should be exported from convex/orders.ts'
      ).toContain('createOrderWithPayment');
    });
  });

  // ---- 2. Inserts into the "orders" table ----
  describe('2. Inserts into the "orders" table', () => {
    it('uses ctx.db.insert("orders", ...) to create the order', () => {
      const body = extractFunctionBody(ordersSource, 'createOrderWithPayment');
      expect(body, 'Could not extract body for createOrderWithPayment').not.toBeNull();

      const insertPattern = /ctx\.db\.insert\s*\(\s*["']orders["']/;
      expect(
        insertPattern.test(body!),
        'createOrderWithPayment should insert into the "orders" table'
      ).toBe(true);
    });
  });

  // ---- 3. Sets initial payment and delivery statuses ----
  describe('3. Sets initial payment and delivery statuses', () => {
    it('sets paymentStatus to "pending"', () => {
      const body = extractFunctionBody(ordersSource, 'createOrderWithPayment');
      expect(body, 'Could not extract body for createOrderWithPayment').not.toBeNull();

      // The function sets paymentStatus = "pending" for all payment methods
      const pendingPattern = /paymentStatus\s*[:=]\s*["']pending["']/;
      expect(
        pendingPattern.test(body!),
        'createOrderWithPayment should set initial paymentStatus to "pending"'
      ).toBe(true);
    });

    it('sets order status to "active"', () => {
      const body = extractFunctionBody(ordersSource, 'createOrderWithPayment');
      expect(body, 'Could not extract body for createOrderWithPayment').not.toBeNull();

      const activePattern = /status\s*:\s*["']active["']/;
      expect(
        activePattern.test(body!),
        'createOrderWithPayment should set initial order status to "active"'
      ).toBe(true);
    });

    it('sets deliveryStatus to "pending" for COD orders', () => {
      const body = extractFunctionBody(ordersSource, 'createOrderWithPayment');
      expect(body, 'Could not extract body for createOrderWithPayment').not.toBeNull();

      // Check that COD orders get deliveryStatus: "pending"
      const codDeliveryPattern = /paymentMethod\s*===\s*["']cod["']\s*\?\s*["']pending["']/;
      expect(
        codDeliveryPattern.test(body!),
        'createOrderWithPayment should set deliveryStatus to "pending" for COD orders'
      ).toBe(true);
    });
  });

  // ---- 4. Checks WhatsApp opt-in and schedules confirmation messages ----
  describe('4. Checks WhatsApp opt-in and schedules confirmation messages', () => {
    it('checks whatsappOptIn before scheduling a message', () => {
      const body = extractFunctionBody(ordersSource, 'createOrderWithPayment');
      expect(body, 'Could not extract body for createOrderWithPayment').not.toBeNull();

      const optInCheckPattern = /args\.whatsappOptIn/;
      expect(
        optInCheckPattern.test(body!),
        'createOrderWithPayment should check args.whatsappOptIn before scheduling'
      ).toBe(true);
    });

    it('checks customerPhone before scheduling a message', () => {
      const body = extractFunctionBody(ordersSource, 'createOrderWithPayment');
      expect(body, 'Could not extract body for createOrderWithPayment').not.toBeNull();

      const phoneCheckPattern = /args\.customerPhone/;
      expect(
        phoneCheckPattern.test(body!),
        'createOrderWithPayment should check args.customerPhone before scheduling'
      ).toBe(true);
    });

    it('schedules confirmation via ctx.scheduler.runAfter with messaging module', () => {
      const body = extractFunctionBody(ordersSource, 'createOrderWithPayment');
      expect(body, 'Could not extract body for createOrderWithPayment').not.toBeNull();

      const schedulerPattern = /ctx\.scheduler\.runAfter\s*\(\s*0\s*,\s*internal\.messaging\.sendOrderConfirmationInternal/;
      expect(
        schedulerPattern.test(body!),
        'createOrderWithPayment should schedule confirmation via internal.messaging.sendOrderConfirmationInternal'
      ).toBe(true);
    });

    it('passes orderId to the scheduled confirmation message', () => {
      const body = extractFunctionBody(ordersSource, 'createOrderWithPayment');
      expect(body, 'Could not extract body for createOrderWithPayment').not.toBeNull();

      const orderIdArgPattern = /sendOrderConfirmationInternal[\s\S]*?orderId\s*:\s*args\.orderId/;
      expect(
        orderIdArgPattern.test(body!),
        'Scheduled confirmation should include orderId from args'
      ).toBe(true);
    });
  });

  // ---- 5. Returns the created order ID ----
  describe('5. Returns the created order ID', () => {
    it('returns the result of ctx.db.insert (the order document ID)', () => {
      const body = extractFunctionBody(ordersSource, 'createOrderWithPayment');
      expect(body, 'Could not extract body for createOrderWithPayment').not.toBeNull();

      // The function assigns the insert result and returns it
      const assignPattern = /const\s+order\s*=\s*await\s+ctx\.db\.insert\s*\(/;
      expect(
        assignPattern.test(body!),
        'createOrderWithPayment should assign the insert result to a variable'
      ).toBe(true);

      const returnPattern = /return\s+order\s*;/;
      expect(
        returnPattern.test(body!),
        'createOrderWithPayment should return the created order ID'
      ).toBe(true);
    });
  });
});
