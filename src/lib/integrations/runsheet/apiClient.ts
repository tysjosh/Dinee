import { RunsheetClient } from "../runsheetClient";

/**
 * Configuration for the intake-side Runsheet read/validate client.
 *
 * This client is used by the Fuel_Intake_Agent to perform in-call lookups and
 * validation against the Runsheet backend. It is scoped to a single Runsheet
 * tenant and authenticates with the tenant's decrypted API key.
 */
export interface RunsheetApiConfig {
  /** Base URL of the Runsheet backend, e.g. "https://tenant.runsheet.com". */
  baseUrl: string;
  /** Decrypted API key for the tenant. */
  apiKey: string;
  /** Runsheet tenant identifier this client is scoped to. */
  tenantId: string;
}

/** A Runsheet customer record returned by a lookup. */
export interface CustomerRecord {
  id: string;
  name: string;
  phone?: string;
  accountId?: string;
}

/** A delivery site belonging to a customer. */
export interface CustomerSite {
  id: string;
  customerId: string;
  name: string;
  address?: string;
}

/** A fuel tank belonging to a customer. */
export interface CustomerTank {
  id: string;
  customerId: string;
  siteId?: string;
  productCode?: string;
  capacityGallons?: number;
}

/** Query for {@link RunsheetApiClient.lookupCustomer}. */
export interface CustomerLookupQuery {
  phone?: string;
  accountId?: string;
}

/**
 * A summary of a fuel order returned by {@link RunsheetApiClient.lookupOrderByPhone}
 * (Req 14.1, 14.2). The Status_Agent reads these back to the caller.
 */
export interface OrderSummary {
  id: string;
  customerId: string;
  /** Backend order lifecycle status, e.g. "scheduled", "en_route", "delivered". */
  status: string;
  productCode?: string;
  quantityGallons?: number;
  deliverySiteId?: string;
  /** Epoch ms the order was placed, used to order the list most-recent-first. */
  placedAt?: number;
}

/** Current status of a specific order (Req 14.1). */
export interface OrderStatusResult {
  orderId: string;
  status: string;
  /** Epoch ms the status was last updated, when the backend provides it. */
  updatedAt?: number;
  /** Optional human-readable note the agent can relay to the caller. */
  note?: string;
}

/** Estimated delivery time for a specific order (Req 14.1). */
export interface OrderEtaResult {
  orderId: string;
  /** A spoken delivery window, e.g. "between 2pm and 4pm today", when known. */
  etaWindow?: string;
  /** Epoch ms of the estimated delivery time, or null when not yet scheduled. */
  etaAt?: number | null;
  /** The order status that produced the ETA, for context. */
  status?: string;
}

/** A completed delivery on a customer's history (Req 14.1). */
export interface DeliveryRecord {
  id: string;
  customerId: string;
  orderId?: string;
  productCode?: string;
  quantityGallons?: number;
  siteId?: string;
  /** Epoch ms the delivery completed, used to order the list most-recent-first. */
  deliveredAt?: number;
}

/**
 * Result of a customer lookup, whose shape reflects the match count (Req 6.3):
 * - `single` when exactly one customer matches,
 * - `list` (ordered) when more than one customer matches,
 * - `empty` when no customer matches.
 */
export type CustomerLookupResult =
  | { kind: "single"; customer: CustomerRecord }
  | { kind: "list"; customers: CustomerRecord[] }
  | { kind: "empty" };

/** A Runsheet driver record returned by verification (Req 15.2). */
export interface DriverRecord {
  id: string;
  name: string;
  phone?: string;
  driverIdentifier?: string;
}

/** Query for {@link RunsheetApiClient.verifyDriver} (Req 15.2, 15.3, 15.4). */
export interface DriverVerifyQuery {
  /** Caller phone number, used for the phone-match verification path (Req 15.2). */
  phone?: string;
  /** Explicit driver identifier, used when the phone does not match (Req 15.3). */
  driverIdentifier?: string;
  /** Driver PIN, supplied when a sensitive action requires it (Req 15.4). */
  pin?: string;
}

/**
 * Outcome of a driver verification (Req 15.2, 15.3):
 * - `verified` when the driver identity is confirmed; `pinVerified` reports
 *   whether a valid PIN accompanied the request (Req 15.4);
 * - `unverified` when no driver matched, so the agent must request a driver
 *   identifier before an active-assignment lookup (Req 15.3).
 */
export type DriverVerifyResult =
  | { kind: "verified"; driver: DriverRecord; pinVerified: boolean }
  | { kind: "unverified" };

/** An active driver assignment (Req 15.5). */
export interface DriverAssignment {
  id: string;
  driverId: string;
  status: string;
  destination?: string;
  scheduledFor?: string;
}

/** Input common to the driver reporting/mutation tools (Req 15.1). */
export interface DriverReportInput {
  /** Confirmed driver identifier (Req 15.5). */
  driverId: string;
  /** Present active-assignment identifier the report is attached to (Req 15.5). */
  assignmentId: string;
  /** Free-form detail: delay reason, terminal name, exception text, or note. */
  detail?: string;
  /** Estimated additional minutes, for delay / terminal-wait reports. */
  etaMinutes?: number;
}

/** Result of a driver reporting/mutation call (Req 15.5). */
export interface DriverReportResult {
  recorded: boolean;
  reportId?: string;
}

/** The reporting/mutation report kinds pushed to the Runsheet backend (Req 15.1). */
type DriverReportKind = "delay" | "terminal_wait" | "exception" | "note";

/** Default deadline for the credential test (Req 8.5). */
const CREDENTIAL_TEST_TIMEOUT_MS = 5000;

/**
 * Intake-side Runsheet API client for in-call reads and validation.
 *
 * Extends the shipment-oriented {@link RunsheetClient} (webhook registration,
 * shipment event push, webhook signature validation) with the read/validate
 * tools the Fuel_Intake_Agent needs: customer lookup, site/tank listing,
 * product validation, and a credential test.
 *
 * Network calls for in-call tools are wrapped by the runtime's 5s tool
 * executor (Req 6.5/6.6); this client therefore performs plain requests and
 * lets the executor enforce the per-tool deadline and fallback. The credential
 * test enforces its own 5s deadline because it runs outside the tool executor
 * (Req 8.5).
 *
 * Requirements: 6.2, 6.3, 6.4, 8.5
 */
export class RunsheetApiClient extends RunsheetClient {
  private readonly baseUrl: string;
  private readonly tenantId: string;
  private readonly apiKey: string;

  constructor(cfg: RunsheetApiConfig) {
    // The read/validate client does not register webhooks; the shipment-side
    // config fields are not used on this path.
    super({ apiKey: cfg.apiKey, tenantMapping: {}, webhookUrl: "" });
    // Surface B (reads / driver ops) is mounted under the "/voice" prefix on the
    // Runsheet backend and authenticated with the API key as a Bearer token
    // (e.g. GET /voice/auth/ping, /voice/customers/lookup). Append the prefix
    // once here so every request/mutate/testCredential path resolves correctly.
    // NOTE: this is distinct from Surface A (signed order submission), which the
    // separate VoiceIntakeClient POSTs to "{baseUrl}/voice-intake" (no /voice).
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "") + "/voice";
    this.tenantId = cfg.tenantId;
    this.apiKey = cfg.apiKey;
  }

  /**
   * Looks up a customer by phone number or account identifier (Req 6.3).
   *
   * Returns a `single` result when exactly one customer matches, an ordered
   * `list` when more than one matches (backend order preserved), and `empty`
   * when none match.
   *
   * @throws Error when neither a phone number nor an account identifier is
   * provided (Req 6.4) — the invocation is rejected before any network call.
   */
  async lookupCustomer(query: CustomerLookupQuery): Promise<CustomerLookupResult> {
    const phone = query.phone?.trim();
    const accountId = query.accountId?.trim();

    if (!phone && !accountId) {
      throw new Error(
        "runsheet_lookup_customer requires a phone number or an account identifier"
      );
    }

    const params = new URLSearchParams();
    if (phone) {
      params.set("phone", phone);
    }
    if (accountId) {
      params.set("accountId", accountId);
    }

    const data = await this.request<{ customers?: CustomerRecord[] }>(
      `/customers/lookup?${params.toString()}`
    );
    const customers = data.customers ?? [];

    if (customers.length === 0) {
      return { kind: "empty" };
    }
    if (customers.length === 1) {
      return { kind: "single", customer: customers[0] };
    }
    return { kind: "list", customers };
  }

  /** Lists the delivery sites for a customer. */
  async listCustomerSites(customerId: string): Promise<CustomerSite[]> {
    const data = await this.request<{ sites?: CustomerSite[] }>(
      `/customers/${encodeURIComponent(customerId)}/sites`
    );
    return data.sites ?? [];
  }

  /** Lists the fuel tanks for a customer. */
  async listCustomerTanks(customerId: string): Promise<CustomerTank[]> {
    const data = await this.request<{ tanks?: CustomerTank[] }>(
      `/customers/${encodeURIComponent(customerId)}/tanks`
    );
    return data.tanks ?? [];
  }

  /**
   * Validates a product code for the tenant, returning a boolean (Req 6.5).
   */
  async validateProduct(productCode: string): Promise<boolean> {
    const data = await this.request<{ valid?: boolean }>(
      `/products/validate?code=${encodeURIComponent(productCode)}`
    );
    return data.valid === true;
  }

  /**
   * Verifies a driver's identity by caller phone number or an explicit driver
   * identifier, optionally validating a PIN for sensitive actions (Req 15.2,
   * 15.3, 15.4).
   *
   * Returns `verified` with the matched driver when identity is confirmed
   * (`pinVerified` reflects whether a valid PIN accompanied the request), or
   * `unverified` when neither a phone nor a driver identifier is supplied or no
   * driver matches — signalling the agent to request a driver identifier before
   * an active-assignment lookup (Req 15.3).
   */
  async verifyDriver(query: DriverVerifyQuery): Promise<DriverVerifyResult> {
    const phone = query.phone?.trim();
    const driverIdentifier = query.driverIdentifier?.trim();
    const pin = query.pin?.trim();

    // With neither anchor we cannot verify: treat as unverified so the agent
    // requests a driver identifier before proceeding (Req 15.3).
    if (!phone && !driverIdentifier) {
      return { kind: "unverified" };
    }

    const params = new URLSearchParams();
    if (phone) {
      params.set("phone", phone);
    }
    if (driverIdentifier) {
      params.set("driverIdentifier", driverIdentifier);
    }
    if (pin) {
      params.set("pin", pin);
    }

    const data = await this.request<{ driver?: DriverRecord; pinVerified?: boolean }>(
      `/drivers/verify?${params.toString()}`
    );
    if (!data.driver) {
      return { kind: "unverified" };
    }
    return {
      kind: "verified",
      driver: data.driver,
      pinVerified: data.pinVerified === true,
    };
  }

  /**
   * Returns the driver's current active assignment, or `null` when the driver
   * has no active assignment (Req 15.5).
   */
  async getActiveAssignment(driverId: string): Promise<DriverAssignment | null> {
    const data = await this.request<{ assignment?: DriverAssignment | null }>(
      `/drivers/${encodeURIComponent(driverId)}/active-assignment`
    );
    return data.assignment ?? null;
  }

  /** Reports a delay on an active assignment (Req 15.1). */
  async reportDelay(input: DriverReportInput): Promise<DriverReportResult> {
    return this.postDriverReport("delay", input);
  }

  /** Reports a terminal wait on an active assignment (Req 15.1). */
  async reportTerminalWait(input: DriverReportInput): Promise<DriverReportResult> {
    return this.postDriverReport("terminal_wait", input);
  }

  /** Reports an exception on an active assignment (Req 15.1). */
  async reportException(input: DriverReportInput): Promise<DriverReportResult> {
    return this.postDriverReport("exception", input);
  }

  /** Appends a free-form driver note to an active assignment (Req 15.1). */
  async appendDriverNote(input: DriverReportInput): Promise<DriverReportResult> {
    return this.postDriverReport("note", input);
  }

  /**
   * Pushes a driver report of the given kind to the Runsheet backend for the
   * driver's active assignment (Req 15.1, 15.5). Shared by the four driver
   * reporting/mutation tools.
   */
  private async postDriverReport(
    kind: DriverReportKind,
    input: DriverReportInput
  ): Promise<DriverReportResult> {
    const data = await this.mutate<{ recorded?: boolean; reportId?: string }>(
      `/drivers/${encodeURIComponent(input.driverId)}/assignments/${encodeURIComponent(
        input.assignmentId
      )}/reports`,
      { kind, detail: input.detail, etaMinutes: input.etaMinutes }
    );
    return { recorded: data.recorded === true, reportId: data.reportId };
  }

  /**
   * Looks up the caller's fuel orders by phone number for the Status_Agent
   * (Req 14.1, 14.2). Returns an ordered list of matching orders (backend order
   * preserved, expected most-recent-first) when one or more match, and an empty
   * array when none match.
   *
   * @throws Error when no phone number is provided — the invocation is rejected
   * before any network call.
   */
  async lookupOrderByPhone(phone: string): Promise<OrderSummary[]> {
    const trimmed = phone?.trim();
    if (!trimmed) {
      throw new Error("runsheet_lookup_order_by_phone requires a phone number");
    }
    const params = new URLSearchParams({ phone: trimmed });
    const data = await this.request<{ orders?: OrderSummary[] }>(
      `/orders/lookup?${params.toString()}`
    );
    return data.orders ?? [];
  }

  /** Gets the current status of a specific order (Req 14.1). */
  async getOrderStatus(orderId: string): Promise<OrderStatusResult> {
    const data = await this.request<OrderStatusResult>(
      `/orders/${encodeURIComponent(orderId)}/status`
    );
    return { ...data, orderId };
  }

  /** Gets the estimated delivery time for a specific order (Req 14.1). */
  async getEta(orderId: string): Promise<OrderEtaResult> {
    const data = await this.request<OrderEtaResult>(
      `/orders/${encodeURIComponent(orderId)}/eta`
    );
    return { ...data, orderId };
  }

  /**
   * Lists a customer's recent deliveries, most recent first (Req 14.1),
   * optionally limited to `limit` entries.
   */
  async getRecentDeliveries(
    customerId: string,
    limit?: number
  ): Promise<DeliveryRecord[]> {
    const params = new URLSearchParams();
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      params.set("limit", String(Math.floor(limit)));
    }
    const query = params.toString();
    const data = await this.request<{ deliveries?: DeliveryRecord[] }>(
      `/customers/${encodeURIComponent(customerId)}/deliveries${query ? `?${query}` : ""}`
    );
    return data.deliveries ?? [];
  }

  /**
   * Attempts an authenticated request against the configured base URL and
   * reports within 5 seconds whether the credential is valid (Req 8.5).
   *
   * Never throws: a network error, non-2xx response, or timeout is reported as
   * an invalid credential.
   */
  async testCredential(): Promise<{ valid: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CREDENTIAL_TEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/auth/ping`, {
        method: "GET",
        headers: this.authHeaders(),
        signal: controller.signal,
      });
      return { valid: response.ok };
    } catch {
      return { valid: false };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Authorization + tenant headers common to every request. */
  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "X-Runsheet-Tenant": this.tenantId,
    };
  }

  /**
   * Issues an authenticated JSON GET against the tenant's Runsheet backend and
   * parses the response body. Throws on a non-2xx response so the runtime tool
   * executor can record the error and continue with the configured fallback
   * behavior (Req 6.7).
   */
  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Runsheet API ${path} failed (${response.status}): ${errorBody}`
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Issues an authenticated JSON POST against the tenant's Runsheet backend and
   * parses the response body. Like {@link request}, throws on a non-2xx response
   * so the runtime tool executor records the error and continues with the
   * configured fallback behavior (Req 6.7). Used by the driver reporting tools.
   */
  private async mutate<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Runsheet API ${path} failed (${response.status}): ${errorBody}`
      );
    }

    return (await response.json()) as T;
  }
}
