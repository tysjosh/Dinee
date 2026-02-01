/**
 * TenantGuard - Utility for tenant-based access control and query filtering
 * 
 * This module implements the TenantGuard interface from the design document,
 * providing methods to check resource access permissions and filter queries
 * based on tenant context.
 * 
 * @module TenantGuard
 * @see Requirements: 2.3, 2.4, 2.5, 2.6, 2.7
 */

import {
  UserRole,
  ResourceAction,
  Permission,
  TenantScope,
  ROLE_PERMISSIONS,
} from '@/contexts/TenantContext';

// ============================================================================
// Types
// ============================================================================

/**
 * Resources that can be accessed in the multi-tenant system
 */
export type TenantResource = 
  | 'platform'
  | 'restaurant'
  | 'branch'
  | 'menu'
  | 'order'
  | 'call'
  | 'analytics'
  | 'user'
  | 'prompt'
  | 'webhook'
  | 'customer_preference';

/**
 * Result of an access check operation
 */
export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Query filter based on tenant scope
 */
export interface TenantFilter {
  platformId?: string;
  restaurantId?: string;
  branchId?: string;
}

/**
 * Interface for objects that can be filtered by tenant
 */
export interface TenantFilterable {
  platformId?: string;
  restaurantId?: string;
  branchId?: string;
}

// ============================================================================
// TenantGuard Class
// ============================================================================

/**
 * TenantGuard provides methods for checking resource access permissions
 * and filtering queries based on tenant context.
 * 
 * The guard implements the role permission matrix:
 * - platform_admin: Full access to all resources (wildcard *)
 * - restaurant_owner: Access to their restaurant and all its branches
 * - branch_manager: Access to their assigned branch only
 * - supervisor: Read-only access to orders and calls within their branch
 * 
 * @example
 * ```typescript
 * const guard = new TenantGuard(tenantContext);
 * 
 * // Check if user can update an order
 * if (guard.canAccess('order', 'update')) {
 *   // Perform update
 * }
 * 
 * // Filter a query to only return tenant-scoped data
 * const filteredQuery = guard.filterQuery(query, tenantContext);
 * ```
 */
export class TenantGuard {
  private tenantContext: TenantScope;
  private permissions: Permission[];

  /**
   * Creates a new TenantGuard instance
   * @param tenantContext - The tenant context containing role and scope information
   */
  constructor(tenantContext: TenantScope) {
    this.tenantContext = tenantContext;
    this.permissions = ROLE_PERMISSIONS[tenantContext.role];
  }

  // ==========================================================================
  // Permission Checking Methods
  // ==========================================================================

  /**
   * Check if the user can access a specific resource with a specific action
   * 
   * This method implements the role permission matrix from the design document:
   * - platform_admin: Has wildcard (*) access to all resources and actions
   * - restaurant_owner: Can manage restaurant, branches, menus; read orders/calls/analytics
   * - branch_manager: Can manage their branch and menu; read/update orders; read calls
   * - supervisor: Read-only access to orders and calls
   * 
   * @param resource - The resource type to check access for
   * @param action - The action to perform on the resource
   * @returns true if access is allowed, false otherwise
   * 
   * @example
   * ```typescript
   * const guard = new TenantGuard({ role: 'branch_manager', ... });
   * guard.canAccess('order', 'read');   // true
   * guard.canAccess('order', 'delete'); // false
   * guard.canAccess('branch', 'update'); // true
   * ```
   * 
   * @see Requirements 2.3, 2.4, 2.5, 2.6, 2.7
   */
  canAccess(resource: TenantResource, action: ResourceAction): boolean {
    return this.permissions.some(permission => {
      // Wildcard permission grants access to everything (platform_admin)
      // Requirement 2.3: platform_admin has access to all restaurants and branches
      if (permission.resource === '*') {
        return permission.actions.includes(action);
      }
      
      // Check specific resource permission
      return permission.resource === resource && permission.actions.includes(action);
    });
  }

  /**
   * Check access with detailed result including reason for denial
   * 
   * @param resource - The resource type to check access for
   * @param action - The action to perform on the resource
   * @returns AccessCheckResult with allowed status and optional reason
   * 
   * @example
   * ```typescript
   * const result = guard.canAccessWithReason('order', 'delete');
   * if (!result.allowed) {
   *   console.log(result.reason); // "Role 'supervisor' does not have 'delete' permission on 'order'"
   * }
   * ```
   */
  canAccessWithReason(resource: TenantResource, action: ResourceAction): AccessCheckResult {
    const allowed = this.canAccess(resource, action);
    
    if (allowed) {
      return { allowed: true };
    }

    // Provide detailed reason for denial
    const hasResourcePermission = this.permissions.some(p => 
      p.resource === resource || p.resource === '*'
    );

    if (!hasResourcePermission) {
      return {
        allowed: false,
        reason: `Role '${this.tenantContext.role}' does not have access to resource '${resource}'`,
      };
    }

    return {
      allowed: false,
      reason: `Role '${this.tenantContext.role}' does not have '${action}' permission on '${resource}'`,
    };
  }

  /**
   * Validate that a mutation can be performed before executing
   * This should be called before any data mutation operation.
   * 
   * @param resource - The resource being mutated
   * @param action - The mutation action (create, update, delete)
   * @throws Error if the mutation is not allowed
   * 
   * @see Requirement 2.7: Validate role permissions before executing any data mutation
   */
  validateMutation(resource: TenantResource, action: 'create' | 'update' | 'delete'): void {
    const result = this.canAccessWithReason(resource, action);
    
    if (!result.allowed) {
      throw new TenantAccessError(
        result.reason || 'Access denied',
        403,
        resource,
        action
      );
    }
  }

  // ==========================================================================
  // Query Filtering Methods
  // ==========================================================================

  /**
   * Filter a query to only return data within the user's tenant scope
   * 
   * This method applies tenant isolation by adding appropriate filters:
   * - platform_admin: Filter by platformId only (sees all restaurants/branches)
   * - restaurant_owner: Filter by platformId and restaurantId (sees all branches)
   * - branch_manager: Filter by platformId, restaurantId, and branchId
   * - supervisor: Filter by platformId, restaurantId, and branchId
   * 
   * @param query - The query object to filter (must have TenantFilterable properties)
   * @param tenantContext - The tenant context to use for filtering
   * @returns The filtered query with tenant scope applied
   * 
   * @example
   * ```typescript
   * const query = { status: 'active' };
   * const filtered = guard.filterQuery(query, tenantContext);
   * // Result for branch_manager: { status: 'active', platformId: '...', restaurantId: '...', branchId: '...' }
   * ```
   * 
   * @see Requirement 1.6: Enforce tenant isolation by filtering on appropriate tenantId
   */
  filterQuery<T extends Record<string, unknown>>(
    query: T,
    tenantContext: TenantScope
  ): T & TenantFilter {
    const filter = this.getTenantFilter(tenantContext);
    return { ...query, ...filter };
  }

  /**
   * Get the tenant filter based on user role and scope
   * 
   * @param tenantContext - Optional tenant context (uses instance context if not provided)
   * @returns TenantFilter object with appropriate scope fields
   */
  getTenantFilter(tenantContext?: TenantScope): TenantFilter {
    const context = tenantContext || this.tenantContext;
    const filter: TenantFilter = {};

    // Always include platformId for all roles
    filter.platformId = context.platformId;

    // Requirement 2.3: platform_admin has access to all restaurants and branches
    // Only filter by platformId
    if (context.role === 'platform_admin') {
      return filter;
    }

    // Requirement 2.4: restaurant_owner has access to their restaurant and its branches
    // Filter by platformId and restaurantId
    if (context.role === 'restaurant_owner') {
      if (context.restaurantId) {
        filter.restaurantId = context.restaurantId;
      }
      return filter;
    }

    // Requirement 2.5: branch_manager has access only to their assigned branch
    // Requirement 2.6: supervisor has read access to orders and calls within their branch
    // Filter by platformId, restaurantId, and branchId
    if (context.role === 'branch_manager' || context.role === 'supervisor') {
      if (context.restaurantId) {
        filter.restaurantId = context.restaurantId;
      }
      if (context.branchId) {
        filter.branchId = context.branchId;
      }
      return filter;
    }

    return filter;
  }

  /**
   * Check if a resource belongs to the user's tenant scope
   * 
   * @param resource - The resource to check (must have tenant fields)
   * @returns true if the resource is within the user's tenant scope
   */
  isWithinScope(resource: TenantFilterable): boolean {
    const { role, platformId, restaurantId, branchId } = this.tenantContext;

    // Platform admin can access anything within their platform
    if (role === 'platform_admin') {
      return resource.platformId === platformId || !resource.platformId;
    }

    // Restaurant owner can access their restaurant and all its branches
    if (role === 'restaurant_owner') {
      if (resource.platformId && resource.platformId !== platformId) {
        return false;
      }
      if (resource.restaurantId && resource.restaurantId !== restaurantId) {
        return false;
      }
      return true;
    }

    // Branch manager and supervisor can only access their specific branch
    if (role === 'branch_manager' || role === 'supervisor') {
      if (resource.platformId && resource.platformId !== platformId) {
        return false;
      }
      if (resource.restaurantId && resource.restaurantId !== restaurantId) {
        return false;
      }
      if (resource.branchId && resource.branchId !== branchId) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Filter an array of resources to only include those within tenant scope
   * 
   * @param resources - Array of resources to filter
   * @returns Filtered array containing only resources within tenant scope
   */
  filterResources<T extends TenantFilterable>(resources: T[]): T[] {
    return resources.filter(resource => this.isWithinScope(resource));
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get the current tenant context
   */
  getTenantContext(): TenantScope {
    return this.tenantContext;
  }

  /**
   * Get the current user's role
   */
  getRole(): UserRole {
    return this.tenantContext.role;
  }

  /**
   * Get all permissions for the current role
   */
  getPermissions(): Permission[] {
    return [...this.permissions];
  }

  /**
   * Check if the user has any permission on a resource
   */
  hasAnyPermission(resource: TenantResource): boolean {
    return this.permissions.some(permission => 
      permission.resource === '*' || permission.resource === resource
    );
  }

  /**
   * Get all allowed actions for a specific resource
   */
  getAllowedActions(resource: TenantResource): ResourceAction[] {
    const actions: Set<ResourceAction> = new Set();

    for (const permission of this.permissions) {
      if (permission.resource === '*' || permission.resource === resource) {
        permission.actions.forEach(action => actions.add(action));
      }
    }

    return Array.from(actions);
  }
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when tenant access is denied
 */
export class TenantAccessError extends Error {
  public readonly statusCode: number;
  public readonly resource: TenantResource;
  public readonly action: ResourceAction;

  constructor(
    message: string,
    statusCode: number = 403,
    resource: TenantResource,
    action: ResourceAction
  ) {
    super(message);
    this.name = 'TenantAccessError';
    this.statusCode = statusCode;
    this.resource = resource;
    this.action = action;
  }

  /**
   * Convert to API error response format
   */
  toResponse(): { error: string; message: string } {
    return {
      error: 'Forbidden',
      message: this.message,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a TenantGuard instance from a tenant scope
 * 
 * @param tenantScope - The tenant scope to create the guard for
 * @returns A new TenantGuard instance
 */
export function createTenantGuard(tenantScope: TenantScope): TenantGuard {
  return new TenantGuard(tenantScope);
}

/**
 * Create a TenantGuard for a specific role (useful for testing)
 * 
 * @param role - The user role
 * @param platformId - The platform ID
 * @param restaurantId - Optional restaurant ID
 * @param branchId - Optional branch ID
 * @returns A new TenantGuard instance
 */
export function createTenantGuardForRole(
  role: UserRole,
  platformId: string,
  restaurantId?: string,
  branchId?: string
): TenantGuard {
  return new TenantGuard({
    role,
    platformId,
    restaurantId,
    branchId,
  });
}

// ============================================================================
// Standalone Utility Functions
// ============================================================================

/**
 * Check if a role can access a resource with a specific action
 * Standalone function that doesn't require a TenantGuard instance
 * 
 * @param role - The user role to check
 * @param resource - The resource type
 * @param action - The action to perform
 * @returns true if access is allowed
 */
export function roleCanAccess(
  role: UserRole,
  resource: TenantResource,
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
 * Get all resources a role can access
 * 
 * @param role - The user role
 * @returns Array of resource names the role can access
 */
export function getAccessibleResources(role: UserRole): string[] {
  const permissions = ROLE_PERMISSIONS[role];
  const resources: Set<string> = new Set();

  for (const permission of permissions) {
    if (permission.resource === '*') {
      // Wildcard means all resources
      return ['*'];
    }
    resources.add(permission.resource);
  }

  return Array.from(resources);
}

/**
 * Validate that a tenant scope is properly configured for a role
 * 
 * @param scope - The tenant scope to validate
 * @returns true if the scope is valid for the role
 */
export function isValidTenantScope(scope: TenantScope): boolean {
  const { role, platformId, restaurantId, branchId } = scope;

  // All roles require platformId
  if (!platformId) {
    return false;
  }

  // platform_admin only needs platformId
  if (role === 'platform_admin') {
    return true;
  }

  // restaurant_owner needs restaurantId
  if (role === 'restaurant_owner') {
    return !!restaurantId;
  }

  // branch_manager and supervisor need both restaurantId and branchId
  if (role === 'branch_manager' || role === 'supervisor') {
    return !!restaurantId && !!branchId;
  }

  return false;
}
