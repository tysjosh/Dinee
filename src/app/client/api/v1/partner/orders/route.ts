/**
 * Partner API - Orders Endpoint
 * 
 * REST API endpoint for partners to access order data.
 * 
 * @module api/partner/orders
 * @requirements 21.1 - REST API for partner integrations
 * @requirements 21.4 - API exposes endpoints for orders
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../convex/_generated/api';
import { validateApiRequest } from '@/lib/partner-api/middleware';
import { getRateLimitHeaders, checkRateLimit } from '@/lib/partner-api/rate-limiter';
import { authorizeResourceAccess } from '@/lib/partner-api/authorization';
import type { ApiErrorResponse, ApiSuccessResponse } from '@/lib/partner-api/types';

// ============================================================================
// Types
// ============================================================================

interface OrderResponse {
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
  deliveryStatus?: string;
  riderName?: string;
  orderPlacementTime?: number;
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
// GET - List Orders
// ============================================================================

/**
 * GET /api/v1/partner/orders
 * 
 * List all orders accessible to the partner.
 * 
 * Query Parameters:
 * - restaurantId: Filter by restaurant ID (required)
 * - branchId: Filter by branch ID (optional)
 * - status: Filter by order status (optional)
 * - paymentStatus: Filter by payment status (optional)
 * - startDate: Filter orders after this timestamp (optional)
 * - endDate: Filter orders before this timestamp (optional)
 * - page: Page number (default: 1)
 * - perPage: Items per page (default: 20, max: 100)
 */
export async function GET(request: NextRequest): Promise<NextResponse<ApiSuccessResponse<OrderResponse[]> | ApiErrorResponse>> {
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
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const restaurantId = searchParams.get('restaurantId');
    const branchId = searchParams.get('branchId');
    const status = searchParams.get('status');
    const paymentStatus = searchParams.get('paymentStatus');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') || '20', 10)));
    
    if (!restaurantId) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'restaurantId query parameter is required' },
        { status: 400 }
      );
    }
    
    // Authorize: verify partner owns this restaurant
    const authz = await authorizeResourceAccess(convexClient, context.partnerId, 'restaurant', restaurantId);
    if (!authz.authorized) {
      return NextResponse.json(
        { error: 'Forbidden', message: authz.error ?? 'Access denied' },
        { status: 403 }
      );
    }
    
    // Get orders
    const orders = await convexClient.query(api.orders.getOrdersByRestaurant, {
      restaurantId,
    });
    
    // Define order type for filtering
    type OrderType = {
      orderId: string;
      restaurantId: string;
      branchId?: string;
      callId?: string;
      customerName: string;
      customerPhone?: string;
      items: Array<{ name: string; quantity: number; price: number; modifiers?: Array<{ name: string; price: number }> }>;
      specialInstructions?: string;
      totalAmount?: number;
      status: string;
      paymentMethod?: string;
      paymentStatus?: string;
      deliveryStatus?: string;
      riderName?: string;
      orderPlacementTime?: number;
    };
    
    // Apply filters
    let filteredOrders: OrderType[] = orders;
    
    if (branchId) {
      filteredOrders = filteredOrders.filter((order: OrderType) => order.branchId === branchId);
    }
    
    if (status) {
      filteredOrders = filteredOrders.filter((order: OrderType) => order.status === status);
    }
    
    if (paymentStatus) {
      filteredOrders = filteredOrders.filter((order: OrderType) => order.paymentStatus === paymentStatus);
    }
    
    if (startDate) {
      const startTimestamp = parseInt(startDate, 10);
      filteredOrders = filteredOrders.filter((order: OrderType) => 
        (order.orderPlacementTime || 0) >= startTimestamp
      );
    }
    
    if (endDate) {
      const endTimestamp = parseInt(endDate, 10);
      filteredOrders = filteredOrders.filter((order: OrderType) => 
        (order.orderPlacementTime || 0) <= endTimestamp
      );
    }
    
    // Sort by order placement time descending
    filteredOrders.sort((a: OrderType, b: OrderType) => 
      (b.orderPlacementTime || 0) - (a.orderPlacementTime || 0)
    );
    
    // Apply pagination
    const total = filteredOrders.length;
    const totalPages = Math.ceil(total / perPage);
    const startIndex = (page - 1) * perPage;
    const paginatedOrders = filteredOrders.slice(startIndex, startIndex + perPage);
    
    // Map to response format
    const responseData: OrderResponse[] = paginatedOrders.map((order: OrderType) => ({
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
      deliveryStatus: order.deliveryStatus,
      riderName: order.riderName,
      orderPlacementTime: order.orderPlacementTime,
    }));
    
    // Add rate limit headers
    const rateLimitStatus = await checkRateLimit(context.apiKey);
    const headers = getRateLimitHeaders(rateLimitStatus);
    
    return NextResponse.json(
      {
        success: true as const,
        data: responseData,
        pagination: {
          page,
          perPage,
          total,
          totalPages,
          hasMore: page < totalPages,
        },
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
    console.error('Partner API: Error fetching orders:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}
