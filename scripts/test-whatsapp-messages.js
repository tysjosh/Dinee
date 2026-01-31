require("ts-node/register");

const { buildWhatsappMessage } = require("../src/lib/whatsappMessages");

const confirmation = buildWhatsappMessage({
  messageType: "confirmation",
  orderId: "12345",
});

if (!confirmation.includes("order #12345")) {
  throw new Error("Confirmation message missing order ID.");
}

const statusUpdate = buildWhatsappMessage({
  messageType: "status_update",
  orderId: "98765",
  deliveryStatus: "dispatched",
});

if (!statusUpdate.includes("dispatched")) {
  throw new Error("Status update missing delivery status.");
}

console.log("WhatsApp message tests passed.");
