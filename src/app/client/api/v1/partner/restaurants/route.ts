/**
 * Partner API - Restaurants Endpoint
 * 
 * REST API endpoint for partners to access restaurant data.
 * 
 * @module api/partner/restaurants
 * @requirements 21.1 - REST API for partner integrations
 * @requirements 21.4 - API exposes endpoints for restaurants
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../../../convex/_generated/api';
import { validateApiRequest } from '@/lib/partner-api/middleware';
import { getRateLimitHeaders, checkRateLimit } from '@/lib/partner-api/rate-limiter';
import { authorizeResourceAccess } from '@/lib/partner-api/authorization';
import { logPartnerApiAudit } from '@/lib/partner-api/auditLogger';
import type { ApiErrorResponse, ApiSuccessResponse } from '@/lib/partner-api/types';

// ============================================================================
// Types
// ============================================================================

interface RestaurantResponse {
  restaurantId: string;
  businessId: string;
  platformId: string;
  name: string;
  agentName: string;
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
// GET - List Restaurants
// ============================================================================

/**
 * GET /api/v1/partner/restaurants
 * 
 * List all restaurants accessible to the partner.
 * 
 * Query Parameters:
 * - page: Page number (default: 1)
 * - perPage: Items per page (default: 20, max: 100)
 */
export async function GET(request: NextRequest): Promise<NextResponse<ApiSuccessResponse<RestaurantResponse[]> | ApiErrorResponse>> {
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
    // Get partner to determine accessible restaurants
    const partner = await convexClient.query(api.partners.getPartnerByPartnerId, {
      partnerId: context.partnerId,
    });
    
    if (!partner) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Partner not found' },
        { status: 404 }
      );
    }
    
    // Get restaurants for the partner's platform
    const restaurants = await convexClient.query(api.restaurants.getRestaurantsByPlatform, {
      platformId: partner.platformId,
    });
    
    // Authorize: filter to only restaurants the partner owns
    const authorizedRestaurants = [];
    for (const r of restaurants) {
      const authz = await authorizeResourceAccess(convexClient, context.partnerId, 'restaurant', r.restaurantId);
      if (authz.authorized) {
        authorizedRestaurants.push(r);
      }
    }
    
    // Parse pagination parameters
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') || '20', 10)));
    
    // Apply pagination
    const total = authorizedRestaurants.length;
    const totalPages = Math.ceil(total / perPage);
    const startIndex = (page - 1) * perPage;
    const paginatedRestaurants = authorizedRestaurants.slice(startIndex, startIndex + perPage);
    
    // Map to response format
    const responseData: RestaurantResponse[] = paginatedRestaurants.map((r: { restaurantId: string; platformId: string; name: string; agentName: string; languagePreference: string; branchCount?: number; createdAt: number }) => ({
      restaurantId: r.restaurantId,
      businessId: r.restaurantId,
      platformId: r.platformId,
      name: r.name,
      agentName: r.agentName,
      languagePreference: r.languagePreference,
      branchCount: r.branchCount,
      createdAt: r.createdAt,
    }));
    
    // Add rate limit headers
    const rateLimitStatus = await checkRateLimit(context.apiKey);
    const headers = getRateLimitHeaders(rateLimitStatus);

    // Audit log (REQ-9.1)
    logPartnerApiAudit(convexClient, {
      businessId: partner.platformId,
      partnerId: context.partnerId,
      endpoint: "/api/v1/partner/restaurants",
      method: "GET",
      statusCode: 200,
      requestId: context.requestId,
    });
    
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
    console.error('Partner API: Error fetching restaurants:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch restaurants' },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET - API Documentation
// ============================================================================

/**
 * OPTIONS - Return API documentation
 */
export async function OPTIONS(): Promise<NextResponse> {
  return NextResponse.json({
    endpoint: '/api/v1/partner/restaurants',
    methods: {
      GET: {
        description: 'List all restaurants accessible to the partner',
        authentication: 'API key required (Bearer token or X-API-Key header)',
        requiredScopes: ['restaurants:read'],
        queryParameters: {
          page: 'Page number (default: 1)',
          perPage: 'Items per page (default: 20, max: 100)',
        },
        response: {
          success: true,
          data: '[Array of restaurant objects]',
          pagination: {
            page: 'Current page',
            perPage: 'Items per page',
            total: 'Total items',
            totalPages: 'Total pages',
            hasMore: 'Whether more pages exist',
          },
        },
      },
    },
  });
}
