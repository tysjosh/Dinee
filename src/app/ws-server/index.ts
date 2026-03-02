import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import cors from "@fastify/cors"
import crypto from "crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import {
  CANCELLATION_SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  LOG_EVENT_TYPES,
  SHOW_TIMING_MATH,
  SYSTEM_PROMPT,
  VOICE,
} from "./server-constants.ts";
import {
  wrapperGetRestaurantDetails,
  wrapperUpsertCallData,
  wrapperAddTranscriptDialogues,
  wrapperUpsertOrders,
  generateOrderId,
  generatePublicOrderCode,
  wrapperCheckBlocked,
  generateBlockedCallTwiML,
} from "./tools.ts";
import { CallPhase, isToolAllowed, nextPhase } from "./call-phase.ts";
import twilio from "twilio";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("ws-server");

dotenv.config({ path: ".env.local" });
const PORT = (process.env.NEXT_BACKEND_PORT || 8000) as number | undefined;
const { NEXT_OPENAI_KEY } = process.env;
if (!NEXT_OPENAI_KEY) {
  logger.error("Missing OpenAI API key.");
  process.exit(1);
}

// Convex client for persistent callback session storage
const convexClient = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Type definitions for connection-scoped state
interface CallbackContext {
  reason?: string;
  phoneNumber?: string;
  isCallback?: boolean;
  data?: string;
}

const fastify = Fastify({ logger: true });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);
fastify.register(cors, {
  origin: process.env.NODE_ENV === "production" 
    ? [process.env.FRONTEND_URL || ""].filter(Boolean)
    : ["*"],
  methods: ["GET", "POST"],
});

/* Health check route */
fastify.all("/health", async (_req, reply) => {
  reply.send({ status: "ok" });
});

/* Twilio entry-point */
fastify.all("/incoming-call", async (request: any, reply) => {
  const callSid = request.body.CallSid || request.query?.CallSid;
  const fromNumber = request.body.From || request.query?.From;
  
  // Check if the phone number is blocked or requires verification
  // Requirements: 25.4 - Reject or require verification for blocklisted numbers
  if (fromNumber) {
    try {
      const blockingResult = await wrapperCheckBlocked(fromNumber);
      
      if (blockingResult.success && blockingResult.data) {
        const { action, reason } = blockingResult.data;
        
        if (action === 'block') {
          // Immediately reject calls from blocked numbers
          logger.info(`Blocking call from ${fromNumber}: ${reason}`, { callId: callSid });
          const twiml = generateBlockedCallTwiML();
          return reply.type("text/xml").send(twiml);
        }
        
        if (action === 'require_verification') {
          // Log the verification requirement - the call will proceed but with a flag
          // In a production system, this could transfer to a human agent
          logger.warn(`Call from ${fromNumber} requires verification: ${reason}`, { callId: callSid });
          // For now, we allow the call to proceed but log the warning
          // A more sophisticated implementation could:
          // 1. Transfer to a human agent
          // 2. Add extra verification steps in the AI conversation
          // 3. Flag the order for manual review
        }
      }
    } catch (error) {
      // If blocking check fails, allow the call to proceed (fail-open)
      logger.error("Error checking blocked status", { callId: callSid });
    }
  }
  
  // Pass call context via query params to the WebSocket connection
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
    <Pause length="1"/>
    <Connect>
    <Stream url="wss://${request.headers.host}/media-stream?callSid=${encodeURIComponent(callSid || '')}&amp;from=${encodeURIComponent(fromNumber || '')}" />
    </Connect>
    </Response>
  `;
  reply.type("text/xml").send(twiml);
});



/* Twilio entry-point for callback calls */
fastify.all("/callback", async (request: any, reply) => {
  try {
    const reason = request.body?.reason || request.query?.reason || "General inquiry";
    const phoneNumber = request.body?.phoneNumber || request.query?.phoneNumber;
    const data = request.body?.data || request.query?.data;

    if (!phoneNumber) {
      return reply.status(400).send({ error: "Phone number is required" });
    }

    // Generate a unique session ID for this callback
    const callbackSessionId = crypto.randomUUID();

    // Store callback context in Convex (persistent, survives restarts)
    await convexClient.mutation(api.callbackSessions.createSession, {
      sessionId: callbackSessionId,
      phoneNumber,
      reason: Array.isArray(reason) ? reason[0] : reason,
      data: typeof data === "string" ? data : JSON.stringify(data),
    });

    const client = twilio(process.env.NEXT_TWILIO_SID, process.env.NEXT_TWILIO_AUTH_TOKEN);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Pause length="1"/>
      <Connect>
      <Stream url="wss://${request.headers.host}/media-stream-callback?sessionId=${encodeURIComponent(callbackSessionId)}" />
      </Connect>
    </Response>`;
    
    await client.calls.create({
      from: process.env.NEXT_VIRTUAL_NUMBER,
      to: phoneNumber,
      twiml,
    });
    
    return reply.send({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return reply.status(500).send({ error: errorMessage });
  }
});

/* websocket */
fastify.register(async (fastify) => {
  // route for connecting OpenAI live api with the incoming call
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    // Extract connection-scoped state from query params
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const callSid = url.searchParams.get("callSid") || "";
    const fromNumber = url.searchParams.get("from") || "";
    
    // Connection-specific state
    let streamSid: string | null = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem: string | null = null;
    let markQueue: string[] = [];
    let responseStartTimestampTwilio: number | null = null;

    // Transcription state
    let restaurantIdConfirmed = false;
    let currentRestaurantId: string | null = null;

    // Call phase state machine
    let callPhase: CallPhase = "await_restaurant_id";

    // OpenAI socket
    const oaWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17",
      {
        headers: {
          Authorization: `Bearer ${NEXT_OPENAI_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      },
    );
    const initializeSession = () => {
      oaWs.send(
        JSON.stringify({
          type: "session.update",
          session: {
            turn_detection: { type: "server_vad" },
            input_audio_format: "g711_ulaw",
            output_audio_format: "g711_ulaw",
            voice: VOICE,
            instructions: SYSTEM_PROMPT,
            modalities: ["text", "audio"],
            temperature: 0.8,
            // Enable input transcription only
            input_audio_transcription: {
              model: "gpt-4o-mini-transcribe",
              prompt: "Expect words related to restaurant orders, food items, phone numbers, and customer service.",
              language: "en"
            },
            // Remove output_audio_transcription to fix audio quality issues
            tools: [
              // Get restaurant details tool
              {
                type: "function",
                name: "get_restaurant_details",
                description:
                  "Fetch restaurant profile and menu for a given restaurant ID",
                parameters: {
                  type: "object",
                  properties: {
                    restaurant_id: { type: "string" },
                  },
                  required: ["restaurant_id"],
                },
              },
              // Upsert call data tool
              {
                type: "function",
                name: "upsert_call_data",
                description: "Insert or update a call row in the Convex `calls` table",
                parameters: {
                  type: "object",
                  properties: {
                    restaurantId: { type: "string", description: "5-digit restaurant ID. This will be the same restaurant id provided by the user." },
                    orderId: { type: "string", description: "The generated order id." },
                  },
                  required: ["restaurantId"]
                }
              },
              // Add transcription dialogue tool
              {
                type: "function",
                name: "add_transcript_dialogue",
                description: `Use this tool always for appending the ai message. This ai message is the one that you speak to the user. Take a moment, think what to speak and then use this tool to add the response that you provided to the user. Make sure to use this tool. Once the restaurant id is confirmed and validated use this tool to update the messages you convey to the user.`,
                parameters: {
                  type: "object",
                  properties: {
                    dialogue: { type: "string", description: "Make sure not to change anything in the dialogues, direct as it is said to the user." },
                    speaker: { type: "string", enum: ["ai", "human"] }
                  },
                  required: ["dialogue", "speaker"]
                }
              },
              // Upsert the order tool
              {
                type: "function",
                name: "upsert_order",
                description: "Insert or update a food order in the Convex `orders` table",
                parameters: {
                  type: "object",
                  properties: {
                    orderId: { type: "string", description: "4-digit ID you gave to the caller" },
                    restaurantId: { type: "string", description: "Restaurant ID" },
                    customerName: { type: "string", description: "Customer's name" },
                    items: {
                      type: "array",
                      description: "One row per menu item",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          quantity: { type: "integer" },
                          price: { type: "number" }
                        },
                        required: ["name", "quantity", "price"]
                      }
                    },
                    specialInstructions: { type: "string", description: "Overall instructions about a dish/order/anything that is extra and needs restaurant's attention to complete the order with ease." },
                    status: { type: "string", enum: ["active", "completed", "cancelled"] }
                  },
                  required: ["orderId", "restaurantId", "customerName", "items", "status"]
                }
              },
              // Generate unique order id
              {
                type: "function",
                name: "generate_order_id",
                description: "Generate a unique order ID. Returns an internal orderId for API lookups and a publicOrderCode (6-char alphanumeric) to read back to the customer as their order reference.",
                parameters: { type: "object", properties: {}, required: [] }
              },
            ],
          },
        }),
      );
    };

    const greet = () => {
      oaWs.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Greet the caller and follow the system prompt.",
              },
            ],
          },
        }),
      );
      oaWs.send(JSON.stringify({ type: "response.create" }));
    };

    // Helper function to handle interruptions
    const handleSpeechStartedEvent = () => {
      logger.info("Speech started - handling interruption", { callId: callSid });
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH)
          logger.debug(
            `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`,
            { callId: callSid }
          );

        if (lastAssistantItem) {
          const truncateEvent = {
            type: "conversation.item.truncate",
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime,
          };
          if (SHOW_TIMING_MATH)
            logger.debug(
              `Sending truncation event: ${JSON.stringify(truncateEvent)}`,
              { callId: callSid }
            );
          oaWs.send(JSON.stringify(truncateEvent));
        }

        connection.send(
          JSON.stringify({
            event: "clear",
            streamSid: streamSid,
          })
        );

        // Reset the local states
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    // Helper function
    const sendMark = () =>
      streamSid &&
      connection.send(
        JSON.stringify({
          event: "mark",
          streamSid,
          mark: { name: "responsePart" },
        }),
      );

    // Helper function to save transcript if restaurant ID is confirmed
    const saveTranscriptIfConfirmed = async (dialogue: string, speaker: 'human' | 'ai') => {
      if (restaurantIdConfirmed && currentRestaurantId) {
        try {
          await wrapperAddTranscriptDialogues({
            dialogue,
            speaker,
            callId: callSid
          });
        } catch (error) {
          logger.error("Error saving transcript", { callId: callSid });
        }
      }
    };

    // Listen for messages from Twilio WebSocket
    connection.on("message", (data: string | Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.event) {
          case 'media':
            latestMediaTimestamp = message.media.timestamp;
            if (SHOW_TIMING_MATH) logger.debug(`Received media message with timestamp: ${latestMediaTimestamp}ms`, { callId: callSid });

            if (oaWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: message.media.payload
              };
              oaWs.send(JSON.stringify(audioAppend));
            }
            break;

          case 'start':
            streamSid = message.start.streamSid;
            logger.info("Incoming stream has started", { callId: callSid });
            // Reset start and media timestamp on a new stream
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
            break;

          case 'mark':
            if (markQueue.length > 0) {
              markQueue.shift();
            }
            break;

          case 'stop':
            logger.info("Stream stopped", { callId: callSid });
            if (oaWs.readyState === WebSocket.OPEN) {
              oaWs.close();
            }
            break;

          default:
            logger.info(`Received non-media event: ${message.event}`, { callId: callSid });
            break;
        }
      } catch (error) {
        logger.error("Error processing Twilio message", { callId: callSid });
      }
    });

    // OpenAI events
    oaWs.on("message", async (raw) => {
      const res = JSON.parse(raw.toString());

      if (LOG_EVENT_TYPES.includes(res.type)) logger.debug("OpenAI event", { callId: callSid });

      // Handle real-time transcription events for human input
      if (res.type === "conversation.item.input_audio_transcription.delta") {
        logger.debug("Human speaking (delta)", { callId: callSid });
        logger.debug(`Human speaking (delta): ${res.delta}`, { callId: callSid });
        // You can use delta for real-time display if needed
      }

      if (res.type === "conversation.item.input_audio_transcription.completed") {
        // Save the completed human transcript
        await saveTranscriptIfConfirmed(res.transcript, 'human');
      }

      // Function call from the model
      if (res.type === "response.function_call_arguments.done") {
        const args = JSON.parse(res.arguments);
        const toolName: string = res.name;
        let output: Record<string, unknown> = { success: false };

        if (!isToolAllowed(callPhase, toolName)) {
          logger.error("Tool rejected", {
            callId: callSid,
          });
          output = { success: false, error: `Tool ${toolName} not allowed in phase ${callPhase}` };
        } else {
          try {
            switch (toolName) {
              case "get_restaurant_details":
                output = await wrapperGetRestaurantDetails(args.restaurant_id) as Record<string, unknown>;
                if (output.success) {
                  restaurantIdConfirmed = true;
                  currentRestaurantId = args.restaurant_id;
                  callPhase = nextPhase(callPhase, "restaurant_verified");
                }
                break;
              case "add_transcript_dialogue":
                output = await wrapperAddTranscriptDialogues({
                  ...args,
                  callId: callSid
                }) as Record<string, unknown>;
                break;
              case "upsert_order":
                output = await wrapperUpsertOrders({
                  ...args,
                  callId: callSid,
                }) as Record<string, unknown>;
                if (output.success && args.status === "completed") {
                  callPhase = nextPhase(callPhase, "order_finalized");
                }
                break;
              case "upsert_call_data":
                output = await wrapperUpsertCallData({
                  ...args,
                  callId: callSid,
                }) as Record<string, unknown>;
                break;
              case "generate_order_id":
                output = { orderId: generateOrderId(), publicOrderCode: generatePublicOrderCode() };
                callPhase = nextPhase(callPhase, "order_id_generated");
                break;
            }
          } catch (e) {
            output = { success: false, error: String(e) };
          }
        }

        oaWs.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: res.call_id,
              output: JSON.stringify(output),
            },
          }),
        );
        oaWs.send(JSON.stringify({ type: "response.create" }));
        return;
      }

      // Audio back to Twilio
      if (res.type === "response.audio.delta" && res.delta) {
        connection.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: res.delta },
          }),
        );

        // First delta from a new response starts the elapsed time counter
        if (!responseStartTimestampTwilio) {
          responseStartTimestampTwilio = latestMediaTimestamp;
          if (SHOW_TIMING_MATH) logger.debug(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`, { callId: callSid });
        }

        if (res.item_id) {
          lastAssistantItem = res.item_id;
        }

        sendMark();
        markQueue.push("responsePart");
      }

      // Handle speech interruption
      if (res.type === "input_audio_buffer.speech_started") {
        handleSpeechStartedEvent();
      }

      // Capture AI responses from text content for transcription
      if (res.type === "response.content.done") {
        if (res.content && Array.isArray(res.content)) {
          const textContent = res.content.find((item: { type: string; text?: string }) => item.type === 'text');
          if (textContent && textContent.text) {
            // Save the AI response transcript
            await saveTranscriptIfConfirmed(textContent.text, 'ai');
          }
        }
      }

      // Fallback: capture any response that completes without text content
      if (res.type === "response.done" && res.response) {
        // Try to extract text from the response output
        if (res.response.output && res.response.output.length > 0) {
          const output = res.response.output[0];
          if (output.content && output.content.length > 0) {
            const textContent = output.content.find((item: { type: string; text?: string }) => item.type === 'text');
            if (textContent && textContent.text) {
              await saveTranscriptIfConfirmed(textContent.text, 'ai');
            }
          }
        }
      }
    });

    // OpenAI socket lifecycle
    oaWs.on("open", async () => {
      await wrapperUpsertCallData({
        callId: callSid,
        phoneNumber: fromNumber,
        status: "active",
        restaurantId: "unknown"
      });
      initializeSession();
      setTimeout(greet, 200);
    });
    oaWs.on("close", async () => {
      // Update the call status to completed
      await wrapperUpsertCallData({
        callId: callSid,
        status: "completed",
      });
    });
    oaWs.on("error", (err) => {
      logger.error("OpenAI socket error", { callId: callSid });
    });

    // Twilio socket lifecycle
    connection.on("close", () => {
      logger.info("Twilio socket closed", { callId: callSid });
      // Shuts down the openAI socket
      if (oaWs.readyState === WebSocket.OPEN) oaWs.close();
    });

    connection.on("error", err => {
      logger.error("Twilio socket error", { callId: callSid });
    });
  });


  // Callback route
  fastify.get("/media-stream-callback", { websocket: true }, async (connection, req) => {
    // Extract sessionId from query params to get callback context from Convex
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("sessionId") || "";
    
    // Get and consume callback session from Convex (atomic, persistent)
    const callbackContext = sessionId 
      ? await convexClient.mutation(api.callbackSessions.getAndConsumeSession, { sessionId })
      : null;
    
    // Connection-specific state
    let streamSid: string | null = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem: string | null = null;
    let markQueue: string[] = [];
    let responseStartTimestampTwilio: number | null = null;

    // Call phase state machine — initial phase depends on callback reason
    let callPhase: CallPhase = callbackContext?.reason === "followup"
      ? "restaurant_verified"
      : callbackContext?.reason === "cancellation"
        ? "order_open"
        : "await_restaurant_id";

    // OpenAI socket
    const oaWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview-2024-12-17",
      {
        headers: {
          Authorization: `Bearer ${NEXT_OPENAI_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      },
    );
    
    let agentTools: Array<Record<string, unknown>> = [];
    let systemPrompt = "";
    
    if (callbackContext?.reason === "followup") {
      // Assign the tools here
      agentTools = [
        // Get restaurant details tool
        {
          type: "function",
          name: "get_restaurant_details",
          description:
            "Fetch restaurant profile and menu for a given restaurant ID",
          parameters: {
            type: "object",
            properties: {
              restaurant_id: { type: "string" },
            },
            required: ["restaurant_id"],
          },
        },
        // Upsert call data tool
        // {
        // type: "function",
        // name: "upsert_call_data",
        // description: "Insert or update a call row in the Convex `calls` table",
        // parameters: {
        // type: "object",
        // properties: {
        // restaurantId: { type: "string", description: "5-digit restaurant ID. This will be the same restaurant id provided by the user." },
        // orderId: { type: "string", description: "The generated order id." },
        // },
        // required: ["restaurantId"]
        // }
        // },
        // Add transcription dialogue tool
        // {
        // type: "function",
        // name: "add_transcript_dialogue",
        // description: `Use this tool always for appending the ai message. This ai message is the one that you speak to the user. Take a moment, think what to speak and then use this tool to add the response that you provided to the user. Make sure to use this tool. Once the restaurant id is confirmed and validated use this tool to update the messages you convey to the user.`,
        // parameters: {
        // type: "object",
        // properties: {
        // dialogue: { type: "string", description: "Make sure not to change anything in the dialogues, direct as it is said to the user." },
        // speaker: { type: "string", enum: ["ai"] }
        // },
        // required: ["dialogue", "speaker"]
        // }
        // },
        // Upsert the order tool
        {
          type: "function",
          name: "upsert_order",
          description: "Insert or update a food order in the Convex `orders` table",
          parameters: {
            type: "object",
            properties: {
              orderId: { type: "string", description: "4-digit order ID" },
              restaurantId: { type: "string", description: "4 digit restaurant ID" },
              customerName: { type: "string", description: "Customer's name" },
              items: {
                type: "array",
                description: "One row per menu item",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    quantity: { type: "integer" },
                    price: { type: "number" }
                  },
                  required: ["name", "quantity", "price"]
                }
              },
              specialInstructions: { type: "string", description: "Overall instructions about a dish/order/anything that is extra and needs restaurant's attention to complete the order with ease." },
              status: { type: "string", enum: ["active", "completed", "cancelled"] }
            },
            required: ["orderId", "restaurantId", "customerName", "items", "status"]
          }
        },
        // Generate unique order id
        // {
        // type: "function",
        // name: "generate_order_id",
        // description: "Generate a 4-digit numeric order ID",
        // parameters: { type: "object", properties: {}, required: [] }
        // },
      ]
      systemPrompt = FOLLOWUP_SYSTEM_PROMPT;
    } else if (callbackContext?.reason === "cancellation") {
      systemPrompt = CANCELLATION_SYSTEM_PROMPT;
    }
    const initializeSession = () => {
      oaWs.send(
        JSON.stringify({
          type: "session.update",
          session: {
            turn_detection: { type: "server_vad" },
            input_audio_format: "g711_ulaw",
            output_audio_format: "g711_ulaw",
            voice: VOICE,
            instructions: systemPrompt,
            modalities: ["text", "audio"],
            temperature: 0.8,
            tools: agentTools,
          },
        }),
      );
    };

    const greet = () => {
      oaWs.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Greet the caller. The details of the order and the reason for the call is: <data>${callbackContext?.data || ""}</data><reason>${callbackContext?.reason || ""}</reason>`,
              },
            ],
          },
        }),
      );
      oaWs.send(JSON.stringify({ type: "response.create" }));
    };

    // Helper function to handle interruptions
    const handleSpeechStartedEvent = () => {
      logger.info("Speech started - handling interruption", { callId: sessionId });
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH)
          logger.debug(
            `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`,
            { callId: sessionId }
          );

        if (lastAssistantItem) {
          const truncateEvent = {
            type: "conversation.item.truncate",
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime,
          };
          if (SHOW_TIMING_MATH)
            logger.debug(
              `Sending truncation event: ${JSON.stringify(truncateEvent)}`,
              { callId: sessionId }
            );
          oaWs.send(JSON.stringify(truncateEvent));
        }

        connection.send(
          JSON.stringify({
            event: "clear",
            streamSid: streamSid,
          })
        );

        // Reset the local states
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    // Helper function
    const sendMark = () =>
      streamSid &&
      connection.send(
        JSON.stringify({
          event: "mark",
          streamSid,
          mark: { name: "responsePart" },
        }),
      );


    // Listen for messages from Twilio WebSocket
    connection.on("message", (data: string | Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.event) {
          case 'media':
            latestMediaTimestamp = message.media.timestamp;
            if (SHOW_TIMING_MATH) logger.debug(`Received media message with timestamp: ${latestMediaTimestamp}ms`, { callId: sessionId });

            if (oaWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: message.media.payload
              };
              oaWs.send(JSON.stringify(audioAppend));
            }
            break;

          case 'start':
            streamSid = message.start.streamSid;
            logger.info("Incoming stream has started", { callId: sessionId });
            // Reset start and media timestamp on a new stream
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
            break;

          case 'mark':
            if (markQueue.length > 0) {
              markQueue.shift();
            }
            break;

          case 'stop':
            logger.info("Stream stopped", { callId: sessionId });
            if (oaWs.readyState === WebSocket.OPEN) {
              oaWs.close();
            }
            break;

          default:
            logger.info(`Received non-media event: ${message.event}`, { callId: sessionId });
            break;
        }
      } catch (error) {
        logger.error("Error processing Twilio message", { callId: sessionId });
      }
    });

    // OpenAI events
    oaWs.on("message", async (raw) => {
      const res = JSON.parse(raw.toString());

      if (LOG_EVENT_TYPES.includes(res.type)) logger.debug("OpenAI event", { callId: sessionId });

      // Handle real-time transcription events for human input
      if (res.type === "conversation.item.input_audio_transcription.delta") {
        // Delta events can be used for real-time display if needed
      }

      // Function call from the model
      if (res.type === "response.function_call_arguments.done") {
        const args = JSON.parse(res.arguments);
        const toolName: string = res.name;
        let output: Record<string, unknown> = { success: false };

        if (!isToolAllowed(callPhase, toolName)) {
          logger.error("Tool rejected", {
            callId: sessionId,
          });
          output = { success: false, error: `Tool ${toolName} not allowed in phase ${callPhase}` };
        } else {
          try {
            switch (toolName) {
              case "get_restaurant_details":
                output = await wrapperGetRestaurantDetails(args.restaurant_id) as Record<string, unknown>;
                if (output.success) {
                  callPhase = nextPhase(callPhase, "restaurant_verified");
                }
                break;
              case "upsert_order":
                output = await wrapperUpsertOrders({
                  ...args,
                }) as Record<string, unknown>;
                if (output.success && args.status === "completed") {
                  callPhase = nextPhase(callPhase, "order_finalized");
                }
                break;
              case "generate_order_id":
                output = { orderId: generateOrderId(), publicOrderCode: generatePublicOrderCode() };
                callPhase = nextPhase(callPhase, "order_id_generated");
                break;
            }
          } catch (e) {
            output = { success: false, error: String(e) };
          }
        }

        oaWs.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: res.call_id,
              output: JSON.stringify(output),
            },
          }),
        );
        oaWs.send(JSON.stringify({ type: "response.create" }));
        return;
      }

      // Audio back to Twilio
      if (res.type === "response.audio.delta" && res.delta) {
        connection.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: res.delta },
          }),
        );

        // First delta from a new response starts the elapsed time counter
        if (!responseStartTimestampTwilio) {
          responseStartTimestampTwilio = latestMediaTimestamp;
          if (SHOW_TIMING_MATH) logger.debug(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`, { callId: sessionId });
        }

        if (res.item_id) {
          lastAssistantItem = res.item_id;
        }

        sendMark();
        markQueue.push("responsePart");
      }

      // Handle speech interruption
      if (res.type === "input_audio_buffer.speech_started") {
        handleSpeechStartedEvent();
      }

    });

    // OpenAI socket lifecycle
    oaWs.on("open", async () => {
      initializeSession();
      setTimeout(greet, 200);
    });
    oaWs.on("close", async () => {
      // Callback completed
    });
    oaWs.on("error", (err) => {
      logger.error("OpenAI socket error", { callId: sessionId });
    });

    // Twilio socket lifecycle
    connection.on("close", () => {
      // Shuts down the openAI socket
      if (oaWs.readyState === WebSocket.OPEN) oaWs.close();
    });

    connection.on("error", (err) => {
      logger.error("Twilio socket error", { callId: sessionId });
    });
  });
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, url) => {
  if (err) {
    logger.error("Server startup failed");
    process.exit(1);
  }
  logger.info(`Server running at ${url}`);
});