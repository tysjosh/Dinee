/**
 * Partner API - Single Restaurant Endpoint
 * 
 * REST API endpoint for partners to access a specific restaurant.
 * 
 * @module api/partner/restaurants/[restaurantId]
 * @requirements 21.1 - REST API for partner integrations
 * @requirements 21.4 - API exposes endpoints for restaurants
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../../convex/_generated/api';
import { validateApiRequest } from '@/lib/partner-api/middleware';
import { getRateLimitHeaders, checkRateLimit } from '@/lib/partner-api/rate-limiter';
import { authorizeResourceAccess } from '@/lib/partner-api/authorization';
import type { ApiErrorResponse, ApiSuccessResponse } from '@/lib/partner-api/types';

// ============================================================================
// Types
// ============================================================================

interface RestaurantDetailResponse {
  restaurantId: string;
  platformId: string;
  name: string;
  agentName: string;
  specialInstructions: string;
  languagePreference: string;
  branchCount?: number;
  createdAt: number;
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
// GET - Get Restaurant by ID
// ============================================================================

/**
 * GET /api/v1/partner/restaurants/:restaurantId
 * 
 * Get a specific restaurant by ID.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ restaurantId: string }> }
): Promise<NextResponse<ApiSuccessResponse<RestaurantDetailResponse> | ApiErrorResponse>> {
  const { restaurantId } = await params;
  
  // Validate API request
  const validation = await validateApiRequest(request, {
    requiredScopes: ['restaurants:read'],
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
    // Authorize: verify partner owns this restaurant
    const authz = await authorizeResourceAccess(convexClient, context.partnerId, 'restaurant', restaurantId);
    if (!authz.authorized) {
      return NextResponse.json(
        { error: 'Forbidden', message: authz.error ?? 'Access denied' },
        { status: 403 }
      );
    }
    
    // Get the restaurant
    const restaurant = await convexClient.query(api.restaurants.getRestaurant, {
      restaurantId,
    });
    
    if (!restaurant) {
      return NextResponse.json(
        { error: 'Not Found', message: `Restaurant not found: ${restaurantId}` },
        { status: 404 }
      );
    }
    
    // Map to response format
    const responseData: RestaurantDetailResponse = {
      restaurantId: restaurant.restaurantId,
      platformId: restaurant.platformId,
      name: restaurant.name,
      agentName: restaurant.agentName,
      specialInstructions: restaurant.specialInstructions,
      languagePreference: restaurant.languagePreference,
      branchCount: restaurant.branchCount,
      createdAt: restaurant.createdAt,
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
    console.error('Partner API: Error fetching restaurant:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch restaurant' },
      { status: 500 }
    );
  }
}
