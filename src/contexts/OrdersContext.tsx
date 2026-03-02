"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  ReactNode,
  useEffect,
} from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Order, OrderItem, Call } from "@/types/global";
import { useRestaurantStorage } from "@/hooks/useRestaurantStorage";
import { Doc, Id } from "convex/_generated/dataModel";

// State interface
interface OrdersState {
  orders: Order[];
  activeOrders: Order[];
  pastOrders: Order[];
  loading: boolean;
  error: string | null;
}

// Action types
type OrdersAction =
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_ORDERS"; payload: Order[] }
  | { type: "ADD_ORDER"; payload: Order }
  | { type: "UPDATE_ORDER"; payload: Order }
  | { type: "DELETE_ORDER"; payload: string }
  | { type: "CANCEL_ORDER"; payload: { orderId: string; reason: string } }
  | { type: "COMPLETE_ORDER"; payload: string }
  | { type: "RESET" };

// Helper function to categorize orders
function categorizeOrders(orders: Order[]) {
  const activeOrders = orders.filter((order) => order.status === "active");
  const pastOrders = orders.filter(
    (order) => order.status === "completed" || order.status === "cancelled"
  );
  return { activeOrders, pastOrders };
}

// Initial state
const initialState: OrdersState = {
  orders: [],
  activeOrders: [],
  pastOrders: [],
  loading: true,
  error: null,
};

// Reducer
function ordersReducer(state: OrdersState, action: OrdersAction): OrdersState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.payload };

    case "SET_ERROR":
      return { ...state, error: action.payload, loading: false };

    case "SET_ORDERS": {
      const { activeOrders, pastOrders } = categorizeOrders(action.payload);
      return {
        ...state,
        orders: action.payload,
        activeOrders,
        pastOrders,
        loading: false,
        error: null,
      };
    }

    case "ADD_ORDER": {
      const updatedOrders = [...state.orders, action.payload];
      const { activeOrders, pastOrders } = categorizeOrders(updatedOrders);
      return {
        ...state,
        orders: updatedOrders,
        activeOrders,
        pastOrders,
        loading: false,
        error: null,
      };
    }

    case "UPDATE_ORDER": {
      const updatedOrders = state.orders.map((order) =>
        order.id === action.payload.id ? action.payload : order
      );
      const { activeOrders, pastOrders } = categorizeOrders(updatedOrders);
      return {
        ...state,
        orders: updatedOrders,
        activeOrders,
        pastOrders,
        loading: false,
        error: null,
      };
    }

    case "DELETE_ORDER": {
      const updatedOrders = state.orders.filter(
        (order) => order.id !== action.payload
      );
      const { activeOrders, pastOrders } = categorizeOrders(updatedOrders);
      return {
        ...state,
        orders: updatedOrders,
        activeOrders,
        pastOrders,
        loading: false,
        error: null,
      };
    }

    case "CANCEL_ORDER": {
      const updatedOrders = state.orders.map((order) =>
        order.id === action.payload.orderId
          ? {
              ...order,
              status: "cancelled" as const,
              cancellationReason: action.payload.reason,
            }
          : order
      );
      const { activeOrders, pastOrders } = categorizeOrders(updatedOrders);
      return {
        ...state,
        orders: updatedOrders,
        activeOrders,
        pastOrders,
        loading: false,
        error: null,
      };
    }

    case "COMPLETE_ORDER": {
      const updatedOrders = state.orders.map((order) =>
        order.id === action.payload
          ? { ...order, status: "completed" as const }
          : order
      );
      const { activeOrders, pastOrders } = categorizeOrders(updatedOrders);
      return {
        ...state,
        orders: updatedOrders,
        activeOrders,
        pastOrders,
        loading: false,
        error: null,
      };
    }

    case "RESET":
      return initialState;

    default:
      return state;
  }
}

// Context
interface OrdersContextType {
  state: OrdersState;
  actions: {
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setOrders: (orders: Order[]) => void;
    addOrder: (order: Order) => void;
    updateOrder: (order: Order) => void;
    deleteOrder: (orderId: string) => void;
    cancelOrder: (orderId: string, reason: string) => void;
    completeOrder: (orderId: string) => void;
    createOrder: (orderData: Omit<Order, "id" | "timestamp">) => void;
    reset: () => void;
  };
}

const OrdersContext = createContext<OrdersContextType | undefined>(undefined);

// Provider component
interface OrdersProviderProps {
  children: ReactNode;
}

export function OrdersProvider({ children }: OrdersProviderProps) {
  const [state, dispatch] = useReducer(ordersReducer, initialState);
  const { restaurantId } = useRestaurantStorage();

  // Reset state when restaurantId changes
  useEffect(() => {
    dispatch({ type: "RESET" });
  }, [restaurantId]);

  // Convex queries and mutations
  const convexActiveOrders = useQuery(
    api.orders.getActiveOrdersByRestaurant,
    restaurantId ? { restaurantId } : "skip"
  );
  const convexPastOrders = useQuery(
    api.orders.getPastOrdersByRestaurant,
    restaurantId ? { restaurantId } : "skip"
  );
  const convexCalls = useQuery(
    api.calls.getCallsByRestaurant,
    restaurantId ? { restaurantId } : "skip"
  );
  const updateOrderMutation = useMutation(api.orders.updateOrder);
  const cancelOrderMutation = useMutation(api.orders.cancelOrder);
  const completeOrderMutation = useMutation(api.orders.completeOrder);

  // Helper function to convert Convex order to our Order type
  const convertOrder = (order: Doc<"orders">, calls: Call[]): Order => {
    const associatedCall = calls.find((call) => call.callId === order.callId);

    return {
      id: order.orderId,
      publicOrderCode: order.publicOrderCode,
      callId: order.callId,
      phoneNumber: associatedCall?.phoneNumber || order.customerPhone || "Unknown",
      customerName: order.customerName,
      items: order.items.map(
        (item: Doc<"orders">["items"][0], index: number) => ({
          id: `${order.orderId}-${index}`,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          specialInstructions: undefined, // Not in Convex schema yet
        })
      ),
      totalAmount:
        order.totalAmount ||
        order.items.reduce(
          (sum: number, item: Doc<"orders">["items"][0]) =>
            sum + item.price * item.quantity,
          0
        ),
      specialInstructions: order.specialInstructions,
      status: order.status,
      timestamp: new Date(order.orderPlacementTime || order._creationTime),
      cancellationReason: order.cancellationReason,
      // Multi-tenant fields
      branchId: order.branchId,
      restaurantId: order.restaurantId,
      // Payment fields (Nigerian market)
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentReference: order.paymentReference,
      paymentTimestamp: order.paymentTimestamp,
      // Delivery fields
      deliveryStatus: order.deliveryStatus,
      riderId: order.riderId,
      riderName: order.riderName,
      dispatchedAt: order.dispatchedAt,
      deliveredAt: order.deliveredAt,
      deliveryFailureReason: order.deliveryFailureReason,
      // WhatsApp fields
      whatsappOptIn: order.whatsappOptIn,
      whatsappMessageIds: order.whatsappMessageIds,
    };
  };

  // Convert Convex orders to our Order type
  useEffect(() => {
    if (convexActiveOrders && convexPastOrders && convexCalls) {
      const activeOrders: Order[] = convexActiveOrders.map((order) =>
        convertOrder(order, convexCalls)
      );
      const pastOrders: Order[] = convexPastOrders.map((order) =>
        convertOrder(order, convexCalls)
      );
      const allOrders = [...activeOrders, ...pastOrders];

      dispatch({ type: "SET_ORDERS", payload: allOrders });
    } else if (
      restaurantId &&
      (convexActiveOrders === undefined ||
        convexPastOrders === undefined ||
        convexCalls === undefined)
    ) {
      dispatch({ type: "SET_LOADING", payload: true });
    } else if (
      restaurantId &&
      convexActiveOrders !== undefined &&
      convexPastOrders !== undefined &&
      convexCalls !== undefined
    ) {
      // All queries have returned, even if some are empty
      const activeOrders: Order[] = (convexActiveOrders || []).map((order) =>
        convertOrder(order, convexCalls || [])
      );
      const pastOrders: Order[] = (convexPastOrders || []).map((order) =>
        convertOrder(order, convexCalls || [])
      );
      const allOrders = [...activeOrders, ...pastOrders];

      dispatch({ type: "SET_ORDERS", payload: allOrders });
    } else if (!restaurantId) {
      // No restaurant ID available, set empty state
      dispatch({ type: "SET_ORDERS", payload: [] });
    }
  }, [convexActiveOrders, convexPastOrders, convexCalls, restaurantId]);

  const actions = {
    setLoading: (loading: boolean) =>
      dispatch({ type: "SET_LOADING", payload: loading }),
    setError: (error: string | null) =>
      dispatch({ type: "SET_ERROR", payload: error }),
    setOrders: (orders: Order[]) =>
      dispatch({ type: "SET_ORDERS", payload: orders }),
    addOrder: (order: Order) => dispatch({ type: "ADD_ORDER", payload: order }),
    updateOrder: (order: Order) =>
      dispatch({ type: "UPDATE_ORDER", payload: order }),
    deleteOrder: (orderId: string) =>
      dispatch({ type: "DELETE_ORDER", payload: orderId }),

    cancelOrder: async (orderId: string, reason: string) => {
      try {
        dispatch({ type: "SET_LOADING", payload: true });

        // Find the Convex order ID from active orders (since we're cancelling an active order)
        const convexOrder = convexActiveOrders?.find(
          (order) => order.orderId === orderId
        );
        if (convexOrder) {
          await cancelOrderMutation({
            orderId: convexOrder._id,
            cancellationReason: reason,
          });
        }

        // Update local state
        dispatch({ type: "CANCEL_ORDER", payload: { orderId, reason } });
      } catch (error) {
        console.error("Failed to cancel order:", error);
        dispatch({ type: "SET_ERROR", payload: "Failed to cancel order" });
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    },

    completeOrder: async (orderId: string) => {
      try {
        dispatch({ type: "SET_LOADING", payload: true });

        // Find the Convex order ID from active orders (since we're completing an active order)
        const convexOrder = convexActiveOrders?.find(
          (order) => order.orderId === orderId
        );
        if (convexOrder) {
          await completeOrderMutation({
            orderId: convexOrder._id,
          });
        }

        // Update local state
        dispatch({ type: "COMPLETE_ORDER", payload: orderId });
      } catch (error) {
        console.error("Failed to complete order:", error);
        dispatch({ type: "SET_ERROR", payload: "Failed to complete order" });
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    },

    createOrder: (orderData: Omit<Order, "id" | "timestamp">) => {
      const newOrder: Order = {
        ...orderData,
        id: `order-${Date.now()}`,
        timestamp: new Date(),
      };
      dispatch({ type: "ADD_ORDER", payload: newOrder });
    },

    reset: () => dispatch({ type: "RESET" }),
  };

  return (
    <OrdersContext.Provider value={{ state, actions }}>
      {children}
    </OrdersContext.Provider>
  );
}

// Hook to use the context
export function useOrders() {
  const context = useContext(OrdersContext);
  if (context === undefined) {
    throw new Error("useOrders must be used within an OrdersProvider");
  }
  return context;
}
