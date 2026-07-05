/**
 * Partner API - Webhooks Management Endpoint
 * 
 * REST API endpoint for partners to manage webhook subscriptions.
 * 
 * @module api/partner/webhooks
 * @requirements 21.5 - Webhook delivery for events
 * @requirements 21.6 - Retry failed deliveries up to 5 times with exponential backoff
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../convex/_generated/api';
import type { Doc } from '../../../../../../../convex/_generated/dataModel';
import { validateApiRequest } from '@/lib/partner-api/middleware';
import { getRateLimitHeaders, checkRateLimit } from '@/lib/partner-api/rate-limiter';
import { authorizeResourceAccess } from '@/lib/partner-api/authorization';
import { logPartnerApiAudit } from '@/lib/partner-api/auditLogger';
import type { ApiErrorResponse, ApiSuccessResponse, WebhookEventType } from '@/lib/partner-api/types';
import crypto from 'crypto';

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

interface CreateWebhookRequest {
  url: string;
  events: WebhookEventType[];
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

function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`;
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
// GET - List Webhook Subscriptions
// ============================================================================

/**
 * GET /api/v1/partner/webhooks
 * 
 * List all webhook subscriptions for the partner.
 */
export async function GET(request: NextRequest): Promise<NextResponse<ApiSuccessResponse<WebhookSubscriptionResponse[]> | ApiErrorResponse>> {
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
    // Get webhook subscriptions for the partner
    const subscriptions = await convexClient.query(
      api.webhookSubscriptions.getWebhookSubscriptionsByPartnerId,
      { partnerId: context.partnerId }
    );
    
    // Map to response format (exclude secret)
    const responseData: WebhookSubscriptionResponse[] = subscriptions.map((sub: Doc<"webhookSubscriptions">) => ({
      id: sub.subscriptionId,
      url: sub.url,
      events: sub.events,
      isActive: sub.isActive,
      createdAt: sub.createdAt,
      updatedAt: sub.updatedAt,
    }));
    
    // Add rate limit headers
    const rateLimitStatus = await checkRateLimit(context.apiKey);
    const headers = getRateLimitHeaders(rateLimitStatus);

    // Audit log (REQ-9.1)
    logPartnerApiAudit(convexClient, {
      businessId: "",
      partnerId: context.partnerId,
      endpoint: "/api/v1/partner/webhooks",
      method: "GET",
      statusCode: 200,
      requestId: context.requestId,
    });
    
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
    console.error('Partner API: Error fetching webhooks:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch webhooks' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - Create Webhook Subscription
// ============================================================================

/**
 * POST /api/v1/partner/webhooks
 * 
 * Create a new webhook subscription.
 * 
 * Request Body:
 * - url: HTTPS URL to deliver webhooks to (required)
 * - events: Array of event types to subscribe to (required)
 */
export async function POST(request: NextRequest): Promise<NextResponse<ApiSuccessResponse<WebhookSubscriptionResponse & { secret: string }> | ApiErrorResponse>> {
  // Validate API request
  const validation = await validateApiRequest(request, {
    requiredScopes: ['webhooks:manage'],
  });
  
  if (!validation.success || !validation.context) {
    return validation.errorResponse as NextResponse<ApiErrorResponse>;
  }
  
  const { context } = validation;
  
  // Parse request body
  let body: CreateWebhookRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Bad Request', message: 'Invalid JSON body' },
      { status: 400 }
    );
  }
  
  // Validate URL
  if (!body.url || typeof body.url !== 'string') {
    return NextResponse.json(
      { error: 'Bad Request', message: 'url is required' },
      { status: 400 }
    );
  }
  
  if (!isValidUrl(body.url)) {
    return NextResponse.json(
      { error: 'Bad Request', message: 'url must be a valid HTTPS URL' },
      { status: 400 }
    );
  }
  
  // Validate events
  if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json(
      { error: 'Bad Request', message: 'events array is required and must not be empty' },
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
  
  // Get Convex client
  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Server configuration error' },
      { status: 500 }
    );
  }
  
  try {
    // Generate subscription ID and secret
    const subscriptionId = `wh_${crypto.randomBytes(16).toString('hex')}`;
    const secret = generateWebhookSecret();
    const now = Date.now();
    
    // Create the subscription
    await convexClient.mutation(api.webhookSubscriptions.createWebhookSubscription, {
      subscriptionId,
      partnerId: context.partnerId,
      url: body.url,
      events: body.events,
      secret,
      mode: body.mode,
      tenantId: body.tenantId,
    });
    
    // Add rate limit headers
    const rateLimitStatus = await checkRateLimit(context.apiKey);
    const headers = getRateLimitHeaders(rateLimitStatus);

    // Audit log (REQ-9.1)
    logPartnerApiAudit(convexClient, {
      businessId: body.tenantId ?? "",
      partnerId: context.partnerId,
      endpoint: "/api/v1/partner/webhooks",
      method: "POST",
      statusCode: 201,
      requestId: context.requestId,
    });
    
    return NextResponse.json(
      {
        success: true as const,
        data: {
          id: subscriptionId,
          url: body.url,
          events: body.events,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          secret, // Only returned on creation
        },
      },
      {
        status: 201,
        headers: {
          ...headers,
          'X-Request-Id': context.requestId,
        },
      }
    );
  } catch (error) {
    console.error('Partner API: Error creating webhook:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to create webhook' },
      { status: 500 }
    );
  }
}
