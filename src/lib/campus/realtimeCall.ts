/**
 * Feature: dinee-campus (browser voice transport).
 *
 * A small, framework-agnostic wrapper around the OpenAI Realtime API WebRTC
 * handshake for the browser Call surface. It mints nothing itself: it fetches a
 * short-lived ephemeral token from the server route `/campus/api/realtime-token`
 * (which is scoped to the server-minted `callId` capability), then opens a
 * WebRTC peer connection directly to OpenAI — sending the microphone track and
 * playing the agent's audio in its selected voice (Req 8.1, 8.3).
 *
 * The real platform API key never reaches the browser: only the ephemeral token
 * does, and only after the call has cleared the access + usage gates in
 * `startBrowserCall`. Every failure path (voice not configured, mic denied,
 * token/SDP error) reports through `onStatus("error")` so the UI can fall back
 * to its represented state without breaking the rest of the call lifecycle
 * (rating / analytics still work off the server-authoritative `callId`).
 */

/** Lifecycle status of the realtime media connection. */
export type RealtimeCallStatus =
  | "connecting"
  | "connected"
  | "ended"
  | "error";

export interface RealtimeCallCallbacks {
  /** Called on each connection status transition. */
  onStatus?: (status: RealtimeCallStatus) => void;
  /** Called with a human-readable reason when the connection fails. */
  onError?: (reason: string) => void;
  /**
   * Resolves a live `campus_lookup_knowledge` tool call: given the caller's
   * question, returns the plain-text grounding result (matched approved
   * knowledge, or a "cannot answer" fallback) the model receives as the tool
   * output (Req 5.5, 8.4, 8.5). Best-effort — if omitted or it throws, the call
   * still functions using the knowledge already embedded in the system prompt.
   */
  onKnowledgeLookup?: (question: string) => Promise<string>;
}

/** A handle to an active realtime call; call `stop()` to tear it down. */
export interface RealtimeCallHandle {
  stop: () => void;
}

/** The OpenAI endpoint the browser POSTs its SDP offer to (auth: ephemeral). */
const REALTIME_CALLS_ENDPOINT = "https://api.openai.com/v1/realtime/calls";

/**
 * Opens a browser WebRTC voice session for the given server-minted `callId`.
 * Resolves once the peer connection has been negotiated (the SDP answer
 * applied); audio then flows for the life of the returned handle. Rejects (and
 * reports via `onError`) if voice transport is unavailable or the handshake
 * fails, so the caller can degrade gracefully.
 *
 * Browser-only: throws if called without the required Web APIs.
 */
export async function startRealtimeCall(
  callId: string,
  callbacks: RealtimeCallCallbacks = {}
): Promise<RealtimeCallHandle> {
  const { onStatus, onError, onKnowledgeLookup } = callbacks;

  if (
    typeof window === "undefined" ||
    typeof RTCPeerConnection === "undefined" ||
    !navigator?.mediaDevices?.getUserMedia
  ) {
    onError?.("Voice calling isn't supported in this browser.");
    onStatus?.("error");
    throw new Error("webrtc_unsupported");
  }

  onStatus?.("connecting");

  // 1) Mint an ephemeral token, scoped to this call, from our server route.
  let token: string;
  try {
    const res = await fetch("/campus/api/realtime-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId }),
    });
    if (!res.ok) {
      onError?.(
        res.status === 503
          ? "Voice calling isn't available right now."
          : "We couldn't start the voice connection."
      );
      onStatus?.("error");
      throw new Error(`token_error_${res.status}`);
    }
    const data = (await res.json()) as { value?: string };
    if (!data.value) {
      onError?.("We couldn't start the voice connection.");
      onStatus?.("error");
      throw new Error("token_missing");
    }
    token = data.value;
  } catch (err) {
    // fetch/parse failures already reported above where known; ensure a signal.
    if (!(err instanceof Error && err.message.startsWith("token_"))) {
      onError?.("We couldn't reach the voice service.");
      onStatus?.("error");
    }
    throw err instanceof Error ? err : new Error("token_fetch_failed");
  }

  // 2) Acquire the microphone. A denial is a normal, recoverable outcome.
  let micStream: MediaStream;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    onError?.("Microphone access is needed to talk to this agent.");
    onStatus?.("error");
    throw new Error("mic_denied");
  }

  // 3) Build the peer connection: play remote audio, send the mic track.
  const pc = new RTCPeerConnection();
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  // Keep it out of layout but attached so autoplay is honored.
  audioEl.style.display = "none";
  document.body.appendChild(audioEl);

  let stopped = false;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    try {
      for (const track of micStream.getTracks()) track.stop();
    } catch {
      /* ignore */
    }
    try {
      pc.close();
    } catch {
      /* ignore */
    }
    try {
      audioEl.srcObject = null;
      audioEl.remove();
    } catch {
      /* ignore */
    }
  };

  pc.ontrack = (event) => {
    if (event.streams[0]) {
      audioEl.srcObject = event.streams[0];
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      onStatus?.("connected");
    } else if (
      pc.connectionState === "failed" ||
      pc.connectionState === "closed" ||
      pc.connectionState === "disconnected"
    ) {
      if (!stopped) {
        onStatus?.(pc.connectionState === "failed" ? "error" : "ended");
      }
    }
  };

  try {
    for (const track of micStream.getTracks()) {
      pc.addTrack(track, micStream);
    }
    // Data channel for realtime events: used to receive tool calls from the
    // model and return grounded knowledge (Req 5.5, 8.4, 8.5).
    const dc = pc.createDataChannel("oai-events");
    wireToolChannel(dc, onKnowledgeLookup);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch(REALTIME_CALLS_ENDPOINT, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/sdp",
      },
    });
    if (!sdpResponse.ok) {
      throw new Error(`sdp_error_${sdpResponse.status}`);
    }
    const answerSdp = await sdpResponse.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  } catch (err) {
    cleanup();
    onError?.("We couldn't connect the voice session.");
    onStatus?.("error");
    throw err instanceof Error ? err : new Error("sdp_failed");
  }

  return { stop: cleanup };
}

/** The knowledge-lookup tool name the model calls (mirrors the pure logic). */
const CAMPUS_LOOKUP_TOOL_NAME = "campus_lookup_knowledge";

/**
 * Wires the Realtime data channel to service live `campus_lookup_knowledge` tool
 * calls (Req 5.5, 8.4, 8.5). When the model emits a completed function call, we
 * resolve the grounded answer via `onKnowledgeLookup`, return it as the tool
 * output, and ask the model to continue — deferring that follow-up until the
 * current response finishes so we never trip OpenAI's
 * "conversation already has an active response" guard.
 *
 * Everything here is best-effort and fully guarded: a missing resolver, a parse
 * error, a resolver rejection, or an unexpected event shape is swallowed so the
 * voice session is never interrupted. The model still has the agent's knowledge
 * embedded in its system prompt, so grounding degrades gracefully to that.
 */
function wireToolChannel(
  dc: RTCDataChannel,
  onKnowledgeLookup?: (question: string) => Promise<string>
): void {
  if (!onKnowledgeLookup) return;

  // Track whether a model response is in flight so a follow-up `response.create`
  // is only sent once the active response has finished.
  let responseActive = false;
  let pendingContinue = false;

  const safeSend = (payload: unknown): void => {
    try {
      if (dc.readyState === "open") {
        dc.send(JSON.stringify(payload));
      }
    } catch {
      /* ignore transport errors — audio is unaffected */
    }
  };

  const requestContinue = (): void => {
    if (responseActive) {
      pendingContinue = true;
    } else {
      safeSend({ type: "response.create" });
    }
  };

  dc.addEventListener("message", (event: MessageEvent) => {
    let msg: {
      type?: string;
      name?: string;
      call_id?: string;
      arguments?: string;
    };
    try {
      msg = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "response.created") {
      responseActive = true;
      return;
    }
    if (msg.type === "response.done") {
      responseActive = false;
      if (pendingContinue) {
        pendingContinue = false;
        safeSend({ type: "response.create" });
      }
      return;
    }

    // A completed function call from the model.
    if (
      msg.type === "response.function_call_arguments.done" &&
      msg.name === CAMPUS_LOOKUP_TOOL_NAME &&
      typeof msg.call_id === "string"
    ) {
      const callItemId = msg.call_id;
      let question = "";
      try {
        const parsed = JSON.parse(msg.arguments ?? "{}") as {
          question?: unknown;
        };
        question = typeof parsed.question === "string" ? parsed.question : "";
      } catch {
        question = "";
      }

      void (async () => {
        let output: string;
        try {
          output = await onKnowledgeLookup(question);
        } catch {
          // On resolver failure, tell the model it can't retrieve knowledge now
          // rather than leaving the tool call unanswered.
          output =
            "I can't look that up right now. Let the caller know you don't have that information.";
        }
        // Return the tool output, then ask the model to continue speaking.
        safeSend({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callItemId,
            output,
          },
        });
        requestContinue();
      })();
    }
  });
}
