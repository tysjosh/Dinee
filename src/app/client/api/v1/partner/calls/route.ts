/**
 * Partner API - Calls Endpoint
 * 
 * REST API endpoint for partners to access call data.
 * 
 * @module api/partner/calls
 * @requirements 21.1 - REST API for partner integrations
 * @requirements 21.4 - API exposes endpoints for calls
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

interface CallResponse {
  callId: string;
  orderId?: string;
  restaurantId?: string;
  branchId?: string;
  phoneNumber?: string;
  callStartTime?: number;
  callEndTime?: number;
  duration?: number;
  status?: string;
  asrConfidence?: number;
  languageDetected?: string;
  fallbackTriggered?: boolean;
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
// GET - List Calls
// ============================================================================

/**
 * GET /api/v1/partner/calls
 * 
 * List all calls accessible to the partner.
 * 
 * Query Parameters:
 * - restaurantId: Filter by restaurant ID (required)
 * - branchId: Filter by branch ID (optional)
 * - status: Filter by call status (optional)
 * - startDate: Filter calls after this timestamp (optional)
 * - endDate: Filter calls before this timestamp (optional)
 * - page: Page number (default: 1)
 * - perPage: Items per page (default: 20, max: 100)
 */
export async function GET(request: NextRequest): Promise<NextResponse<ApiSuccessResponse<CallResponse[]> | ApiErrorResponse>> {
  // Validate API request
  const validation = await validateApiRequest(request, {
    requiredScopes: ['calls:read'],
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
    
    // Get calls
    const calls = await convexClient.query(api.calls.getCallsByRestaurant, {
      restaurantId,
    });
    
    // Define call type for filtering
    type CallType = {
      callId: string;
      orderId?: string;
      restaurantId?: string;
      branchId?: string;
      phoneNumber?: string;
      callStartTime?: number;
      callEndTime?: number;
      duration?: number;
      status?: string;
      asrConfidence?: number;
      languageDetected?: string;
      fallbackTriggered?: boolean;
    };
    
    // Apply filters
    let filteredCalls: CallType[] = calls;
    
    if (branchId) {
      filteredCalls = filteredCalls.filter((call: CallType) => call.branchId === branchId);
    }
    
    if (status) {
      filteredCalls = filteredCalls.filter((call: CallType) => call.status === status);
    }
    
    if (startDate) {
      const startTimestamp = parseInt(startDate, 10);
      filteredCalls = filteredCalls.filter((call: CallType) => 
        (call.callStartTime || 0) >= startTimestamp
      );
    }
    
    if (endDate) {
      const endTimestamp = parseInt(endDate, 10);
      filteredCalls = filteredCalls.filter((call: CallType) => 
        (call.callStartTime || 0) <= endTimestamp
      );
    }
    
    // Sort by call start time descending
    filteredCalls.sort((a: CallType, b: CallType) => 
      (b.callStartTime || 0) - (a.callStartTime || 0)
    );
    
    // Apply pagination
    const total = filteredCalls.length;
    const totalPages = Math.ceil(total / perPage);
    const startIndex = (page - 1) * perPage;
    const paginatedCalls = filteredCalls.slice(startIndex, startIndex + perPage);
    
    // Map to response format
    const responseData: CallResponse[] = paginatedCalls.map((call: CallType) => ({
      callId: call.callId,
      orderId: call.orderId,
      restaurantId: call.restaurantId,
      branchId: call.branchId,
      phoneNumber: call.phoneNumber,
      callStartTime: call.callStartTime,
      callEndTime: call.callEndTime,
      duration: call.duration,
      status: call.status,
      asrConfidence: call.asrConfidence,
      languageDetected: call.languageDetected,
      fallbackTriggered: call.fallbackTriggered,
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
    console.error('Partner API: Error fetching calls:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch calls' },
      { status: 500 }
    );
  }
}
