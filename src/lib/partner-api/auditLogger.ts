/**
 * Partner API Audit Logger
 *
 * Shared utility for logging partner API calls to integrationAuditLog.
 * REQ-9.1
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import crypto from "crypto";

const METHOD_TO_ACTION: Record<string, "connect" | "create" | "revoke"> = {
  GET: "connect",
  POST: "create",
  PUT: "create",
  DELETE: "revoke",
};

export async function logPartnerApiAudit(
  convexClient: ConvexHttpClient,
  opts: {
    businessId: string;
    partnerId: string;
    endpoint: string;
    method: string;
    statusCode: number;
    requestId: string;
  }
): Promise<void> {
  try {
    const actionType = METHOD_TO_ACTION[opts.method] ?? "connect";
    await convexClient.mutation(api.integrationAuditLog.createAuditEntry, {
      entryId: `audit_${crypto.randomBytes(16).toString("hex")}`,
      businessId: opts.businessId,
      integrationName: "partner_api",
      actionType,
      actorUserId: opts.partnerId,
      actorRole: "partner",
      details: JSON.stringify({
        endpoint: opts.endpoint,
        method: opts.method,
        statusCode: opts.statusCode,
        requestId: opts.requestId,
      }),
    });
  } catch (err) {
    console.error("Failed to log partner API audit:", err);
  }
}
