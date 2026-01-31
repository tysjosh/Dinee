// Global type definitions for the restaurant call management application

import { Doc } from "convex/_generated/dataModel";

export interface User {
  id: string;
  email: string;
  restaurantId: string;
  platformId?: string;
  branchId?: string;
  role?: "platform_admin" | "restaurant_owner" | "branch_manager" | "supervisor";
}

export interface Restaurant {
  id: string;
  platformId?: string;
  name: string;
  agentName: string;
  menuDetails: Array<{
    // Menu item name
    name: string;
    // Menu item price
    price: string;
    // Menu item description
    description?: string;
    // Menu item modifiers
    modifiers?: string[];
  }>;
  specialInstructions: string;
  languagePreference: string;
  locale?: string;
  fallbackChannel?: "whatsapp" | "sms" | "none";
  virtualNumber?: string;
}

export interface Platform {
  id: string;
  name: string;
}

export interface Branch {
  id: string;
  platformId: string;
  restaurantId: string;
  name: string;
  address?: string;
}

export type Call  = Doc<"calls">

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  specialInstructions?: string;
}

export interface Order {
  id: string;
  callId?: string;
  phoneNumber: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  specialInstructions?: string;
  status: "active" | "completed" | "cancelled";
  paymentStatus?: "pending" | "paid" | "failed" | "refunded" | "cod_pending";
  paymentProvider?: "paystack" | "flutterwave" | "cash" | "other";
  paymentMethod?: "card" | "transfer" | "cash" | "ussd" | "bank";
  paymentReference?: string;
  paymentVerifiedAt?: Date;
  whatsappStatus?: "opted_in" | "opted_out" | "pending";
  whatsappPhone?: string;
  whatsappLastMessageAt?: Date;
  deliveryStatus?: "pending" | "preparing" | "dispatched" | "delivered" | "failed" | "cancelled";
  deliveryPartner?: string;
  deliveryUpdatedAt?: Date;
  timestamp: Date;
  cancellationReason?: string;
}

// Additional utility types
export type CallStatus = "active" | "completed";
export type OrderStatus = "active" | "completed" | "cancelled";
export type SentimentType = "positive" | "neutral" | "negative";
export type LanguagePreference = "english" | "spanish" | "french" | "pidgin";
