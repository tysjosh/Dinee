/**
 * Tenant Module - Multi-tenant access control and query filtering
 * 
 * This module provides utilities for implementing tenant isolation
 * and role-based access control in the multi-tenant architecture.
 * 
 * @module tenant
 */

export {
  // Main class
  TenantGuard,
  
  // Error classes
  TenantAccessError,
  
  // Factory functions
  createTenantGuard,
  createTenantGuardForRole,
  
  // Standalone utility functions
  roleCanAccess,
  getAccessibleResources,
  isValidTenantScope,
  
  // Types
  type TenantResource,
  type AccessCheckResult,
  type TenantFilter,
  type TenantFilterable,
} from './TenantGuard';
