import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import cors from "@fastify/cors"
import {
  CANCELLATION_SYSTEM_PROMPT,
  FOLLOWUP_SYSTEM_PROMPT,
  LOG_EVENT_TYPES,
  SHOW_TIMING_MATH,
  SYSTEM_PROMPT,
  LOCALIZATION_PROMPT,
  VOICE,
// } from "./server-constants";
} from "./server-constants.ts";
import {
  wrapperGetRestaurantDetails,
  wrapperUpsertCallData,
  wrapperAddTranscriptDialogues,
  wrapperUpsertOrders,
  generateOrderId,
  wrapperGetTelephonyProviders,
  } from "./tools.ts";
// } from "./tools";
import twilio from "twilio";

dotenv.config({ path: ".env.local" });
const PORT = (process.env.NEXT_BACKEND_PORT || 8000) as number | undefined;
const { NEXT_OPENAI_KEY } = process.env;
if (!NEXT_OPENAI_KEY) {
  console.error("Missing OpenAI API key.");
  process.exit(1);
}


// Keeps the track of the call sid and the phone number
let FROM_NUMBER: string | null = "";
let CALL_SID: string | null = "";

// ONLY for the callback
let CALLBACK_CONTEXT: { reason?: string; phoneNumber?: string; isCallback?: boolean; data?: string } = {};

const FALLBACK_WORD_THRESHOLD = 2;
const FALLBACK_MAX_ATTEMPTS = 2;

const fastify = Fastify({ logger: true });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);
fastify.register(cors, {
  // NOTE: Change in production
  origin: ["*"],
  methods: ["GET", "POST"],
});



/* test route */
fastify.all("/testing", async (_req, reply) => {
  const res = await wrapperGetRestaurantDetails();
  reply.send(res);
});

/* Twilio entry-point */
fastify.all("/incoming-call", async (request: any, reply) => {
  const callSid = request.body.CallSid || request.query?.CallSid;
  const fromNumber = request.body.From || request.query?.From;
  const callback = request.query?.callback || null;
  const reason = request.query?.reason || null;
  if (callback && reason) {

  }
  CALL_SID = callSid;
  FROM_NUMBER = fromNumber;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
    <Pause length="1"/>
    <Connect>
    <Stream url="wss://${request.headers.host}/media-stream?callSid=${callSid}&amp;from=${fromNumber || ''}" />
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
    const data = request.body?.data || request.query?.data

    CALLBACK_CONTEXT = {
      reason: reason[0],
      phoneNumber,
      data: JSON.stringify(data),
      isCallback: true
    };

    const client = twilio(process.env.NEXT_TWILIO_SID, process.env.NEXT_TWILIO_AUTH_TOKEN);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Pause length="1"/>
      <Connect>
      <Stream url="wss://${request.headers.host}/media-stream-callback" />
      </Connect>
    </Response>`;
    let selectedProvider = { type: "twilio" };
    try {
      const providersResponse = await wrapperGetTelephonyProviders(currentPlatformId);
      if (providersResponse?.success && Array.isArray(providersResponse.data)) {
        const activeProviders = providersResponse.data
          .filter((provider: any) => provider.isActive)
          .sort((a: any, b: any) => a.priority - b.priority);
        if (activeProviders.length > 0) {
          selectedProvider = activeProviders[0];
        }
      }
    } catch (error) {
      console.log("Failed to load telephony providers, using default Twilio.");
    }

    if (selectedProvider.type !== "twilio") {
      console.log("Unsupported provider type, falling back to Twilio.");
    }

    const call = await client.calls.create({
      from: process.env.NEXT_VIRTUAL_NUMBER,
      to: phoneNumber,
      twiml,
    });
    console.log(call.sid);
  } catch (error) {
    console.log(error.message!)
  }
  return
});

/* websocket */
fastify.register(async (fastify) => {
  // route for connecting OpenAI live api with the incoming call
  fastify.get("/media-stream", { websocket: true }, (connection, req) => {
    console.log("🔗 WebSocket connected");
    // Connection-specific state
    let streamSid: string | null = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem: string | null = null;
    let markQueue: string[] = [];
    let responseStartTimestampTwilio: number | null = null;

    // Transcription state
    let restaurantIdConfirmed = false;
    let currentRestaurantId: string | null = null;
    let currentAITranscript = "";
    let currentLanguageCode = "en";
    let currentFallbackChannel: "whatsapp" | "sms" | "none" | null = null;
    let fallbackAttempts = 0;
    let fallbackSent = false;
    let currentPlatformId: string | null = null;

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
              language: currentLanguageCode
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
                description: "Generate a 4-digit numeric order ID",
                parameters: { type: "object", properties: {}, required: [] }
              },
            ],
          },
        }),
      );
    };

    const buildLocalizedPrompt = (languagePreference?: string) => {
      const languageLine = languagePreference
        ? `Preferred language: ${languagePreference}.`
        : "Preferred language: English.";
      return `${SYSTEM_PROMPT}\n${LOCALIZATION_PROMPT}\n${languageLine}`;
    };

    const getLanguageCode = (languagePreference?: string) => {
      switch (languagePreference) {
        case "spanish":
          return "es";
        case "french":
          return "fr";
        case "pidgin":
          return "en";
        default:
          return "en";
      }
    };

    const updateSessionForRestaurant = (restaurantDetails?: { languagePreference?: string; fallbackChannel?: string }) => {
      currentLanguageCode = getLanguageCode(restaurantDetails?.languagePreference);
      currentFallbackChannel =
        restaurantDetails?.fallbackChannel === "whatsapp" || restaurantDetails?.fallbackChannel === "sms"
          ? restaurantDetails.fallbackChannel
          : "none";

      oaWs.send(
        JSON.stringify({
          type: "session.update",
          session: {
            instructions: buildLocalizedPrompt(restaurantDetails?.languagePreference),
            input_audio_transcription: {
              model: "gpt-4o-mini-transcribe",
              prompt: "Expect words related to restaurant orders, food items, phone numbers, and customer service.",
              language: currentLanguageCode,
            },
          },
        })
      );
    };

    const sendFallbackMessage = async (channel: "whatsapp" | "sms") => {
      if (!FROM_NUMBER || fallbackSent) return;
      const client = twilio(process.env.NEXT_TWILIO_SID, process.env.NEXT_TWILIO_AUTH_TOKEN);
      const messageBody =
        "We are having trouble hearing you. Please reply with your order details via this channel so we can continue.";

      if (channel === "whatsapp") {
        const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;
        if (!whatsappNumber) return;
        await client.messages.create({
          from: `whatsapp:${whatsappNumber}`,
          to: `whatsapp:${FROM_NUMBER}`,
          body: messageBody,
        });
      } else {
        await client.messages.create({
          from: process.env.NEXT_VIRTUAL_NUMBER,
          to: FROM_NUMBER,
          body: messageBody,
        });
      }
      fallbackSent = true;
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
      console.log("Speech started - handling interruption");
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH)
          console.log(
            `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`
          );

        if (lastAssistantItem) {
          const truncateEvent = {
            type: "conversation.item.truncate",
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime,
          };
          if (SHOW_TIMING_MATH)
            console.log(
              "Sending truncation event:",
              JSON.stringify(truncateEvent)
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
          console.log(`📝 Saving transcript: ${speaker}: ${dialogue}`);
          await wrapperAddTranscriptDialogues({
            dialogue,
            speaker,
            callId: CALL_SID
          });
        } catch (error) {
          console.error("Error saving transcript:", error);
        }
      } else {
        console.log(`📝 Transcript not saved (restaurant ID not confirmed): ${speaker}: ${dialogue}`);
      }
    };

    // Listen for messages from Twilio WebSocket
    connection.on("message", (data: string | Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.event) {
          case 'media':
            latestMediaTimestamp = message.media.timestamp;
            if (SHOW_TIMING_MATH) console.log(`Received media message with timestamp: ${latestMediaTimestamp}ms`);

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
            console.log('Incoming stream has started', streamSid);
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
            console.log('Stream stopped');
            if (oaWs.readyState === WebSocket.OPEN) {
              oaWs.close();
            }
            break;

          default:
            console.log('Received non-media event:', message.event);
            break;
        }
      } catch (error) {
        console.error("Error processing Twilio message:", error);
      }
    });

    // OpenAI events
    oaWs.on("message", async (raw) => {
      const res = JSON.parse(raw.toString());

      if (LOG_EVENT_TYPES.includes(res.type)) console.log(res);

      // Handle real-time transcription events for human input
      if (res.type === "conversation.item.input_audio_transcription.delta") {
        console.log("🎤 Human speaking (delta):", res);
        console.log("🎤 Human speaking (delta):", res.delta);
        // You can use delta for real-time display if needed
      }

      if (res.type === "conversation.item.input_audio_transcription.completed") {
        console.log("🎤 Human transcript completed:", res.transcript);
        // Save the completed human transcript
        await saveTranscriptIfConfirmed(res.transcript, 'human');
        if (restaurantIdConfirmed) {
          const wordCount = res.transcript?.trim().split(/\s+/).filter(Boolean).length || 0;
          if (wordCount <= FALLBACK_WORD_THRESHOLD) {
            fallbackAttempts += 1;
          } else {
            fallbackAttempts = 0;
          }
          if (
            !fallbackSent &&
            currentFallbackChannel &&
            currentFallbackChannel !== "none" &&
            fallbackAttempts >= FALLBACK_MAX_ATTEMPTS
          ) {
            await sendFallbackMessage(currentFallbackChannel);
          }
        }
      }

      // Function call from the model
      if (res.type === "response.function_call_arguments.done") {
        const args = JSON.parse(res.arguments);
        let output: any = { success: false };

        try {
          console.log("Calling Tool")
          switch (res.name) {
            case "get_restaurant_details":
              console.log("👨‍🍳 Getting restaurant details")
              output = await wrapperGetRestaurantDetails(args.restaurant_id);
              // If restaurant details are successfully retrieved, mark as confirmed
              if (output.success) {
                restaurantIdConfirmed = true;
                currentRestaurantId = args.restaurant_id;
                currentPlatformId = output?.data?.restaurantDetails?.platformId ?? null;
                updateSessionForRestaurant(output?.data?.restaurantDetails);
                console.log("✅ Restaurant ID confirmed:", args.restaurant_id);
              }
              break;
            case "add_transcript_dialogue":
              console.log("🗣️ Adding transcript dialogue")
              output = await wrapperAddTranscriptDialogues({
                ...args,
                callId: CALL_SID
              });
              break;
            case "upsert_order":
              output = await wrapperUpsertOrders({
                ...args,
                callId: CALL_SID, // Call id from Twilio,
              });
              break;
            // Update the call data
            case "upsert_call_data":
              output = await wrapperUpsertCallData({
                ...args,
                callId: CALL_SID,
              });
              break
            case "generate_order_id":
              output = { order_id: generateOrderId() };
              break;
          }
        } catch (e) {
          output = { success: false, error: String(e) };
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
          if (SHOW_TIMING_MATH) console.log(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`);
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
          const textContent = res.content.find((item: any) => item.type === 'text');
          if (textContent && textContent.text) {
            console.log("💬 AI Response Text:", textContent.text);
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
            const textContent = output.content.find((item: any) => item.type === 'text');
            if (textContent && textContent.text) {
              console.log("💬 AI Response (fallback):", textContent.text);
              await saveTranscriptIfConfirmed(textContent.text, 'ai');
            }
          }
        }
      }
    });

    // OpenAI socket lifecycle
    oaWs.on("open", async () => {
      console.log("Connected to the OpenAI Realtime API");
      console.log("Upserting the data")
      await wrapperUpsertCallData({
        callId: CALL_SID,
        phoneNumber: FROM_NUMBER,
        status: "active",
        restaurantId: "unknown"
      });
      initializeSession();
      setTimeout(greet, 200);
    });
    oaWs.on("close", async (code, reason) => {
      console.log("🤖 OpenAI socket closed:", code, reason.toString());
      // Update the call status to completed
      await wrapperUpsertCallData({
        callId: CALL_SID,
        status: "completed",
      });
    });
    oaWs.on("error", err => {
      console.error("😵 OpenAI socket error:", err);
    });

    // Twilio socket lifecycle
    connection.on("close", () => {
      console.log("📵 Twilio socket closed");
      // Shuts down the openAI socket
      if (oaWs.readyState === WebSocket.OPEN) oaWs.close();
    });

    connection.on("error", err => {
      console.error("😵 Twilio socket error:", err);
    });
  });


  // Callback route
  fastify.get("/media-stream-callback", { websocket: true }, (connection, req) => {
    console.log("🔗 Callback WebSocket connected");
    // Connection-specific state
    let streamSid: string | null = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem: string | null = null;
    let markQueue: string[] = [];
    let responseStartTimestampTwilio: number | null = null;



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
    let agentTools = []
    let systemPrompt = ""
    console.log(CALLBACK_CONTEXT.reason)
    if (CALLBACK_CONTEXT.reason === "followup") {
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
      systemPrompt = FOLLOWUP_SYSTEM_PROMPT
    } else if (CALLBACK_CONTEXT.reason === "cancellation") {
      systemPrompt = CANCELLATION_SYSTEM_PROMPT
    }

    console.log(CALLBACK_CONTEXT.reason)
    console.log(systemPrompt)

    console.log("Agent tools")
    console.log(agentTools)
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
                text: `Greet the caller. The details of the order and the reason for the call is: <data>${CALLBACK_CONTEXT.data}</data><reason>${CALLBACK_CONTEXT.reason}</reason>`,
              },
            ],
          },
        }),
      );
      oaWs.send(JSON.stringify({ type: "response.create" }));
    };

    // Helper function to handle interruptions
    const handleSpeechStartedEvent = () => {
      console.log("Speech started - handling interruption");
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH)
          console.log(
            `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`
          );

        if (lastAssistantItem) {
          const truncateEvent = {
            type: "conversation.item.truncate",
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime,
          };
          if (SHOW_TIMING_MATH)
            console.log(
              "Sending truncation event:",
              JSON.stringify(truncateEvent)
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
            if (SHOW_TIMING_MATH) console.log(`Received media message with timestamp: ${latestMediaTimestamp}ms`);

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
            console.log('Incoming stream has started', streamSid);
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
            console.log('Stream stopped');
            if (oaWs.readyState === WebSocket.OPEN) {
              oaWs.close();
            }
            break;

          default:
            console.log('Received non-media event:', message.event);
            break;
        }
      } catch (error) {
        console.error("Error processing Twilio message:", error);
      }
    });

    // OpenAI events
    oaWs.on("message", async (raw) => {
      const res = JSON.parse(raw.toString());

      if (LOG_EVENT_TYPES.includes(res.type)) console.log(res);

      // Handle real-time transcription events for human input
      if (res.type === "conversation.item.input_audio_transcription.delta") {
        console.log("🎤 Human speaking (delta):", res);
        console.log("🎤 Human speaking (delta):", res.delta);
        // You can use delta for real-time display if needed
      }

      // Function call from the model
      if (res.type === "response.function_call_arguments.done") {
        const args = JSON.parse(res.arguments);
        let output: any = { success: false };

        try {
          console.log("Calling Tool")
          switch (res.name) {
            case "get_restaurant_details":
              console.log("👨‍🍳 Getting restaurant details")
              output = await wrapperGetRestaurantDetails(args.restaurant_id);
              // If restaurant details are successfully retrieved, mark as confirmed
              break;
            case "add_transcript_dialogue":
              console.log("🗣️ Adding transcript dialogue")
              output = await wrapperAddTranscriptDialogues({
                ...args,
                callId: CALL_SID
              });
              break;
            case "upsert_order":
              output = await wrapperUpsertOrders({
                ...args,
              });
              break;
            // Update the call data
            case "upsert_call_data":
              output = await wrapperUpsertCallData({
                ...args,
                callId: CALL_SID,
              });
              break
            case "generate_order_id":
              output = { order_id: generateOrderId() };
              break;
          }
        } catch (e) {
          output = { success: false, error: String(e) };
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
          if (SHOW_TIMING_MATH) console.log(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`);
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
      console.log("Connected to the OpenAI Realtime API");
      initializeSession();
      setTimeout(greet, 200);
    });
    oaWs.on("close", async (code, reason) => {
      console.log("🤖 OpenAI socket closed:", code, reason.toString());
    });
    oaWs.on("error", err => {
      console.error("😵 OpenAI socket error:", err);
    });

    // Twilio socket lifecycle
    connection.on("close", () => {
      console.log("📵 Twilio socket closed");
      // Shuts down the openAI socket
      if (oaWs.readyState === WebSocket.OPEN) oaWs.close();
    });

    connection.on("error", err => {
      console.error("😵 Twilio socket error:", err);
    });
  });
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, url) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server running at ${url}`);
});
