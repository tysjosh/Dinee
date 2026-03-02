/**
 * Partner API - Branches Endpoint
 * 
 * REST API endpoint for partners to access branch data.
 * 
 * @module api/partner/branches
 * @requirements 21.1 - REST API for partner integrations
 * @requirements 21.4 - API exposes endpoints for branches
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

interface BranchResponse {
  branchId: string;
  restaurantId: string;
  name: string;
  address: string;
  phoneNumber: string;
  operatingHours: Record<string, { open: string; close: string } | undefined>;
  isActive: boolean;
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
// GET - List Branches
// ============================================================================

/**
 * GET /api/v1/partner/branches
 * 
 * List all branches accessible to the partner.
 * 
 * Query Parameters:
 * - restaurantId: Filter by restaurant ID (optional)
 * - page: Page number (default: 1)
 * - perPage: Items per page (default: 20, max: 100)
 */
export async function GET(request: NextRequest): Promise<NextResponse<ApiSuccessResponse<BranchResponse[]> | ApiErrorResponse>> {
  // Validate API request
  const validation = await validateApiRequest(request, {
    requiredScopes: ['branches:read'],
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
    const restaurantIdFilter = searchParams.get('restaurantId');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') || '20', 10)));
    
    // If a specific restaurantId is provided, authorize access to it
    if (restaurantIdFilter) {
      const authz = await authorizeResourceAccess(convexClient, context.partnerId, 'restaurant', restaurantIdFilter);
      if (!authz.authorized) {
        return NextResponse.json(
          { error: 'Forbidden', message: authz.error ?? 'Access denied' },
          { status: 403 }
        );
      }
    }
    
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
    
    // Filter by partner's restaurant access
    let accessibleRestaurantIds = restaurants.map((r: { restaurantId: string }) => r.restaurantId);
    if (partner.restaurantIds && partner.restaurantIds.length > 0) {
      accessibleRestaurantIds = accessibleRestaurantIds.filter((id: string) => 
        partner.restaurantIds!.includes(id)
      );
    }
    
    // Apply restaurant filter if specified (already authorized above)
    if (restaurantIdFilter) {
      accessibleRestaurantIds = [restaurantIdFilter];
    }
    
    // Get branches for all accessible restaurants
    const allBranches: BranchResponse[] = [];
    for (const restaurantId of accessibleRestaurantIds) {
      const branches = await convexClient.query(api.branches.getBranchesByRestaurant, {
        restaurantId,
      });
      
      for (const branch of branches) {
        allBranches.push({
          branchId: branch.branchId,
          restaurantId: branch.restaurantId,
          name: branch.name,
          address: branch.address,
          phoneNumber: branch.phoneNumber,
          operatingHours: branch.operatingHours,
          isActive: branch.isActive,
          createdAt: branch.createdAt,
        });
      }
    }
    
    // Apply pagination
    const total = allBranches.length;
    const totalPages = Math.ceil(total / perPage);
    const startIndex = (page - 1) * perPage;
    const paginatedBranches = allBranches.slice(startIndex, startIndex + perPage);
    
    // Add rate limit headers
    const rateLimitStatus = await checkRateLimit(context.apiKey);
    const headers = getRateLimitHeaders(rateLimitStatus);
    
    return NextResponse.json(
      {
        success: true as const,
        data: paginatedBranches,
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
    console.error('Partner API: Error fetching branches:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch branches' },
      { status: 500 }
    );
  }
}
