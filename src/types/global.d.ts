// Global type definitions for the restaurant call management application

import { Doc } from "convex/_generated/dataModel";

export interface User {
  id: string;
  email: string;
  restaurantId: string;
  // Multi-tenant fields
  role?: UserRole;
  tenantType?: TenantType;
  tenantId?: string;
}

export interface Restaurant {
  id: string;
  name: string;
  agentName: string;
  menuDetails: Array<{
    // Menu item name
    name: string;
    // Menu item price
    price: string;
    // Menu item description
    description?: string;
  }>;
  specialInstructions: string;
  languagePreference: string;
  virtualNumber?: string;
  platformId?: string; // Foreign key to platforms table (multi-tenancy)
  branchCount?: number; // Count of branches for this restaurant
}

// Multi-tenant types
export type UserRole = 'platform_admin' | 'restaurant_owner' | 'branch_manager' | 'supervisor';
export type TenantType = 'platform' | 'restaurant' | 'branch';

export type Call  = Doc<"calls">

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  specialInstructions?: string;
}

// Payment types for Nigerian market
export type PaymentMethod = 'paystack' | 'flutterwave' | 'cod';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type DeliveryStatus = 'pending' | 'assigned' | 'dispatched' | 'in_transit' | 'delivered' | 'failed';

export interface Order {
  id: string;
  callId?: string;
  phoneNumber: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  specialInstructions?: string;
  status: "active" | "preparing" | "ready" | "completed" | "cancelled";
  timestamp: Date;
  cancellationReason?: string;
  // Multi-tenant fields
  branchId?: string;
  restaurantId?: string;
  // Payment fields (Nigerian market)
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  paymentReference?: string;
  paymentTimestamp?: number;
  // Delivery fields
  deliveryStatus?: DeliveryStatus;
  riderId?: string;
  riderName?: string;
  dispatchedAt?: number;
  deliveredAt?: number;
  deliveryFailureReason?: string;
  // WhatsApp fields
  whatsappOptIn?: boolean;
  whatsappMessageIds?: string[];
}

// Additional utility types
export type CallStatus = "active" | "completed";
export type OrderStatus = "active" | "preparing" | "ready" | "completed" | "cancelled";
export type SentimentType = "positive" | "neutral" | "negative";
export type LanguagePreference = "english" | "nigerian_english" | "pidgin" | "spanish" | "french";