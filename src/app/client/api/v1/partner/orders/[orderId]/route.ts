/**
 * Partner API - Single Order Endpoint
 * 
 * REST API endpoint for partners to access a specific order.
 * 
 * @module api/partner/orders/[orderId]
 * @requirements 21.1 - REST API for partner integrations
 * @requirements 21.4 - API exposes endpoints for orders
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../../convex/_generated/api';
import { validateApiRequest } from '@/lib/partner-api/middleware';
import { getRateLimitHeaders, checkRateLimit } from '@/lib/partner-api/rate-limiter';
import type { ApiErrorResponse, ApiSuccessResponse } from '@/lib/partner-api/types';

// ============================================================================
// Types
// ============================================================================

interface OrderDetailResponse {
  orderId: string;
  restaurantId: string;
  branchId?: string;
  callId?: string;
  customerName: string;
  customerPhone?: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    modifiers?: Array<{ name: string; price: number }>;
  }>;
  specialInstructions?: string;
  totalAmount?: number;
  status: string;
  paymentMethod?: string;
  paymentStatus?: string;
  paymentReference?: string;
  paymentTimestamp?: number;
  deliveryStatus?: string;
  riderId?: string;
  riderName?: string;
  dispatchedAt?: number;
  deliveredAt?: number;
  deliveryFailureReason?: string;
  whatsappOptIn?: boolean;
  orderPlacementTime?: number;
  cancellationReason?: string;
}

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

// ============================================================================
// GET - Get Order by ID
// ============================================================================

/**
 * GET /api/v1/partner/orders/:orderId
 * 
 * Get a specific order by ID.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
): Promise<NextResponse<ApiSuccessResponse<OrderDetailResponse> | ApiErrorResponse>> {
  const { orderId } = await params;
  
  // Validate API request
  const validation = await validateApiRequest(request, {
    requiredScopes: ['orders:read'],
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
    // Get partner to check restaurant access
    const partner = await convexClient.query(api.partners.getPartnerByPartnerId, {
      partnerId: context.partnerId,
    });
    
    if (!partner) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Partner not found' },
        { status: 404 }
      );
    }
    
    // Get the order
    const order = await convexClient.query(api.orders.getOrderByOrderIdOnly, {
      orderId,
    });
    
    if (!order) {
      return NextResponse.json(
        { error: 'Not Found', message: `Order not found: ${orderId}` },
        { status: 404 }
      );
    }
    
    // Check if partner has access to this restaurant
    const restaurant = await convexClient.query(api.restaurants.getRestaurant, {
      restaurantId: order.restaurantId,
    });
    
    if (!restaurant || restaurant.platformId !== partner.platformId) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Access denied to this order' },
        { status: 403 }
      );
    }
    
    if (partner.restaurantIds && partner.restaurantIds.length > 0) {
      if (!partner.restaurantIds.includes(order.restaurantId)) {
        return NextResponse.json(
          { error: 'Forbidden', message: 'Access denied to this order' },
          { status: 403 }
        );
      }
    }
    
    // Map to response format
    const responseData: OrderDetailResponse = {
      orderId: order.orderId,
      restaurantId: order.restaurantId,
      branchId: order.branchId,
      callId: order.callId,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      items: order.items,
      specialInstructions: order.specialInstructions,
      totalAmount: order.totalAmount,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentReference: order.paymentReference,
      paymentTimestamp: order.paymentTimestamp,
      deliveryStatus: order.deliveryStatus,
      riderId: order.riderId,
      riderName: order.riderName,
      dispatchedAt: order.dispatchedAt,
      deliveredAt: order.deliveredAt,
      deliveryFailureReason: order.deliveryFailureReason,
      whatsappOptIn: order.whatsappOptIn,
      orderPlacementTime: order.orderPlacementTime,
      cancellationReason: order.cancellationReason,
    };
    
    // Add rate limit headers
    const rateLimitStatus = checkRateLimit(context.apiKey);
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
    console.error('Partner API: Error fetching order:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch order' },
      { status: 500 }
    );
  }
}
