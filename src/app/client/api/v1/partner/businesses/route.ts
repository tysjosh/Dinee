/**
 * Partner API - Businesses Provisioning Endpoint
 *
 * Allows external systems (e.g. Runsheet) to create a tenant
 * (business + locations) in a single call.
 *
 * @module api/partner/businesses
 * @requirements REQ-4.1 - Provisioning API
 * @requirements REQ-4.3 - Partner auth middleware
 * @requirements REQ-4.5 - Audit logging
 */

import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../convex/_generated/api";
import { validateApiRequest } from "@/lib/partner-api/middleware";
import { logPartnerApiAudit } from "@/lib/partner-api/auditLogger";
import { internalSecretArg } from "@/lib/internal-auth";
import type { ApiErrorResponse } from "@/lib/partner-api/types";

// ============================================================================
// Types
// ============================================================================

interface LocationInput {
  name: string;
  address: string;
  phoneNumber: string;
  operatingHours?: {
    monday?: { open: string; close: string };
    tuesday?: { open: string; close: string };
    wednesday?: { open: string; close: string };
    thursday?: { open: string; close: string };
    friday?: { open: string; close: string };
    saturday?: { open: string; close: string };
    sunday?: { open: string; close: string };
  };
}

interface ProvisioningRequest {
  name: string;
  vertical?: string;
  agentName: string;
  languagePreference: string;
  specialInstructions: string;
  locations?: LocationInput[];
  enabledModules?: string[];
  source_platform?: string;
  source_tenant?: string;
}

interface ProvisioningResponse {
  businessId: string;
  locations: Array<{ locationId: string; name: string }>;
}

// ============================================================================
// Helpers
// ============================================================================

function getConvexClient(): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return null;
  return new ConvexHttpClient(convexUrl);
}

const VALID_VERTICALS = [
  "restaurant",
  "logistics",
  "healthcare",
  "legal",
  "hospitality",
  "general_services",
] as const;

type Vertical = (typeof VALID_VERTICALS)[number];

const VALID_LANGUAGES = [
  "english",
  "nigerian_english",
  "pidgin",
  "spanish",
  "french",
] as const;

type Language = (typeof VALID_LANGUAGES)[number];

// ============================================================================
// POST - Provision a new business
// ============================================================================

/**
 * POST /api/v1/partner/businesses
 *
 * Creates a new business (tenant) with locations in a single call.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ProvisioningResponse | ApiErrorResponse>> {
  const validation = await validateApiRequest(request, {
    requiredScopes: ["businesses:write"],
  });

  if (!validation.success || !validation.context) {
    return validation.errorResponse as NextResponse<ApiErrorResponse>;
  }

  const { context } = validation;

  const convexClient = getConvexClient();
  if (!convexClient) {
    return NextResponse.json(
      { error: "Internal Server Error", message: "Server configuration error" },
      { status: 500 }
    );
  }

  try {
    const body: ProvisioningRequest = await request.json();

    // Validate required fields
    if (!body.name || !body.agentName || !body.specialInstructions || !body.languagePreference) {
      return NextResponse.json(
        {
          error: "Bad Request",
          message: "Missing required fields: name, agentName, specialInstructions, languagePreference",
        },
        { status: 400 }
      );
    }

    // Validate vertical if provided
    if (body.vertical && !VALID_VERTICALS.includes(body.vertical as Vertical)) {
      return NextResponse.json(
        {
          error: "Bad Request",
          message: `Invalid vertical. Must be one of: ${VALID_VERTICALS.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate language
    if (!VALID_LANGUAGES.includes(body.languagePreference as Language)) {
      return NextResponse.json(
        {
          error: "Bad Request",
          message: `Invalid languagePreference. Must be one of: ${VALID_LANGUAGES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Resolve partner's platformId
    const partner = await convexClient.query(
      api.partners.getPartnerByPartnerId,
      { partnerId: context.partnerId }
    );

    if (!partner) {
      return NextResponse.json(
        { error: "Not Found", message: "Partner not found" },
        { status: 404 }
      );
    }

    // Map locations to branches format
    const branches = body.locations?.map((loc) => ({
      name: loc.name,
      address: loc.address,
      phoneNumber: loc.phoneNumber,
      operatingHours: loc.operatingHours,
      isActive: true,
    }));

    // Create business + branches atomically
    const result = await convexClient.mutation(
      api.restaurants.createRestaurantWithBranches,
      {
        name: body.name,
        agentName: body.agentName,
        specialInstructions: body.specialInstructions,
        languagePreference: body.languagePreference as Language,
        platformId: partner.platformId,
        branches,
        vertical: (body.vertical as Vertical) ?? undefined,
        enabledModules: body.enabledModules,
        source_platform: body.source_platform,
        source_tenant: body.source_tenant,
        ...internalSecretArg(),
      }
    );

    // Audit log (REQ-9.1)
    logPartnerApiAudit(convexClient, {
      businessId: result.restaurantId,
      partnerId: context.partnerId,
      endpoint: "/api/v1/partner/businesses",
      method: "POST",
      statusCode: 201,
      requestId: context.requestId,
    });

    // Build response
    const locations = result.branches.map((b: { branchId: string }, i: number) => ({
      locationId: b.branchId,
      name: body.locations?.[i]?.name ?? b.branchId,
    }));

    return NextResponse.json(
      {
        businessId: result.restaurantId,
        locations,
      },
      {
        status: 201,
        headers: { "X-Request-Id": context.requestId },
      }
    );
  } catch (error) {
    console.error("Partner API: Error provisioning business:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: "Failed to provision business",
      },
      { status: 500 }
    );
  }
}
