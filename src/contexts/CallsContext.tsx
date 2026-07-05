"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  ReactNode,
  useEffect,
} from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Call } from "@/types/global";
import { useRestaurantStorage } from "@/hooks/useRestaurantStorage";
import { Doc } from "convex/_generated/dataModel";

// State interface
interface CallsState {
  calls: Call[];
  activeCalls: Call[];
  pastCalls: Call[];
  loading: boolean;
  error: string | null;
}

// Action types
type CallsAction =
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_CALLS"; payload: Call[] }
  | { type: "ADD_CALL"; payload: Call }
  | { type: "UPDATE_CALL"; payload: Call }
  | { type: "DELETE_CALL"; payload: string }
  | { type: "RESET" }
  | {
      type: "UPDATE_LIVE_TRANSCRIPT";
      payload: { callId: string; transcript: string };
    };

// Helper function to categorize calls
function categorizeCalls(calls: Call[]) {
  const activeCalls = calls.filter((call) => call.status === "active");
  const pastCalls = calls.filter((call) => call.status === "completed");
  return { activeCalls, pastCalls };
}

// Initial state
const initialState: CallsState = {
  calls: [],
  activeCalls: [],
  pastCalls: [],
  loading: true,
  error: null,
};

// Reducer
function callsReducer(state: CallsState, action: CallsAction): CallsState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.payload };

    case "SET_ERROR":
      return { ...state, error: action.payload, loading: false };

    case "SET_CALLS": {
      const { activeCalls, pastCalls } = categorizeCalls(action.payload);
      return {
        ...state,
        calls: action.payload,
        activeCalls,
        pastCalls,
        loading: false,
        error: null,
      };
    }

    case "ADD_CALL": {
      const updatedCalls = [...state.calls, action.payload];
      const { activeCalls, pastCalls } = categorizeCalls(updatedCalls);
      return {
        ...state,
        calls: updatedCalls,
        activeCalls,
        pastCalls,
        loading: false,
        error: null,
      };
    }

    case "UPDATE_CALL": {
      const updatedCalls = state.calls.map((call) =>
        call._id === action.payload._id ? action.payload : call
      );
      const { activeCalls, pastCalls } = categorizeCalls(updatedCalls);
      return {
        ...state,
        calls: updatedCalls,
        activeCalls,
        pastCalls,
        loading: false,
        error: null,
      };
    }

    case "DELETE_CALL": {
      const updatedCalls = state.calls.filter(
        (call) => call._id !== action.payload
      );
      const { activeCalls, pastCalls } = categorizeCalls(updatedCalls);
      return {
        ...state,
        calls: updatedCalls,
        activeCalls,
        pastCalls,
        loading: false,
        error: null,
      };
    }

    case "UPDATE_LIVE_TRANSCRIPT": {
      const updatedCalls = state.calls.map((call) =>
        call.callId === action.payload.callId
          ? { ...call, liveTranscript: action.payload.transcript }
          : call
      );
      const { activeCalls, pastCalls } = categorizeCalls(updatedCalls);
      return {
        ...state,
        calls: updatedCalls,
        activeCalls,
        pastCalls,
      };
    }

    case "RESET":
      return initialState;

    default:
      return state;
  }
}

// Context
interface CallsContextType {
  state: CallsState;
  actions: {
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setCalls: (calls: Call[]) => void;
    addCall: (call: Call) => void;
    updateCall: (call: Call) => void;
    deleteCall: (callId: string) => void;
    updateLiveTranscript: (callId: string, transcript: string) => void;
    completeCall: (
      callId: string,
      transcript?: string,
      orderId?: string,
      reason?: string
    ) => void;
    reset: () => void;
  };
}

const CallsContext = createContext<CallsContextType | undefined>(undefined);

// Provider component
interface CallsProviderProps {
  children: ReactNode;
}

export function CallsProvider({ children }: CallsProviderProps) {
  const [state, dispatch] = useReducer(callsReducer, initialState);
  const { restaurantId } = useRestaurantStorage();

  // Reset state when restaurantId changes
  useEffect(() => {
    dispatch({ type: "RESET" });
  }, [restaurantId]);

  // Fetch calls from Convex
  const convexCalls = useQuery(
    api.calls.getCallsByRestaurant,
    restaurantId ? { restaurantId } : "skip"
  );

  // Convert Convex calls to our Call type
  useEffect(() => {
    if (convexCalls) {
      const calls: Call[] = convexCalls.map((call: Doc<"calls">) => ({
        ...call,
        phoneNumber: call.phoneNumber,
        status: call.status,
        orderId: call.orderId,
        callId: call.callId,
      }));
      dispatch({ type: "SET_CALLS", payload: calls });
    } else if (restaurantId && convexCalls === undefined) {
      dispatch({ type: "SET_LOADING", payload: true });
    } else if (restaurantId && convexCalls === null) {
      dispatch({ type: "SET_CALLS", payload: [] });
    } else if (!restaurantId) {
      // No restaurant ID available, set empty state
      dispatch({ type: "SET_CALLS", payload: [] });
    }
  }, [convexCalls, restaurantId]);

  const actions = {
    setLoading: (loading: boolean) =>
      dispatch({ type: "SET_LOADING", payload: loading }),
    setError: (error: string | null) =>
      dispatch({ type: "SET_ERROR", payload: error }),
    setCalls: (calls: Call[]) =>
      dispatch({ type: "SET_CALLS", payload: calls }),
    addCall: (call: Call) => dispatch({ type: "ADD_CALL", payload: call }),
    updateCall: (call: Call) =>
      dispatch({ type: "UPDATE_CALL", payload: call }),
    deleteCall: (callId: string) =>
      dispatch({ type: "DELETE_CALL", payload: callId }),
    updateLiveTranscript: (callId: string, transcript: string) =>
      dispatch({
        type: "UPDATE_LIVE_TRANSCRIPT",
        payload: { callId, transcript },
      }),
    reset: () => dispatch({ type: "RESET" }),

    completeCall: (callId: string, orderId?: string) => {
      const call = state.calls.find((c) => c.callId === callId);
      if (call) {
        const updatedCall: Call = {
          ...call,
          status: "completed",
          orderId,
        };
        dispatch({ type: "UPDATE_CALL", payload: updatedCall });
      }
    },
  };

  return (
    <CallsContext.Provider value={{ state, actions }}>
      {children}
    </CallsContext.Provider>
  );
}

// Hook to use the context
export function useCalls() {
  const context = useContext(CallsContext);
  if (context === undefined) {
    throw new Error("useCalls must be used within a CallsProvider");
  }
  return context;
}
