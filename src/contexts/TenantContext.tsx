"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  ReactNode,
  useEffect,
  useCallback,
} from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Doc } from "../../convex/_generated/dataModel";

// ============================================================================
// Types
// ============================================================================

/**
 * User roles in the multi-tenant hierarchy
 * - platform_admin: Full access to all restaurants and branches
 * - restaurant_owner: Access to their restaurant and all its branches
 * - branch_manager: Access to their assigned branch only
 * - supervisor: Read-only access to orders and calls within their branch
 */
export type UserRole = 'platform_admin' | 'restaurant_owner' | 'branch_manager' | 'supervisor';

/**
 * Resource action types for permission checking
 */
export type ResourceAction = 'create' | 'read' | 'update' | 'delete';

/**
 * Permission definition for role-based access control
 */
export interface Permission {
  resource: string;
  actions: ResourceAction[];
}

/**
 * Platform settings for multi-tenant configuration
 */
export interface PlatformSettings {
  defaultLanguage: 'english' | 'nigerian_english' | 'pidgin' | 'spanish' | 'french';
  enabledPaymentMethods: ('paystack' | 'flutterwave' | 'cod')[];
  whatsappEnabled: boolean;
  smsEnabled: boolean;
}

/**
 * Platform entity - top level of tenant hierarchy
 */
export interface Platform {
  platformId: string;
  name: string;
  settings: PlatformSettings;
  createdAt: number;
}

/**
 * Branch entity - physical location of a restaurant
 */
export interface Branch {
  branchId: string;
  restaurantId: string;
  name: string;
  address: string;
  phoneNumber: string;
  operatingHours: {
    monday?: { open: string; close: string };
    tuesday?: { open: string; close: string };
    wednesday?: { open: string; close: string };
    thursday?: { open: string; close: string };
    friday?: { open: string; close: string };
    saturday?: { open: string; close: string };
    sunday?: { open: string; close: string };
  };
  isActive: boolean;
  createdAt: number;
}

/**
 * Tenant context for data filtering and access control
 */
export interface TenantScope {
  platformId: string;
  restaurantId?: string;
  branchId?: string;
  role: UserRole;
}

/**
 * Tenant state managed by the context
 */
export interface TenantState {
  platform: Platform | null;
  restaurant: Doc<"restaurants"> | null;
  branch: Branch | null;
  userRole: UserRole;
  permissions: Permission[];
  tenantScope: TenantScope | null;
  isLoading: boolean;
  error: string | null;
}

// ============================================================================
// Role Permission Matrix
// ============================================================================

/**
 * Role permission matrix defining what each role can do
 * - platform_admin: Full access to everything (wildcard *)
 * - restaurant_owner: Manage their restaurant and branches
 * - branch_manager: Manage their branch operations
 * - supervisor: Read-only access to orders and calls
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  platform_admin: [
    { resource: '*', actions: ['create', 'read', 'update', 'delete'] }
  ],
  restaurant_owner: [
    { resource: 'restaurant', actions: ['read', 'update'] },
    { resource: 'branch', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'menu', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'order', actions: ['read', 'update'] },
    { resource: 'call', actions: ['read'] },
    { resource: 'analytics', actions: ['read'] }
  ],
  branch_manager: [
    { resource: 'branch', actions: ['read', 'update'] },
    { resource: 'menu', actions: ['read', 'update'] },
    { resource: 'order', actions: ['read', 'update'] },
    { resource: 'call', actions: ['read'] }
  ],
  supervisor: [
    { resource: 'order', actions: ['read'] },
    { resource: 'call', actions: ['read'] }
  ]
};

// ============================================================================
// Reducer
// ============================================================================

type TenantAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_PLATFORM'; payload: Platform | null }
  | { type: 'SET_RESTAURANT'; payload: Doc<"restaurants"> | null }
  | { type: 'SET_BRANCH'; payload: Branch | null }
  | { type: 'SET_USER_ROLE'; payload: UserRole }
  | { type: 'SET_TENANT_SCOPE'; payload: TenantScope | null }
  | { type: 'RESET' };

const initialState: TenantState = {
  platform: null,
  restaurant: null,
  branch: null,
  userRole: 'supervisor', // Default to most restrictive role
  permissions: ROLE_PERMISSIONS['supervisor'],
  tenantScope: null,
  isLoading: true,
  error: null,
};

function tenantReducer(state: TenantState, action: TenantAction): TenantState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };

    case 'SET_PLATFORM':
      return { ...state, platform: action.payload };

    case 'SET_RESTAURANT':
      return { ...state, restaurant: action.payload };

    case 'SET_BRANCH':
      return { ...state, branch: action.payload };

    case 'SET_USER_ROLE':
      return {
        ...state,
        userRole: action.payload,
        permissions: ROLE_PERMISSIONS[action.payload],
      };

    case 'SET_TENANT_SCOPE':
      return { ...state, tenantScope: action.payload, isLoading: false };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ============================================================================
// Context
// ============================================================================

interface TenantContextType {
  state: TenantState;
  actions: {
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setPlatform: (platform: Platform | null) => void;
    setRestaurant: (restaurant: Doc<"restaurants"> | null) => void;
    setBranch: (branch: Branch | null) => void;
    setUserRole: (role: UserRole) => void;
    setTenantScope: (scope: TenantScope | null) => void;
    reset: () => void;
    // Permission checking utilities
    hasPermission: (resource: string, action: ResourceAction) => boolean;
    canAccessResource: (resource: string, action: ResourceAction) => boolean;
    // Tenant scope resolution
    resolveTenantScope: (userId?: string, role?: UserRole, tenantId?: string) => TenantScope | null;
    // Data filtering helpers
    getTenantFilter: () => { platformId?: string; restaurantId?: string; branchId?: string };
  };
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface TenantProviderProps {
  children: ReactNode;
  // Optional initial values for testing or SSR
  initialPlatformId?: string;
  initialRestaurantId?: string;
  initialBranchId?: string;
  initialRole?: UserRole;
}

export function TenantProvider({
  children,
  initialPlatformId,
  initialRestaurantId,
  initialBranchId,
  initialRole = 'supervisor',
}: TenantProviderProps) {
  const [state, dispatch] = useReducer(tenantReducer, {
    ...initialState,
    userRole: initialRole,
    permissions: ROLE_PERMISSIONS[initialRole],
  });

  // Fetch platform data if platformId is provided
  const platformData = useQuery(
    api.platforms.getPlatform,
    initialPlatformId ? { platformId: initialPlatformId } : "skip"
  );

  // Fetch restaurant data if restaurantId is provided
  const restaurantData = useQuery(
    api.restaurants.getRestaurant,
    initialRestaurantId ? { restaurantId: initialRestaurantId } : "skip"
  );

  // Fetch branch data if branchId is provided
  const branchData = useQuery(
    api.branches.getBranch,
    initialBranchId ? { branchId: initialBranchId } : "skip"
  );

  // Update state when platform data changes
  useEffect(() => {
    if (platformData) {
      const platform: Platform = {
        platformId: platformData.platformId,
        name: platformData.name,
        settings: platformData.settings,
        createdAt: platformData.createdAt,
      };
      dispatch({ type: 'SET_PLATFORM', payload: platform });
    }
  }, [platformData]);

  // Update state when restaurant data changes
  useEffect(() => {
    if (restaurantData) {
      dispatch({ type: 'SET_RESTAURANT', payload: restaurantData });
    }
  }, [restaurantData]);

  // Update state when branch data changes
  useEffect(() => {
    if (branchData) {
      const branch: Branch = {
        branchId: branchData.branchId,
        restaurantId: branchData.restaurantId,
        name: branchData.name,
        address: branchData.address,
        phoneNumber: branchData.phoneNumber,
        operatingHours: branchData.operatingHours,
        isActive: branchData.isActive,
        createdAt: branchData.createdAt,
      };
      dispatch({ type: 'SET_BRANCH', payload: branch });
    }
  }, [branchData]);

  // Resolve tenant scope when data is loaded
  useEffect(() => {
    const { platform, restaurant, branch, userRole } = state;
    
    // Build tenant scope based on available data and user role
    let scope: TenantScope | null = null;

    if (platform) {
      scope = {
        platformId: platform.platformId,
        role: userRole,
      };

      // Add restaurant scope for restaurant_owner and below
      if (restaurant && userRole !== 'platform_admin') {
        scope.restaurantId = restaurant.restaurantId;
      }

      // Add branch scope for branch_manager and supervisor
      if (branch && (userRole === 'branch_manager' || userRole === 'supervisor')) {
        scope.branchId = branch.branchId;
      }
    }

    dispatch({ type: 'SET_TENANT_SCOPE', payload: scope });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.platform, state.restaurant, state.branch, state.userRole]);

  /**
   * Check if the current user has permission for a specific action on a resource
   */
  const hasPermission = useCallback((resource: string, action: ResourceAction): boolean => {
    const { permissions } = state;
    
    return permissions.some(permission => {
      // Wildcard permission grants access to everything
      if (permission.resource === '*') {
        return permission.actions.includes(action);
      }
      // Check specific resource permission
      return permission.resource === resource && permission.actions.includes(action);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.permissions]);

  /**
   * Check if user can access a resource with a specific action
   * This combines permission check with tenant scope validation
   */
  const canAccessResource = useCallback((resource: string, action: ResourceAction): boolean => {
    // First check if user has the permission
    if (!hasPermission(resource, action)) {
      return false;
    }

    // For platform_admin, no additional scope check needed
    if (state.userRole === 'platform_admin') {
      return true;
    }

    // For other roles, ensure tenant scope is set
    return state.tenantScope !== null;
  }, [hasPermission, state.userRole, state.tenantScope]);

  /**
   * Resolve tenant scope based on user role and tenant assignment
   * This is used to determine what data the user can access
   */
  const resolveTenantScope = useCallback((
    userId?: string,
    role?: UserRole,
    tenantId?: string
  ): TenantScope | null => {
    const effectiveRole = role || state.userRole;
    const { platform, restaurant, branch } = state;

    // Platform admin has access to everything
    if (effectiveRole === 'platform_admin' && platform) {
      return {
        platformId: platform.platformId,
        role: effectiveRole,
      };
    }

    // Restaurant owner has access to their restaurant and all branches
    if (effectiveRole === 'restaurant_owner' && platform && restaurant) {
      return {
        platformId: platform.platformId,
        restaurantId: restaurant.restaurantId,
        role: effectiveRole,
      };
    }

    // Branch manager has access to their specific branch
    if (effectiveRole === 'branch_manager' && platform && restaurant && branch) {
      return {
        platformId: platform.platformId,
        restaurantId: restaurant.restaurantId,
        branchId: branch.branchId,
        role: effectiveRole,
      };
    }

    // Supervisor has read-only access to their branch
    if (effectiveRole === 'supervisor' && platform && restaurant && branch) {
      return {
        platformId: platform.platformId,
        restaurantId: restaurant.restaurantId,
        branchId: branch.branchId,
        role: effectiveRole,
      };
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.userRole, state.platform, state.restaurant, state.branch]);

  /**
   * Get tenant filter for data queries
   * Returns the appropriate filter based on user role and tenant scope
   */
  const getTenantFilter = useCallback((): { 
    platformId?: string; 
    restaurantId?: string; 
    branchId?: string 
  } => {
    const { tenantScope, userRole } = state;

    if (!tenantScope) {
      return {};
    }

    // Platform admin can see all data within the platform
    if (userRole === 'platform_admin') {
      return { platformId: tenantScope.platformId };
    }

    // Restaurant owner can see all data within their restaurant
    if (userRole === 'restaurant_owner') {
      return {
        platformId: tenantScope.platformId,
        restaurantId: tenantScope.restaurantId,
      };
    }

    // Branch manager and supervisor can only see their branch data
    if (userRole === 'branch_manager' || userRole === 'supervisor') {
      return {
        platformId: tenantScope.platformId,
        restaurantId: tenantScope.restaurantId,
        branchId: tenantScope.branchId,
      };
    }

    return {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tenantScope, state.userRole]);

  const actions = {
    setLoading: (loading: boolean) =>
      dispatch({ type: 'SET_LOADING', payload: loading }),
    setError: (error: string | null) =>
      dispatch({ type: 'SET_ERROR', payload: error }),
    setPlatform: (platform: Platform | null) =>
      dispatch({ type: 'SET_PLATFORM', payload: platform }),
    setRestaurant: (restaurant: Doc<"restaurants"> | null) =>
      dispatch({ type: 'SET_RESTAURANT', payload: restaurant }),
    setBranch: (branch: Branch | null) =>
      dispatch({ type: 'SET_BRANCH', payload: branch }),
    setUserRole: (role: UserRole) =>
      dispatch({ type: 'SET_USER_ROLE', payload: role }),
    setTenantScope: (scope: TenantScope | null) =>
      dispatch({ type: 'SET_TENANT_SCOPE', payload: scope }),
    reset: () => dispatch({ type: 'RESET' }),
    hasPermission,
    canAccessResource,
    resolveTenantScope,
    getTenantFilter,
  };

  return (
    <TenantContext.Provider value={{ state, actions }}>
      {children}
    </TenantContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access tenant context
 * Must be used within a TenantProvider
 */
export function useTenant() {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return context;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get permissions for a specific role
 */
export function getPermissionsForRole(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role];
}

/**
 * Check if a role has a specific permission
 */
export function roleHasPermission(
  role: UserRole,
  resource: string,
  action: ResourceAction
): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.some(permission => {
    if (permission.resource === '*') {
      return permission.actions.includes(action);
    }
    return permission.resource === resource && permission.actions.includes(action);
  });
}

/**
 * Get the tenant type for a role
 */
export function getTenantTypeForRole(role: UserRole): 'platform' | 'restaurant' | 'branch' {
  switch (role) {
    case 'platform_admin':
      return 'platform';
    case 'restaurant_owner':
      return 'restaurant';
    case 'branch_manager':
    case 'supervisor':
      return 'branch';
    default:
      return 'branch';
  }
}
