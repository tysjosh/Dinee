/**
 * Partner API - Single Webhook Subscription Endpoint
 * 
 * REST API endpoint for partners to manage a specific webhook subscription.
 * 
 * @module api/partner/webhooks/[subscriptionId]
 * @requirements 21.5 - Webhook delivery for events
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../../convex/_generated/api';
import { validateApiRequest } from '@/lib/partner-api/middleware';
import { getRateLimitHeaders, checkRateLimit } from '@/lib/partner-api/rate-limiter';
import { authorizeResourceAccess } from '@/lib/partner-api/authorization';
import type { ApiErrorResponse, ApiSuccessResponse, WebhookEventType } from '@/lib/partner-api/types';

// ============================================================================
// Types
// ============================================================================

interface WebhookSubscriptionResponse {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

interface UpdateWebhookRequest {
  url?: string;
  events?: WebhookEventType[];
  isActive?: boolean;
  mode?: "partner" | "runsheet";
  tenantId?: string;
}

// ============================================================================
// Constants
// ============================================================================

const VALID_EVENTS: WebhookEventType[] = [
  'order.created',
  'order.updated',
  'order.completed',
  'order.cancelled',
  'call.started',
  'call.ended',
  'shipment.created',
  'shipment.assigned',
  'shipment.status_updated',
  'shipment.delivered',
  'shipment.failed',
];

// ============================================================================
// Helper Functions
// ============================================================================

function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return null;
  }
  return new ConvexHttpClient(convexUrl);
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ============================================================================
// GET - Get Webhook Subscription
// ============================================================================

/**
 * GET /api/v1/partner/webhooks/:subscriptionId
 * 
 * Get a specific webhook subscription.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ subscriptionId: string }> }
): Promise<NextResponse<ApiSuccessResponse<WebhookSubscriptionResponse> | ApiErrorResponse>> {
  const { subscriptionId } = await params;
  
  // Validate API request
  const validation = await validateApiRequest(request, {
    requiredScopes: ['webhooks:manage'],
  });
  
  if (!validation.success || !validation.context) {
    return validation.errorResponse as NextResponse<ApiErrorResponse>;
  }
  
  const { context } = validation;
  
  // Get Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Server configuration error' },
      { status: 500 }
    );
  }
  
  try {
    // Get the subscription
    const subscription = await convexClient.query(
      api.webhookSubscriptions.getWebhookSubscriptionById,
      { subscriptionId }
    );
    
    if (!subscription) {
      return NextResponse.json(
        { error: 'Not Found', message: `Webhook subscription not found: ${subscriptionId}` },
        { status: 404 }
      );
    }
    
    // Check ownership
    if (subscription.partnerId !== context.partnerId) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Access denied to this webhook subscription' },
        { status: 403 }
      );
    }
    
    // Map to response format (exclude secret)
    const responseData: WebhookSubscriptionResponse = {
      id: subscription.subscriptionId,
      url: subscription.url,
      events: subscription.events,
      isActive: subscription.isActive,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    };
    
    // Add rate limit headers
    const rateLimitStatus = await checkRateLimit(context.apiKey);
    const headers = getRateLimitHeaders(rateLimitStatus);
    
    return NextResponse.json(
      {
        success: true as const,
        data: responseData,
      },
      {
        status: 200,
        headers: {
          ...headers,
          'X-Request-Id': context.requestId,
        },
      }
    );
  } catch (error) {
    console.error('Partner API: Error fetching webhook:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch webhook' },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH - Update Webhook Subscription
// ============================================================================

/**
 * PATCH /api/v1/partner/webhooks/:subscriptionId
 * 
 * Update a webhook subscription.
 * 
 * Request Body:
 * - url: HTTPS URL to deliver webhooks to (optional)
 * - events: Array of event types to subscribe to (optional)
 * - isActive: Whether the subscription is active (optional)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ subscriptionId: string }> }
): Promise<NextResponse<ApiSuccessResponse<WebhookSubscriptionResponse> | ApiErrorResponse>> {
  const { subscriptionId } = await params;
  
  // Validate API request
  const validation = await validateApiRequest(request, {
    requiredScopes: ['webhooks:manage'],
  });
  
  if (!validation.success || !validation.context) {
    return validation.errorResponse as NextResponse<ApiErrorResponse>;
  }
  
  const { context } = validation;
  
  // Parse request body
  let body: UpdateWebhookRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Bad Request', message: 'Invalid JSON body' },
      { status: 400 }
    );
  }
  
  // Validate URL if provided
  if (body.url !== undefined) {
    if (typeof body.url !== 'string' || !isValidUrl(body.url)) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'url must be a valid HTTPS URL' },
        { status: 400 }
      );
    }
  }
  
  // Validate events if provided
  if (body.events !== undefined) {
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'events array must not be empty' },
        { status: 400 }
      );
    }
    
    const invalidEvents = body.events.filter(e => !VALID_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      return NextResponse.json(
        { 
          error: 'Bad Request', 
          message: `Invalid events: ${invalidEvents.join(', ')}. Valid events are: ${VALID_EVENTS.join(', ')}` 
        },
        { status: 400 }
      );
    }
  }
  
  // Get Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Server configuration error' },
      { status: 500 }
    );
  }
  
  try {
    // Get the subscription to check ownership
    const subscription = await convexClient.query(
      api.webhookSubscriptions.getWebhookSubscriptionById,
      { subscriptionId }
    );
    
    if (!subscription) {
      return NextResponse.json(
        { error: 'Not Found', message: `Webhook subscription not found: ${subscriptionId}` },
        { status: 404 }
      );
    }
    
    // Check ownership
    if (subscription.partnerId !== context.partnerId) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Access denied to this webhook subscription' },
        { status: 403 }
      );
    }
    
    // Update the subscription
    await convexClient.mutation(api.webhookSubscriptions.updateWebhookSubscription, {
      subscriptionId,
      url: body.url,
      events: body.events,
      isActive: body.isActive,
      mode: body.mode,
      tenantId: body.tenantId,
    });
    
    // Get the updated subscription
    const updatedSubscription = await convexClient.query(
      api.webhookSubscriptions.getWebhookSubscriptionById,
      { subscriptionId }
    );
    
    if (!updatedSubscription) {
      return NextResponse.json(
        { error: 'Internal Server Error', message: 'Failed to fetch updated webhook' },
        { status: 500 }
      );
    }
    
    // Map to response format
    const responseData: WebhookSubscriptionResponse = {
      id: updatedSubscription.subscriptionId,
      url: updatedSubscription.url,
      events: updatedSubscription.events,
      isActive: updatedSubscription.isActive,
      createdAt: updatedSubscription.createdAt,
      updatedAt: updatedSubscription.updatedAt,
    };
    
    // Add rate limit headers
    const rateLimitStatus = await checkRateLimit(context.apiKey);
    const headers = getRateLimitHeaders(rateLimitStatus);
    
    return NextResponse.json(
      {
        success: true as const,
        data: responseData,
      },
      {
        status: 200,
        headers: {
          ...headers,
          'X-Request-Id': context.requestId,
        },
      }
    );
  } catch (error) {
    console.error('Partner API: Error updating webhook:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to update webhook' },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - Delete Webhook Subscription
// ============================================================================

/**
 * DELETE /api/v1/partner/webhooks/:subscriptionId
 * 
 * Delete a webhook subscription.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ subscriptionId: string }> }
): Promise<NextResponse<ApiSuccessResponse<{ deleted: boolean }> | ApiErrorResponse>> {
  const { subscriptionId } = await params;
  
  // Validate API request
  const validation = await validateApiRequest(request, {
    requiredScopes: ['webhooks:manage'],
  });
  
  if (!validation.success || !validation.context) {
    return validation.errorResponse as NextResponse<ApiErrorResponse>;
  }
  
  const { context } = validation;
  
  // Get Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Server configuration error' },
      { status: 500 }
    );
  }
  
  try {
    // Get the subscription to check ownership
    const subscription = await convexClient.query(
      api.webhookSubscriptions.getWebhookSubscriptionById,
      { subscriptionId }
    );
    
    if (!subscription) {
      return NextResponse.json(
        { error: 'Not Found', message: `Webhook subscription not found: ${subscriptionId}` },
        { status: 404 }
      );
    }
    
    // Check ownership
    if (subscription.partnerId !== context.partnerId) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Access denied to this webhook subscription' },
        { status: 403 }
      );
    }
    
    // Delete the subscription
    await convexClient.mutation(api.webhookSubscriptions.deleteWebhookSubscription, {
      subscriptionId,
    });
    
    // Add rate limit headers
    const rateLimitStatus = await checkRateLimit(context.apiKey);
    const headers = getRateLimitHeaders(rateLimitStatus);
    
    return NextResponse.json(
      {
        success: true as const,
        data: { deleted: true },
      },
      {
        status: 200,
        headers: {
          ...headers,
          'X-Request-Id': context.requestId,
        },
      }
    );
  } catch (error) {
    console.error('Partner API: Error deleting webhook:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to delete webhook' },
      { status: 500 }
    );
  }
}
