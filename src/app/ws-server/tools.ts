import otpGenerator from "otp-generator";

const NEXT_APP_URL = process.env.NEXT_APP_URL || "http://localhost:3000";

/**
 * Fetches restaurant details from the API
 */
export async function wrapperGetRestaurantDetails(restaurantId: string = "67126") {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/get-restaurant-data/${restaurantId}`);
  const data = await response.json();
  return data;
}

export async function wrapperGetTelephonyProviders(platformId?: string | null) {
  const params = platformId ? `?platformId=${platformId}` : "";
  const response = await fetch(`${NEXT_APP_URL}/api/v1/telephony/providers${params}`);
  const data = await response.json();
  return data;
}

/**
 * Inserts or updates call data in the database
 */
export async function wrapperUpsertCallData(callData) {
  console.log("🍬 wrapper call data")
  console.log(callData)
  const response = await fetch(`${NEXT_APP_URL}/api/v1/upsert-call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(callData)
  })
  const data = await response.json()
  return data
}


// Add dialogues for the final transcript
export async function wrapperAddTranscriptDialogues(dialogueData) {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/add-transcript-dialogue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(dialogueData)
  })
  const data = await response.json()
  return data
}


export async function wrapperUpsertOrders(orderData) {
  const response = await fetch(`${NEXT_APP_URL}/api/v1/upsert-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(orderData)
  })
  const data = await response.json()
  return data
}


export function generateOrderId() {
  console.log("🆔 Generating order id")
  return otpGenerator.generate(4, { upperCaseAlphabets: false, specialChars: false, lowerCaseAlphabets: false });
}
