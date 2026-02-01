import otpGenerator from "otp-generator";

const NEXT_APP_URL = process.env.NEXT_APP_URL || "http://localhost:3000";

// Type definitions for API calls
interface CallData {
  callId: string | null;
  restaurantId?: string;
  phoneNumber?: string | null;
  status?: "active" | "completed";
  orderId?: string;
}

interface TranscriptData {
  callId: string | null;
  dialogue: string;
  speaker: "ai" | "human";
}

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface OrderData {
  orderId: string;
  restaurantId: string;
  callId?: string | null;
  customerName: string;
  items: OrderItem[];
  specialInstructions?: string;
  status: "active" | "completed" | "cancelled";
}

/**
 * Fetches restaurant details from the API
 */
export async function wrapperGetRestaurantDetails(restaurantId: string): Promise<unknown> {
  if (!restaurantId) {
    return { success: false, error: "Restaurant ID is required" };
  }
  const response = await fetch(`${NEXT_APP_URL}/api/v1/get-restaurant-data/${restaurantId}`);
  const data = await response.json();
  return data;
}

/**
 * Inserts or updates call data in the database
 */
export async function wrapperUpsertCallData(callData: CallData): Promise<unknown> {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/upsert-call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(callData)
  });
  const data = await response.json();
  return data;
}

/**
 * Add dialogues for the final transcript
 */
export async function wrapperAddTranscriptDialogues(dialogueData: TranscriptData): Promise<unknown> {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/add-transcript-dialogue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(dialogueData)
  });
  const data = await response.json();
  return data;
}

/**
 * Inserts or updates order data in the database
 */
export async function wrapperUpsertOrders(orderData: OrderData): Promise<unknown> {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/upsert-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(orderData)
  });
  const data = await response.json();
  return data;
}

/**
 * Generates a 4-digit numeric order ID
 */
export function generateOrderId(): string {
  return otpGenerator.generate(4, { upperCaseAlphabets: false, specialChars: false, lowerCaseAlphabets: false });
}
