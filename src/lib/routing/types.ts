/**
 * Order Routing Types
 * 
 * Types for multi-location order routing based on customer location
 * derived from Nigerian phone area codes.
 * 
 * Requirements: 27.1, 27.2, 27.3, 27.4, 27.5
 */

/**
 * Branch capacity status
 */
export type BranchCapacityStatus = 'available' | 'busy' | 'at_capacity';

/**
 * Represents a routing decision for an order
 */
export interface RoutingDecision {
  /** The selected branch ID for the order */
  selectedBranchId: string;
  /** The name of the selected branch */
  selectedBranchName: string;
  /** Reason for the routing decision */
  reason: RoutingReason;
  /** Alternative branches that could handle the order */
  alternatives: AlternativeBranch[];
  /** Customer location information used for routing */
  customerLocation: CustomerLocation | null;
  /** Timestamp of the routing decision */
  timestamp: number;
  /** Warnings about the routing decision (e.g., branch closed, at capacity) */
  warnings?: string[];
}

/**
 * Reason for the routing decision
 */
export type RoutingReason =
  | 'nearest_branch'           // Routed to nearest branch based on location
  | 'same_city'                // Routed to branch in same city
  | 'same_state'               // Routed to branch in same state
  | 'fallback_any_active'      // No location match, routed to any active branch
  | 'customer_selected'        // Customer manually selected branch
  | 'only_branch_available';   // Only one active branch exists

/**
 * Alternative branch that could handle the order
 */
export interface AlternativeBranch {
  branchId: string;
  branchName: string;
  address: string;
  /** Distance indicator (same_city, same_state, different_state) */
  proximity: 'same_city' | 'same_state' | 'different_state';
  /** Whether the branch is currently open */
  isOpen: boolean;
  /** Current capacity status */
  capacityStatus?: BranchCapacityStatus;
}

/**
 * Branch availability information
 */
export interface BranchAvailability {
  branchId: string;
  branchName: string;
  address: string;
  /** Whether the branch is active */
  isActive: boolean;
  /** Whether the branch is currently open based on operating hours */
  isOpen: boolean;
  /** Current capacity status */
  capacityStatus: BranchCapacityStatus;
  /** City extracted from address */
  city: string | null;
  /** State extracted from address */
  state: string | null;
}

/**
 * Customer location derived from phone number
 */
export interface CustomerLocation {
  /** City name (e.g., "Lagos", "Abuja") */
  city: string | null;
  /** State name (e.g., "Lagos State", "FCT") */
  state: string | null;
  /** Area code extracted from phone number */
  areaCode: string;
  /** Confidence level of the location detection */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Nigerian area code mapping
 * Maps area codes to city/state information
 */
export interface NigerianAreaCodeMapping {
  areaCode: string;
  city: string;
  state: string;
  /** Mobile network prefixes associated with this region */
  mobilePrefixes?: string[];
}

/**
 * Nigerian states and their major cities
 */
export type NigerianState =
  | 'Lagos'
  | 'FCT'           // Federal Capital Territory (Abuja)
  | 'Rivers'        // Port Harcourt
  | 'Kano'
  | 'Oyo'           // Ibadan
  | 'Kaduna'
  | 'Ogun'
  | 'Enugu'
  | 'Delta'
  | 'Anambra'
  | 'Edo'
  | 'Imo'
  | 'Kwara'
  | 'Cross River'
  | 'Akwa Ibom'
  | 'Plateau'
  | 'Benue'
  | 'Niger'
  | 'Bauchi'
  | 'Borno'
  | 'Adamawa'
  | 'Sokoto'
  | 'Zamfara'
  | 'Kebbi'
  | 'Katsina'
  | 'Jigawa'
  | 'Yobe'
  | 'Gombe'
  | 'Taraba'
  | 'Nasarawa'
  | 'Kogi'
  | 'Ekiti'
  | 'Ondo'
  | 'Osun'
  | 'Abia'
  | 'Ebonyi'
  | 'Bayelsa';

/**
 * Branch data for routing purposes
 */
export interface BranchForRouting {
  branchId: string;
  restaurantId: string;
  name: string;
  address: string;
  phoneNumber: string;
  operatingHours: OperatingHours;
  isActive: boolean;
}

/**
 * Operating hours for a branch
 */
export interface OperatingHours {
  monday?: DayHours;
  tuesday?: DayHours;
  wednesday?: DayHours;
  thursday?: DayHours;
  friday?: DayHours;
  saturday?: DayHours;
  sunday?: DayHours;
}

/**
 * Operating hours for a single day
 */
export interface DayHours {
  open: string;  // Format: "HH:MM" (24-hour)
  close: string; // Format: "HH:MM" (24-hour)
}

/**
 * Result of routing an order
 */
export interface OrderRoutingResult {
  success: boolean;
  decision: RoutingDecision | null;
  error?: string;
}

/**
 * Configuration options for order routing
 * 
 * Requirements: 27.3, 27.4
 */
export interface RoutingConfig {
  /** Whether to consider branch operating hours when routing */
  considerOperatingHours: boolean;
  /** Whether to consider branch capacity when routing */
  considerCapacity: boolean;
  /** Maximum number of alternative branches to return */
  maxAlternatives: number;
  /** Whether to allow routing to closed branches as fallback */
  allowClosedBranchFallback: boolean;
  /** Default branch ID to use when no location match is found */
  defaultBranchId?: string;
}

/**
 * Default routing configuration
 */
export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  considerOperatingHours: true,
  considerCapacity: true,
  maxAlternatives: 5,
  allowClosedBranchFallback: true,
  defaultBranchId: undefined,
};
