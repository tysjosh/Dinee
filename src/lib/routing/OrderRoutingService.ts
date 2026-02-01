/**
 * Order Routing Service
 * 
 * Determines customer location from Nigerian phone area codes and
 * routes orders to the nearest active branch.
 * 
 * Requirements: 27.1, 27.2, 27.3, 27.4, 27.5
 */

import {
  RoutingDecision,
  RoutingReason,
  AlternativeBranch,
  BranchAvailability,
  CustomerLocation,
  NigerianAreaCodeMapping,
  BranchForRouting,
  OperatingHours,
  OrderRoutingResult,
  RoutingConfig,
  DEFAULT_ROUTING_CONFIG,
  BranchCapacityStatus,
} from './types';

/**
 * In-memory capacity tracking (placeholder for real capacity tracking)
 * In production, this would be backed by a database or real-time service
 */
const branchCapacityCache: Map<string, {
  status: BranchCapacityStatus;
  activeOrders: number;
  lastUpdated: number;
}> = new Map();

/**
 * Nigerian landline area codes mapping
 * Maps area codes to city/state information
 */
const NIGERIAN_LANDLINE_AREA_CODES: NigerianAreaCodeMapping[] = [
  // Lagos
  { areaCode: '01', city: 'Lagos', state: 'Lagos' },
  
  // Abuja (FCT)
  { areaCode: '09', city: 'Abuja', state: 'FCT' },
  
  // Port Harcourt (Rivers)
  { areaCode: '084', city: 'Port Harcourt', state: 'Rivers' },
  
  // Kano
  { areaCode: '064', city: 'Kano', state: 'Kano' },
  
  // Ibadan (Oyo)
  { areaCode: '02', city: 'Ibadan', state: 'Oyo' },
  
  // Kaduna
  { areaCode: '062', city: 'Kaduna', state: 'Kaduna' },
  
  // Enugu
  { areaCode: '042', city: 'Enugu', state: 'Enugu' },
  
  // Benin City (Edo)
  { areaCode: '052', city: 'Benin City', state: 'Edo' },
  
  // Warri (Delta)
  { areaCode: '053', city: 'Warri', state: 'Delta' },
  
  // Onitsha (Anambra)
  { areaCode: '046', city: 'Onitsha', state: 'Anambra' },
  
  // Owerri (Imo)
  { areaCode: '083', city: 'Owerri', state: 'Imo' },
  
  // Ilorin (Kwara)
  { areaCode: '031', city: 'Ilorin', state: 'Kwara' },
  
  // Calabar (Cross River)
  { areaCode: '087', city: 'Calabar', state: 'Cross River' },
  
  // Uyo (Akwa Ibom)
  { areaCode: '085', city: 'Uyo', state: 'Akwa Ibom' },
  
  // Jos (Plateau)
  { areaCode: '073', city: 'Jos', state: 'Plateau' },
  
  // Makurdi (Benue)
  { areaCode: '044', city: 'Makurdi', state: 'Benue' },
  
  // Minna (Niger)
  { areaCode: '066', city: 'Minna', state: 'Niger' },
  
  // Bauchi
  { areaCode: '077', city: 'Bauchi', state: 'Bauchi' },
  
  // Maiduguri (Borno)
  { areaCode: '076', city: 'Maiduguri', state: 'Borno' },
  
  // Yola (Adamawa)
  { areaCode: '075', city: 'Yola', state: 'Adamawa' },
  
  // Sokoto
  { areaCode: '060', city: 'Sokoto', state: 'Sokoto' },
  
  // Abeokuta (Ogun)
  { areaCode: '039', city: 'Abeokuta', state: 'Ogun' },
  
  // Akure (Ondo)
  { areaCode: '034', city: 'Akure', state: 'Ondo' },
  
  // Ado-Ekiti (Ekiti)
  { areaCode: '030', city: 'Ado-Ekiti', state: 'Ekiti' },
  
  // Osogbo (Osun)
  { areaCode: '035', city: 'Osogbo', state: 'Osun' },
  
  // Aba (Abia)
  { areaCode: '082', city: 'Aba', state: 'Abia' },
  
  // Abakaliki (Ebonyi)
  { areaCode: '043', city: 'Abakaliki', state: 'Ebonyi' },
  
  // Yenagoa (Bayelsa)
  { areaCode: '089', city: 'Yenagoa', state: 'Bayelsa' },
];

/**
 * Nigerian mobile network prefixes mapping
 * Maps mobile prefixes to regions (less precise than landline)
 * 
 * Note: Mobile prefixes are less reliable for location as users
 * can register numbers in different states. We use these as
 * fallback with lower confidence.
 */
const NIGERIAN_MOBILE_PREFIXES: Record<string, { region: string; state: string }> = {
  // MTN prefixes - historically associated with Lagos/South-West
  '0803': { region: 'South-West', state: 'Lagos' },
  '0806': { region: 'South-West', state: 'Lagos' },
  '0813': { region: 'South-West', state: 'Lagos' },
  '0816': { region: 'South-West', state: 'Lagos' },
  '0703': { region: 'South-West', state: 'Lagos' },
  '0706': { region: 'South-West', state: 'Lagos' },
  '0903': { region: 'South-West', state: 'Lagos' },
  '0906': { region: 'South-West', state: 'Lagos' },
  
  // Airtel prefixes
  '0802': { region: 'South-West', state: 'Lagos' },
  '0808': { region: 'South-West', state: 'Lagos' },
  '0812': { region: 'South-West', state: 'Lagos' },
  '0701': { region: 'South-West', state: 'Lagos' },
  '0902': { region: 'South-West', state: 'Lagos' },
  '0907': { region: 'South-West', state: 'Lagos' },
  
  // Glo prefixes
  '0805': { region: 'South-West', state: 'Lagos' },
  '0807': { region: 'South-West', state: 'Lagos' },
  '0811': { region: 'South-West', state: 'Lagos' },
  '0815': { region: 'South-West', state: 'Lagos' },
  '0705': { region: 'South-West', state: 'Lagos' },
  '0905': { region: 'South-West', state: 'Lagos' },
  
  // 9mobile prefixes
  '0809': { region: 'South-West', state: 'Lagos' },
  '0817': { region: 'South-West', state: 'Lagos' },
  '0818': { region: 'South-West', state: 'Lagos' },
  '0909': { region: 'South-West', state: 'Lagos' },
  '0908': { region: 'South-West', state: 'Lagos' },
};

/**
 * Order Routing Service
 * 
 * Handles routing orders to the appropriate branch based on
 * customer location derived from phone numbers.
 * 
 * Requirements: 27.1, 27.2, 27.3, 27.4, 27.5
 */
export class OrderRoutingService {
  /**
   * Get branch capacity status
   * 
   * Placeholder for real capacity tracking. In production, this would
   * query a database or real-time service for actual order load.
   * 
   * Requirements: 27.4
   * 
   * @param branchId - Branch ID to check capacity for
   * @returns Capacity status and active order count
   */
  static getBranchCapacity(branchId: string): {
    status: BranchCapacityStatus;
    activeOrders: number;
  } {
    const cached = branchCapacityCache.get(branchId);
    
    // If we have recent cached data (within 5 minutes), use it
    if (cached && Date.now() - cached.lastUpdated < 5 * 60 * 1000) {
      return {
        status: cached.status,
        activeOrders: cached.activeOrders,
      };
    }
    
    // Default to available if no data
    return {
      status: 'available',
      activeOrders: 0,
    };
  }

  /**
   * Update branch capacity status
   * 
   * Called when orders are placed or completed to update capacity tracking.
   * 
   * @param branchId - Branch ID to update
   * @param activeOrders - Current number of active orders
   * @param maxCapacity - Maximum order capacity (default: 50)
   */
  static updateBranchCapacity(
    branchId: string,
    activeOrders: number,
    maxCapacity: number = 50
  ): void {
    let status: BranchCapacityStatus;
    
    if (activeOrders >= maxCapacity) {
      status = 'at_capacity';
    } else if (activeOrders >= maxCapacity * 0.8) {
      status = 'busy';
    } else {
      status = 'available';
    }
    
    branchCapacityCache.set(branchId, {
      status,
      activeOrders,
      lastUpdated: Date.now(),
    });
  }

  /**
   * Clear branch capacity cache (for testing)
   */
  static clearCapacityCache(): void {
    branchCapacityCache.clear();
  }

  /**
   * Get alternative branches for a restaurant, excluding a specific branch
   * 
   * Requirements: 27.5
   * 
   * @param branches - All branches for the restaurant
   * @param excludeBranchId - Branch ID to exclude from alternatives
   * @param customerLocation - Customer location for proximity sorting
   * @param currentTime - Current time for operating hours check
   * @param config - Routing configuration
   * @returns List of alternative branches sorted by suitability
   */
  static getAlternativeBranches(
    branches: BranchForRouting[],
    excludeBranchId: string,
    customerLocation: CustomerLocation | null,
    currentTime?: Date,
    config: RoutingConfig = DEFAULT_ROUTING_CONFIG
  ): AlternativeBranch[] {
    // Filter out the excluded branch and inactive branches
    const availableBranches = branches.filter(
      b => b.branchId !== excludeBranchId && b.isActive
    );

    if (availableBranches.length === 0) {
      return [];
    }

    // Get availability info for each branch
    const branchesWithInfo = availableBranches.map(branch => {
      const availability = this.getBranchAvailability(branch, currentTime);
      const proximity = this.calculateProximity(
        customerLocation,
        this.extractLocationFromAddress(branch.address)
      );
      return { branch, availability, proximity };
    });

    // Sort alternatives by priority:
    // 1. Same city + open + available capacity
    // 2. Same city + open + busy
    // 3. Same state + open + available capacity
    // 4. Same state + open + busy
    // 5. Any open branch
    // 6. Closed branch (with warning)
    const sorted = branchesWithInfo.sort((a, b) => {
      // Priority score calculation
      const getScore = (item: typeof a): number => {
        let score = 0;
        
        // Proximity scoring (lower is better)
        if (item.proximity === 'same_city') score += 0;
        else if (item.proximity === 'same_state') score += 100;
        else score += 200;
        
        // Open status (open is better)
        if (!item.availability.isOpen) score += 1000;
        
        // Capacity status (available is better)
        if (item.availability.capacityStatus === 'available') score += 0;
        else if (item.availability.capacityStatus === 'busy') score += 10;
        else score += 50; // at_capacity
        
        return score;
      };
      
      return getScore(a) - getScore(b);
    });

    // Convert to AlternativeBranch format
    return sorted.slice(0, config.maxAlternatives).map(({ branch, availability, proximity }) => ({
      branchId: branch.branchId,
      branchName: branch.name,
      address: branch.address,
      proximity,
      isOpen: availability.isOpen,
      capacityStatus: availability.capacityStatus,
    }));
  }
  /**
   * Normalize a Nigerian phone number to a standard format
   * Handles various input formats:
   * - +234XXXXXXXXXX
   * - 234XXXXXXXXXX
   * - 0XXXXXXXXXX
   * - XXXXXXXXXX
   */
  static normalizePhoneNumber(phoneNumber: string): string {
    // Remove all non-digit characters
    let normalized = phoneNumber.replace(/\D/g, '');
    
    // Handle +234 prefix
    if (normalized.startsWith('234')) {
      normalized = '0' + normalized.substring(3);
    }
    
    // Ensure it starts with 0
    if (!normalized.startsWith('0') && normalized.length === 10) {
      normalized = '0' + normalized;
    }
    
    return normalized;
  }

  /**
   * Determine customer location from phone number area code
   * 
   * Requirements: 27.1
   * 
   * @param phoneNumber - Customer's phone number
   * @returns CustomerLocation with city, state, and confidence level
   */
  static determineCustomerLocation(phoneNumber: string): CustomerLocation | null {
    const normalized = this.normalizePhoneNumber(phoneNumber);
    
    if (!normalized || normalized.length < 4) {
      return null;
    }

    // Try landline area codes first (higher confidence)
    // Check 3-digit area codes first (e.g., 084, 064)
    const threeDigitCode = normalized.substring(0, 3);
    const landlineMatch3 = NIGERIAN_LANDLINE_AREA_CODES.find(
      mapping => mapping.areaCode === threeDigitCode
    );
    
    if (landlineMatch3) {
      return {
        city: landlineMatch3.city,
        state: landlineMatch3.state,
        areaCode: landlineMatch3.areaCode,
        confidence: 'high',
      };
    }

    // Check 2-digit area codes (e.g., 01, 02, 09)
    const twoDigitCode = normalized.substring(0, 2);
    const landlineMatch2 = NIGERIAN_LANDLINE_AREA_CODES.find(
      mapping => mapping.areaCode === twoDigitCode
    );
    
    if (landlineMatch2) {
      return {
        city: landlineMatch2.city,
        state: landlineMatch2.state,
        areaCode: landlineMatch2.areaCode,
        confidence: 'high',
      };
    }

    // Try mobile prefixes (lower confidence - users can register anywhere)
    const mobilePrefix = normalized.substring(0, 4);
    const mobileMatch = NIGERIAN_MOBILE_PREFIXES[mobilePrefix];
    
    if (mobileMatch) {
      return {
        city: null, // Mobile prefixes don't reliably indicate city
        state: mobileMatch.state,
        areaCode: mobilePrefix,
        confidence: 'low', // Mobile numbers are not location-specific
      };
    }

    // Unable to determine location
    return {
      city: null,
      state: null,
      areaCode: normalized.substring(0, 4),
      confidence: 'low',
    };
  }

  /**
   * Extract city and state from a branch address
   * 
   * @param address - Branch address string
   * @returns Object with city and state, or nulls if not found
   */
  static extractLocationFromAddress(address: string): { city: string | null; state: string | null } {
    if (!address) {
      return { city: null, state: null };
    }

    const addressLower = address.toLowerCase();
    
    // Check for known Nigerian cities/states in the address
    for (const mapping of NIGERIAN_LANDLINE_AREA_CODES) {
      const cityLower = mapping.city.toLowerCase();
      const stateLower = mapping.state.toLowerCase();
      
      if (addressLower.includes(cityLower)) {
        return { city: mapping.city, state: mapping.state };
      }
      
      if (addressLower.includes(stateLower)) {
        return { city: null, state: mapping.state };
      }
    }

    // Check for common state name variations
    const statePatterns: Record<string, string> = {
      'lagos': 'Lagos',
      'abuja': 'FCT',
      'fct': 'FCT',
      'port harcourt': 'Rivers',
      'ph': 'Rivers',
      'kano': 'Kano',
      'ibadan': 'Oyo',
      'oyo': 'Oyo',
      'kaduna': 'Kaduna',
      'enugu': 'Enugu',
      'benin': 'Edo',
      'edo': 'Edo',
      'warri': 'Delta',
      'delta': 'Delta',
      'onitsha': 'Anambra',
      'anambra': 'Anambra',
      'owerri': 'Imo',
      'imo': 'Imo',
    };

    for (const [pattern, state] of Object.entries(statePatterns)) {
      if (addressLower.includes(pattern)) {
        // Try to find the city too
        const cityMatch = NIGERIAN_LANDLINE_AREA_CODES.find(
          m => m.state === state && addressLower.includes(m.city.toLowerCase())
        );
        return { 
          city: cityMatch?.city || null, 
          state 
        };
      }
    }

    return { city: null, state: null };
  }

  /**
   * Check if a branch is currently open based on operating hours
   * 
   * @param operatingHours - Branch operating hours
   * @param currentTime - Current time (optional, defaults to now)
   * @returns true if branch is open, false otherwise
   */
  static isBranchOpen(operatingHours: OperatingHours, currentTime?: Date): boolean {
    const now = currentTime || new Date();
    const days: (keyof OperatingHours)[] = [
      'sunday', 'monday', 'tuesday', 'wednesday', 
      'thursday', 'friday', 'saturday'
    ];
    
    const dayName = days[now.getDay()];
    const todayHours = operatingHours[dayName];
    
    if (!todayHours) {
      return false; // Closed on this day
    }

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    const [openHour, openMinute] = todayHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = todayHours.close.split(':').map(Number);
    
    const openTimeMinutes = openHour * 60 + openMinute;
    const closeTimeMinutes = closeHour * 60 + closeMinute;

    return currentTimeMinutes >= openTimeMinutes && currentTimeMinutes < closeTimeMinutes;
  }

  /**
   * Get branch availability information
   * 
   * Requirements: 27.3, 27.4
   * 
   * @param branch - Branch data
   * @param currentTime - Current time for checking if open
   * @returns BranchAvailability with location and status info
   */
  static getBranchAvailability(branch: BranchForRouting, currentTime?: Date): BranchAvailability {
    const { city, state } = this.extractLocationFromAddress(branch.address);
    const isOpen = this.isBranchOpen(branch.operatingHours, currentTime);
    const capacity = this.getBranchCapacity(branch.branchId);

    return {
      branchId: branch.branchId,
      branchName: branch.name,
      address: branch.address,
      isActive: branch.isActive,
      isOpen,
      capacityStatus: capacity.status,
      city,
      state,
    };
  }

  /**
   * Find the nearest active branch for a customer
   * 
   * Prioritizes branches in this order:
   * 1. Same city + open + available capacity
   * 2. Same city + open + busy
   * 3. Same state + open + available capacity
   * 4. Same state + open + busy
   * 5. Any open branch with available capacity
   * 6. Any open branch (busy)
   * 7. Closed branch (if allowClosedBranchFallback is true)
   * 
   * Requirements: 27.2, 27.3, 27.4, 27.5
   * 
   * @param branches - List of branches for the restaurant
   * @param customerLocation - Customer's location from phone number
   * @param currentTime - Current time for checking operating hours
   * @param config - Routing configuration
   * @returns Sorted list of branches by proximity and availability
   */
  static findNearestBranches(
    branches: BranchForRouting[],
    customerLocation: CustomerLocation | null,
    currentTime?: Date,
    config: RoutingConfig = DEFAULT_ROUTING_CONFIG
  ): { branch: BranchAvailability; proximity: 'same_city' | 'same_state' | 'different_state' }[] {
    const branchesWithAvailability = branches
      .filter(b => b.isActive)
      .map(branch => ({
        branch: this.getBranchAvailability(branch, currentTime),
        proximity: this.calculateProximity(
          customerLocation,
          this.extractLocationFromAddress(branch.address)
        ),
      }));

    // Filter based on config
    let filteredBranches = branchesWithAvailability;
    
    // If considering operating hours and not allowing closed branch fallback,
    // filter out closed branches (unless that would leave us with no options)
    if (config.considerOperatingHours && !config.allowClosedBranchFallback) {
      const openBranches = branchesWithAvailability.filter(b => b.branch.isOpen);
      if (openBranches.length > 0) {
        filteredBranches = openBranches;
      }
    }

    // If considering capacity and we have branches with available capacity,
    // prefer those (but don't exclude busy/at_capacity if they're the only options)
    if (config.considerCapacity) {
      const availableCapacityBranches = filteredBranches.filter(
        b => b.branch.capacityStatus === 'available' || b.branch.capacityStatus === 'busy'
      );
      // Only filter if we have branches that aren't at capacity
      if (availableCapacityBranches.length > 0) {
        // Keep all branches but they'll be sorted by capacity
      }
    }

    // Sort by priority:
    // 1. Same city + open + available capacity
    // 2. Same city + open + busy
    // 3. Same state + open + available capacity
    // 4. Same state + open + busy
    // 5. Any open branch with available capacity
    // 6. Any open branch (busy)
    // 7. Closed branch (with warning)
    return filteredBranches.sort((a, b) => {
      // Calculate priority score (lower is better)
      const getScore = (item: typeof a): number => {
        let score = 0;
        
        // Proximity scoring (lower is better)
        const proximityOrder = { same_city: 0, same_state: 100, different_state: 200 };
        score += proximityOrder[item.proximity];
        
        // Open status (open is much better)
        if (config.considerOperatingHours) {
          if (!item.branch.isOpen) {
            score += 10000; // Heavily penalize closed branches
          }
        }
        
        // Capacity status (available is better)
        if (config.considerCapacity) {
          const capacityOrder = { available: 0, busy: 10, at_capacity: 100 };
          score += capacityOrder[item.branch.capacityStatus];
        }
        
        return score;
      };
      
      return getScore(a) - getScore(b);
    });
  }

  /**
   * Calculate proximity between customer location and branch location
   */
  private static calculateProximity(
    customerLocation: CustomerLocation | null,
    branchLocation: { city: string | null; state: string | null }
  ): 'same_city' | 'same_state' | 'different_state' {
    if (!customerLocation || (!customerLocation.city && !customerLocation.state)) {
      return 'different_state';
    }

    // Check city match (highest priority)
    if (
      customerLocation.city && 
      branchLocation.city &&
      customerLocation.city.toLowerCase() === branchLocation.city.toLowerCase()
    ) {
      return 'same_city';
    }

    // Check state match
    if (
      customerLocation.state && 
      branchLocation.state &&
      customerLocation.state.toLowerCase() === branchLocation.state.toLowerCase()
    ) {
      return 'same_state';
    }

    return 'different_state';
  }

  /**
   * Route an order to the appropriate branch
   * 
   * Main routing method that combines location detection and branch selection.
   * Handles edge cases like all branches closed or at capacity.
   * 
   * Requirements: 27.1, 27.2, 27.3, 27.4, 27.5
   * 
   * @param restaurantId - Restaurant ID
   * @param phoneNumber - Customer's phone number
   * @param branches - List of branches for the restaurant
   * @param currentTime - Current time (optional)
   * @param config - Routing configuration (optional)
   * @returns OrderRoutingResult with routing decision
   */
  static routeOrder(
    restaurantId: string,
    phoneNumber: string,
    branches: BranchForRouting[],
    currentTime?: Date,
    config: RoutingConfig = DEFAULT_ROUTING_CONFIG
  ): OrderRoutingResult {
    // Filter to active branches only
    const activeBranches = branches.filter(b => b.isActive);

    if (activeBranches.length === 0) {
      return {
        success: false,
        decision: null,
        error: 'No active branches available for this restaurant',
      };
    }

    // Determine customer location from phone number
    const customerLocation = this.determineCustomerLocation(phoneNumber);

    // If only one active branch, route directly to it
    if (activeBranches.length === 1) {
      const branch = activeBranches[0];
      const availability = this.getBranchAvailability(branch, currentTime);
      
      // Check if the only branch is closed
      const warnings: string[] = [];
      if (!availability.isOpen) {
        warnings.push('Branch is currently closed');
      }
      if (availability.capacityStatus === 'at_capacity') {
        warnings.push('Branch is at capacity - expect delays');
      }
      
      return {
        success: true,
        decision: {
          selectedBranchId: branch.branchId,
          selectedBranchName: branch.name,
          reason: 'only_branch_available',
          alternatives: [],
          customerLocation,
          timestamp: Date.now(),
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };
    }

    // Find nearest branches sorted by proximity and availability
    const sortedBranches = this.findNearestBranches(
      activeBranches,
      customerLocation,
      currentTime,
      config
    );

    if (sortedBranches.length === 0) {
      // If no branches available and we have a default, use it
      if (config.defaultBranchId) {
        const defaultBranch = activeBranches.find(b => b.branchId === config.defaultBranchId);
        if (defaultBranch) {
          return {
            success: true,
            decision: {
              selectedBranchId: defaultBranch.branchId,
              selectedBranchName: defaultBranch.name,
              reason: 'fallback_any_active',
              alternatives: [],
              customerLocation,
              timestamp: Date.now(),
            },
          };
        }
      }
      
      return {
        success: false,
        decision: null,
        error: 'No branches available',
      };
    }

    // Select the best branch (first in sorted list)
    const selectedBranch = sortedBranches[0];
    
    // Check for edge cases and generate warnings
    const warnings: string[] = [];
    
    // Check if all branches are closed
    const allBranchesClosed = sortedBranches.every(b => !b.branch.isOpen);
    if (allBranchesClosed) {
      warnings.push('All branches are currently closed');
    } else if (!selectedBranch.branch.isOpen) {
      warnings.push('Selected branch is closed - consider alternatives');
    }
    
    // Check if all branches are at capacity
    const allAtCapacity = sortedBranches.every(b => b.branch.capacityStatus === 'at_capacity');
    if (allAtCapacity) {
      warnings.push('All branches are at capacity - expect delays');
    } else if (selectedBranch.branch.capacityStatus === 'at_capacity') {
      warnings.push('Selected branch is at capacity - consider alternatives');
    } else if (selectedBranch.branch.capacityStatus === 'busy') {
      warnings.push('Selected branch is busy - may experience delays');
    }
    
    // Determine routing reason
    let reason: RoutingReason;
    if (selectedBranch.proximity === 'same_city') {
      reason = 'same_city';
    } else if (selectedBranch.proximity === 'same_state') {
      reason = 'same_state';
    } else if (customerLocation && (customerLocation.city || customerLocation.state)) {
      reason = 'nearest_branch';
    } else {
      reason = 'fallback_any_active';
    }

    // Build alternatives list using the new method
    const alternatives = this.getAlternativeBranches(
      activeBranches,
      selectedBranch.branch.branchId,
      customerLocation,
      currentTime,
      config
    );

    return {
      success: true,
      decision: {
        selectedBranchId: selectedBranch.branch.branchId,
        selectedBranchName: selectedBranch.branch.branchName,
        reason,
        alternatives,
        customerLocation,
        timestamp: Date.now(),
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  }

  /**
   * Get all Nigerian area codes for reference
   */
  static getNigerianAreaCodes(): NigerianAreaCodeMapping[] {
    return [...NIGERIAN_LANDLINE_AREA_CODES];
  }

  /**
   * Get all supported mobile prefixes
   */
  static getMobilePrefixes(): string[] {
    return Object.keys(NIGERIAN_MOBILE_PREFIXES);
  }
}

export default OrderRoutingService;
