/**
 * Check Blocked Phone Number API Route
 * 
 * Checks if a phone number is blocked or requires verification
 * based on fraud signals in the system.
 * 
 * @see Requirements: 25.4
 */

import { api } from "../../../../../../../convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { NextRequest } from "next/server";

// Simple API key validation for internal routes
function validateApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get("x-api-key");
  const expectedKey = process.env.INTERNAL_API_KEY;
  
  // If no API key is configured, allow requests (development mode)
  if (!expectedKey) {
    return true;
  }
  
  return apiKey === expectedKey;
}

// ============================================================================
// Types (inline to avoid module resolution issues)
// ============================================================================

type FraudSignalType =
  | 'repeated_failed_payments'
  | 'high_cancellation_rate'
  | 'unusual_order_pattern';

type FraudDisposition = 'cleared' | 'blocked' | 'monitoring';

interface FraudSignal {
  phoneNumber: string;
  signalType: FraudSignalType;
  signalCount: number;
  lastOccurrence: number;
  isBlocked: boolean;
  reviewedBy?: string;
  reviewedAt?: number;
  disposition?: FraudDisposition;
}

type CallBlockingAction = 'allow' | 'block' | 'require_verification';

interface FraudSignalSummary {
  signalType: FraudSignalType;
  signalCount: number;
  lastOccurrence: number;
  disposition?: string;
}

interface CallBlockingResult {
  action: CallBlockingAction;
  isBlocked: boolean;
  hasActiveSignals: boolean;
  reason: string;
  signals: FraudSignalSummary[];
}

interface CallBlockingConfig {
  verificationThreshold: number;
  signalActiveWindowMs: number;
}

const DEFAULT_CALL_BLOCKING_CONFIG: CallBlockingConfig = {
  verificationThreshold: 2,
  signalActiveWindowMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// ============================================================================
// Call Blocking Logic
// ============================================================================

function shouldBlockCall(
  phoneNumber: string, 
  signals: FraudSignal[],
  config: CallBlockingConfig = DEFAULT_CALL_BLOCKING_CONFIG
): CallBlockingResult {
  const now = Date.now();
  const activeWindowStart = now - config.signalActiveWindowMs;

  // Check if phone is on blocklist
  const isBlocked = signals.some(signal => signal.isBlocked);

  // Filter for active signals (within the time window)
  const activeSignals = signals.filter(
    signal => signal.lastOccurrence >= activeWindowStart
  );

  // Calculate total active signal count
  const totalActiveSignalCount = activeSignals.reduce(
    (sum, signal) => sum + signal.signalCount,
    0
  );

  // Build signal summaries
  const signalSummaries: FraudSignalSummary[] = signals.map(signal => ({
    signalType: signal.signalType,
    signalCount: signal.signalCount,
    lastOccurrence: signal.lastOccurrence,
    disposition: signal.disposition,
  }));

  // Determine action based on blocking rules
  let action: CallBlockingAction;
  let reason: string;

  if (isBlocked) {
    action = 'block';
    reason = `Phone number ${phoneNumber} is on the blocklist due to confirmed fraud`;
  } else if (totalActiveSignalCount >= config.verificationThreshold) {
    action = 'require_verification';
    reason = `Phone number ${phoneNumber} has ${totalActiveSignalCount} active fraud signal(s)`;
  } else if (activeSignals.length > 0) {
    action = 'allow';
    reason = `Phone number ${phoneNumber} has ${totalActiveSignalCount} active fraud signal(s), below verification threshold`;
  } else {
    action = 'allow';
    reason = `Phone number ${phoneNumber} has no active fraud signals`;
  }

  return {
    action,
    isBlocked,
    hasActiveSignals: activeSignals.length > 0,
    reason,
    signals: signalSummaries,
  };
}

// ============================================================================
// Request/Response Types
// ============================================================================

interface CheckBlockedRequest {
  phoneNumber: string;
}

interface CheckBlockedResponse {
  success: boolean;
  data?: CallBlockingResult;
  error?: string;
}

/**
 * POST /api/v1/check-blocked
 * 
 * Check if a phone number should be blocked or requires verification.
 * 
 * Request body:
 * - phoneNumber: string - The phone number to check
 * 
 * Response:
 * - success: boolean
 * - data: CallBlockingResult (if success)
 *   - action: 'allow' | 'block' | 'require_verification'
 *   - isBlocked: boolean
 *   - hasActiveSignals: boolean
 *   - reason: string
 *   - signals: FraudSignalSummary[]
 * - error: string (if not success)
 * 
 * @see Requirements: 25.4
 */
export async function POST(request: NextRequest): Promise<Response> {
  // Validate API key for internal routes
  if (!validateApiKey(request)) {
    const response: CheckBlockedResponse = {
      success: false,
      error: "Unauthorized"
    };
    return new Response(JSON.stringify(response), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    const response: CheckBlockedResponse = {
      success: false,
      error: "Server configuration error"
    };
    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  let body: CheckBlockedRequest;
  try {
    body = await request.json();
  } catch {
    const response: CheckBlockedResponse = {
      success: false,
      error: "Invalid JSON body"
    };
    return new Response(JSON.stringify(response), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { phoneNumber } = body;

  // Validate the request body
  if (!phoneNumber?.trim()) {
    const response: CheckBlockedResponse = {
      success: false,
      error: "`phoneNumber` is a required field."
    };
    return new Response(JSON.stringify(response), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const convexClient = new ConvexHttpClient(convexUrl);
    
    // Get fraud signals for the phone number
    const fraudSignalsResult = await convexClient.query(
      api.fraudSignals.getFraudSignals, 
      { phoneNumber }
    );

    // Convert Convex result to FraudSignal type
    const signals: FraudSignal[] = fraudSignalsResult.map((signal) => ({
      phoneNumber: signal.phoneNumber,
      signalType: signal.signalType as FraudSignalType,
      signalCount: signal.signalCount,
      lastOccurrence: signal.lastOccurrence,
      isBlocked: signal.isBlocked,
      reviewedBy: signal.reviewedBy,
      reviewedAt: signal.reviewedAt,
      disposition: signal.disposition as FraudDisposition | undefined,
    }));

    // Determine blocking action
    const blockingResult = shouldBlockCall(phoneNumber, signals);

    const response: CheckBlockedResponse = {
      success: true,
      data: blockingResult
    };

    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error checking blocked status:", error);
    const response: CheckBlockedResponse = {
      success: false,
      error: "Failed to check blocked status"
    };
    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
