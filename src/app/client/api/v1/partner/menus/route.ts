/**
 * Partner API - Menus Endpoint
 * 
 * REST API endpoint for partners to access menu data.
 * 
 * @module api/partner/menus
 * @requirements 21.1 - REST API for partner integrations
 * @requirements 21.4 - API exposes endpoints for menus
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

interface MenuItemResponse {
  id: string;
  restaurantId: string;
  branchId?: string;
  name: string;
  price: string;
  priceNumeric?: number;
  description?: string;
  category?: string;
  modifiers?: Array<{ name: string; price: number }>;
  isAvailable?: boolean;
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
// GET - List Menu Items
// ============================================================================

/**
 * GET /api/v1/partner/menus
 * 
 * List all menu items accessible to the partner.
 * 
 * Query Parameters:
 * - restaurantId: Filter by restaurant ID (required)
 * - branchId: Filter by branch ID (optional)
 * - category: Filter by category (optional)
 * - page: Page number (default: 1)
 * - perPage: Items per page (default: 50, max: 200)
 */
export async function GET(request: NextRequest): Promise<NextResponse<ApiSuccessResponse<MenuItemResponse[]> | ApiErrorResponse>> {
  // Validate API request
  const validation = await validateApiRequest(request, {
    requiredScopes: ['menus:read'],
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
    const category = searchParams.get('category');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(200, Math.max(1, parseInt(searchParams.get('perPage') || '50', 10)));
    
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
    
    // Get menu items
    const menuItems = await convexClient.query(api.menuItems.getMenuItems, {
      restaurantId,
    });
    
    // Filter by branch if specified
    let filteredItems = menuItems;
    if (branchId) {
      filteredItems = menuItems.filter((item: { branchId?: string }) => 
        !item.branchId || item.branchId === branchId
      );
    }
    
    // Filter by category if specified
    if (category) {
      filteredItems = filteredItems.filter((item: { category?: string }) => 
        item.category?.toLowerCase() === category.toLowerCase()
      );
    }
    
    // Apply pagination
    const total = filteredItems.length;
    const totalPages = Math.ceil(total / perPage);
    const startIndex = (page - 1) * perPage;
    const paginatedItems = filteredItems.slice(startIndex, startIndex + perPage);
    
    // Map to response format
    const responseData: MenuItemResponse[] = paginatedItems.map((item: { _id: string; restaurantId: string; branchId?: string; name: string; price: string; priceNumeric?: number; description?: string; category?: string; modifiers?: Array<{ name: string; price: number }>; isAvailable?: boolean }) => ({
      id: item._id,
      restaurantId: item.restaurantId,
      branchId: item.branchId,
      name: item.name,
      price: item.price,
      priceNumeric: item.priceNumeric,
      description: item.description,
      category: item.category,
      modifiers: item.modifiers,
      isAvailable: item.isAvailable,
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
    console.error('Partner API: Error fetching menu items:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch menu items' },
      { status: 500 }
    );
  }
}
