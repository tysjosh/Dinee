/**
 * Rider Status Update API
 * 
 * REST API endpoint for riders to update delivery status.
 * Implements authentication via API key and validates status transitions.
 * 
 * @module api/rider/status
 * @requirements 15.1 - Expose REST API endpoint for riders to update delivery status
 * @requirements 15.2 - Require authentication via API key
 * @requirements 15.3 - Validate rider is assigned to order before allowing update
 * @requirements 15.4 - Accept status updates: dispatched, in_transit, delivered, failed
 * @requirements 15.5 - Require failureReason field when status is "failed"
 * @requirements 15.7 - Return 403 Forbidden for unauthorized rider attempts
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";

// ============================================================================
// Types
// ============================================================================

/**
 * Valid delivery status values that riders can update to
 * @requirements 15.4 - Accept status updates: dispatched, in_transit, delivered, failed
 */
type RiderDeliveryStatus = "dispatched" | "in_transit" | "delivered" | "failed";

/**
 * Request body for status update
 */
interface StatusUpdateRequest {
  /** Order ID to update */
  orderId: string;
  /** New delivery status */
  status: RiderDeliveryStatus;
  /** Required when status is "failed" */
  failureReason?: string;
  /** Optional rider name for display */
  riderName?: string;
  /** Optional estimated delivery time in minutes */
  estimatedDeliveryMinutes?: number;
}

/**
 * Response body for status update
 */
interface StatusUpdateResponse {
  success: boolean;
  message: string;
  order?: {
    orderId: string;
    deliveryStatus: string;
    riderId?: string;
    riderName?: string;
    dispatchedAt?: number;
    deliveredAt?: number;
    deliveryFailureReason?: string;
  };
  error?: string;
}

/**
 * Audit log entry for API calls
 */
interface AuditLogEntry {
  timestamp: number;
  endpoint: string;
  method: string;
  riderId: string;
  orderId: string;
  status: string;
  success: boolean;
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
  /** Indicates if this was an unauthorized access attempt */
  unauthorizedAttempt?: boolean;
  /** The rider ID that is actually assigned to the order (for unauthorized attempts) */
  assignedRiderId?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Valid status values that riders can set */
const VALID_RIDER_STATUSES: RiderDeliveryStatus[] = [
  "dispatched",
  "in_transit",
  "delivered",
  "failed",
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate API key authentication
 * 
 * @param request - The incoming request
 * @returns Object with isValid flag and riderId if valid
 * 
 * @requirements 15.2 - Require authentication via API key
 */
function validateApiKey(request: NextRequest): { isValid: boolean; riderId?: string } {
  // Check for API key in header
  const apiKey = request.headers.get("x-api-key") || request.headers.get("authorization")?.replace("Bearer ", "");
  
  if (!apiKey) {
    return { isValid: false };
  }
  
  // Get the expected API key from environment
  const expectedApiKey = process.env.RIDER_API_KEY;
  
  // In development mode, allow any API key if not configured
  if (!expectedApiKey) {
    console.warn("RIDER_API_KEY not configured - allowing requests in development mode");
    // Extract rider ID from the API key format: rider_{riderId}_{secret}
    const parts = apiKey.split("_");
    if (parts.length >= 2 && parts[0] === "rider") {
      return { isValid: true, riderId: parts[1] };
    }
    // Default rider ID for development
    return { isValid: true, riderId: "dev-rider" };
  }
  
  // Validate API key format: rider_{riderId}_{secret}
  // This allows us to extract the rider ID from the key
  const parts = apiKey.split("_");
  if (parts.length >= 3 && parts[0] === "rider") {
    const riderId = parts[1];
    const secret = parts.slice(2).join("_");
    
    // Verify the secret portion matches the expected key
    // In production, you would validate against a database of rider API keys
    if (secret === expectedApiKey || apiKey === expectedApiKey) {
      return { isValid: true, riderId };
    }
  }
  
  // Also accept a simple API key match for backward compatibility
  if (apiKey === expectedApiKey) {
    // Extract rider ID from a separate header if using simple key
    const riderId = request.headers.get("x-rider-id") || "unknown";
    return { isValid: true, riderId };
  }
  
  return { isValid: false };
}

/**
 * Get the Convex client instance
 */
function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error("NEXT_PUBLIC_CONVEX_URL environment variable is not set");
    return null;
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * Validate the status update request body
 * 
 * @param body - The request body to validate
 * @returns Validation result with error message if invalid
 * 
 * @requirements 15.4 - Accept status updates: dispatched, in_transit, delivered, failed
 * @requirements 15.5 - Require failureReason field when status is "failed"
 */
function validateRequestBody(body: unknown): { 
  valid: boolean; 
  error?: string; 
  data?: StatusUpdateRequest 
} {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body is required" };
  }
  
  const request = body as Record<string, unknown>;
  
  // Validate orderId
  if (!request.orderId || typeof request.orderId !== "string") {
    return { valid: false, error: "orderId is required and must be a string" };
  }
  
  // Validate status
  if (!request.status || typeof request.status !== "string") {
    return { valid: false, error: "status is required and must be a string" };
  }
  
  if (!VALID_RIDER_STATUSES.includes(request.status as RiderDeliveryStatus)) {
    return { 
      valid: false, 
      error: `Invalid status. Must be one of: ${VALID_RIDER_STATUSES.join(", ")}` 
    };
  }
  
  // Validate failureReason is required when status is "failed"
  // @requirements 15.5 - Require failureReason field when status is "failed"
  if (request.status === "failed") {
    if (!request.failureReason || typeof request.failureReason !== "string" || request.failureReason.trim() === "") {
      return { 
        valid: false, 
        error: "failureReason is required when status is 'failed'" 
      };
    }
  }
  
  return {
    valid: true,
    data: {
      orderId: request.orderId as string,
      status: request.status as RiderDeliveryStatus,
      failureReason: request.failureReason as string | undefined,
      riderName: request.riderName as string | undefined,
      estimatedDeliveryMinutes: request.estimatedDeliveryMinutes as number | undefined,
    },
  };
}

/**
 * Log API call for audit purposes
 * 
 * @param entry - The audit log entry
 * 
 * @requirements 15.8 - Log all API calls for audit purposes
 */
function logAuditEntry(entry: AuditLogEntry): void {
  // In production, this would write to a database or logging service
  // For now, we log to console with structured format
  const logMessage = {
    type: "RIDER_API_AUDIT",
    ...entry,
  };
  
  if (entry.success) {
    console.log(JSON.stringify(logMessage));
  } else {
    console.warn(JSON.stringify(logMessage));
  }
}

/**
 * Extract client information from request for audit logging
 */
function getClientInfo(request: NextRequest): { ipAddress?: string; userAgent?: string } {
  return {
    ipAddress: request.headers.get("x-forwarded-for") || 
               request.headers.get("x-real-ip") || 
               "unknown",
    userAgent: request.headers.get("user-agent") || "unknown",
  };
}

/**
 * Check if a rider is authorized to update an order
 * 
 * A rider is authorized if:
 * 1. They are assigned to the order (order.riderId matches the authenticated riderId)
 * 2. The order has no rider assigned yet (for initial dispatch)
 * 
 * @param order - The order to check
 * @param riderId - The authenticated rider's ID
 * @returns Object with isAuthorized flag and reason
 * 
 * @requirements 15.3 - Validate rider is assigned to order before allowing update
 * @requirements 15.7 - Return 403 Forbidden for unauthorized rider attempts
 */
function checkRiderAuthorization(
  order: { riderId?: string; riderName?: string; deliveryStatus?: string },
  riderId: string
): { isAuthorized: boolean; reason?: string; assignedRiderId?: string } {
  // If no rider is assigned yet, allow the update (for initial dispatch)
  if (!order.riderId) {
    return { isAuthorized: true };
  }
  
  // Check if the authenticated rider is the one assigned to the order
  if (order.riderId === riderId) {
    return { isAuthorized: true };
  }
  
  // Rider is not authorized
  return {
    isAuthorized: false,
    reason: `Rider ${riderId} is not authorized to update this order. Order is assigned to rider ${order.riderId}.`,
    assignedRiderId: order.riderId,
  };
}

// ============================================================================
// API Handlers
// ============================================================================

/**
 * POST handler for rider status updates
 * 
 * Updates the delivery status of an order.
 * 
 * @requirements 15.1 - Expose REST API endpoint for riders to update delivery status
 * @requirements 15.2 - Require authentication via API key
 * @requirements 15.4 - Accept status updates: dispatched, in_transit, delivered, failed
 * @requirements 15.5 - Require failureReason field when status is "failed"
 * @requirements 15.6 - Return updated order details in the response
 */
export async function POST(request: NextRequest): Promise<NextResponse<StatusUpdateResponse>> {
  const clientInfo = getClientInfo(request);
  const timestamp = Date.now();
  
  // Validate API key authentication
  // @requirements 15.2 - Require authentication via API key
  const authResult = validateApiKey(request);
  
  if (!authResult.isValid) {
    logAuditEntry({
      timestamp,
      endpoint: "/api/v1/rider/status",
      method: "POST",
      riderId: "unauthenticated",
      orderId: "unknown",
      status: "unknown",
      success: false,
      errorMessage: "Invalid or missing API key",
      ...clientInfo,
    });
    
    return NextResponse.json(
      {
        success: false,
        message: "Authentication failed",
        error: "Invalid or missing API key. Provide a valid API key in the x-api-key header.",
      },
      { status: 401 }
    );
  }
  
  const riderId = authResult.riderId || "unknown";
  
  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logAuditEntry({
      timestamp,
      endpoint: "/api/v1/rider/status",
      method: "POST",
      riderId,
      orderId: "unknown",
      status: "unknown",
      success: false,
      errorMessage: "Invalid JSON body",
      ...clientInfo,
    });
    
    return NextResponse.json(
      {
        success: false,
        message: "Invalid request",
        error: "Request body must be valid JSON",
      },
      { status: 400 }
    );
  }
  
  // Validate request body
  const validation = validateRequestBody(body);
  
  if (!validation.valid || !validation.data) {
    logAuditEntry({
      timestamp,
      endpoint: "/api/v1/rider/status",
      method: "POST",
      riderId,
      orderId: (body as Record<string, unknown>)?.orderId as string || "unknown",
      status: (body as Record<string, unknown>)?.status as string || "unknown",
      success: false,
      errorMessage: validation.error,
      ...clientInfo,
    });
    
    return NextResponse.json(
      {
        success: false,
        message: "Validation failed",
        error: validation.error,
      },
      { status: 400 }
    );
  }
  
  const { orderId, status, failureReason, riderName, estimatedDeliveryMinutes } = validation.data;
  
  // Initialize Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    logAuditEntry({
      timestamp,
      endpoint: "/api/v1/rider/status",
      method: "POST",
      riderId,
      orderId,
      status,
      success: false,
      errorMessage: "Server configuration error",
      ...clientInfo,
    });
    
    return NextResponse.json(
      {
        success: false,
        message: "Server error",
        error: "Server configuration error. Please try again later.",
      },
      { status: 500 }
    );
  }
  
  try {
    // Get the order to verify it exists and check rider assignment
    const order = await convexClient.query(api.orders.getOrderByOrderId, { orderId });
    
    if (!order) {
      logAuditEntry({
        timestamp,
        endpoint: "/api/v1/rider/status",
        method: "POST",
        riderId,
        orderId,
        status,
        success: false,
        errorMessage: "Order not found",
        ...clientInfo,
      });
      
      return NextResponse.json(
        {
          success: false,
          message: "Order not found",
          error: `No order found with ID: ${orderId}`,
        },
        { status: 404 }
      );
    }
    
    // Check rider authorization
    // @requirements 15.3 - Validate rider is assigned to order before allowing update
    // @requirements 15.7 - Return 403 Forbidden for unauthorized rider attempts
    const authorizationResult = checkRiderAuthorization(order, riderId);
    
    if (!authorizationResult.isAuthorized) {
      // Log unauthorized attempt for audit purposes
      logAuditEntry({
        timestamp,
        endpoint: "/api/v1/rider/status",
        method: "POST",
        riderId,
        orderId,
        status,
        success: false,
        errorMessage: authorizationResult.reason,
        unauthorizedAttempt: true,
        assignedRiderId: authorizationResult.assignedRiderId,
        ...clientInfo,
      });
      
      return NextResponse.json(
        {
          success: false,
          message: "Forbidden",
          error: "Not authorized to update this order. You must be assigned to the order to update its status.",
        },
        { status: 403 }
      );
    }
    
    // Update the delivery status
    await convexClient.mutation(api.orders.updateDeliveryStatus, {
      orderId,
      deliveryStatus: status,
      riderId,
      riderName: riderName || order.riderName,
      deliveryFailureReason: failureReason,
      sendStatusMessage: true,
      estimatedDeliveryMinutes,
    });
    
    // Fetch the updated order to return in response
    // @requirements 15.6 - Return updated order details in the response
    const updatedOrder = await convexClient.query(api.orders.getOrderByOrderId, { orderId });
    
    // Log successful API call
    logAuditEntry({
      timestamp,
      endpoint: "/api/v1/rider/status",
      method: "POST",
      riderId,
      orderId,
      status,
      success: true,
      ...clientInfo,
    });
    
    return NextResponse.json(
      {
        success: true,
        message: `Delivery status updated to '${status}'`,
        order: updatedOrder ? {
          orderId: updatedOrder.orderId,
          deliveryStatus: updatedOrder.deliveryStatus || status,
          riderId: updatedOrder.riderId,
          riderName: updatedOrder.riderName,
          dispatchedAt: updatedOrder.dispatchedAt,
          deliveredAt: updatedOrder.deliveredAt,
          deliveryFailureReason: updatedOrder.deliveryFailureReason,
        } : undefined,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    logAuditEntry({
      timestamp,
      endpoint: "/api/v1/rider/status",
      method: "POST",
      riderId,
      orderId,
      status,
      success: false,
      errorMessage,
      ...clientInfo,
    });
    
    console.error(`Rider API: Error updating delivery status for order ${orderId}:`, error);
    
    return NextResponse.json(
      {
        success: false,
        message: "Failed to update delivery status",
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}

/**
 * GET handler for API health check and documentation
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      message: "Rider Status Update API",
      version: "1.0.0",
      endpoints: {
        "POST /api/v1/rider/status": {
          description: "Update delivery status for an order",
          authentication: "API key required in x-api-key header",
          authorization: "Rider must be assigned to the order, or order must have no rider assigned yet",
          body: {
            orderId: "string (required) - The order ID to update",
            status: "string (required) - One of: dispatched, in_transit, delivered, failed",
            failureReason: "string (required when status is 'failed') - Reason for delivery failure",
            riderName: "string (optional) - Rider's display name",
            estimatedDeliveryMinutes: "number (optional) - Estimated delivery time in minutes",
          },
          responses: {
            200: "Success - Returns updated order details",
            400: "Bad Request - Invalid request body or validation error",
            401: "Unauthorized - Invalid or missing API key",
            403: "Forbidden - Rider is not assigned to this order",
            404: "Not Found - Order not found",
            500: "Server Error - Internal server error",
          },
        },
      },
    },
    { status: 200 }
  );
}
