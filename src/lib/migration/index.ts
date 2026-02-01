/**
 * Migration Module
 * 
 * Exports migration utilities for backward compatibility.
 * Requirements: 28.1, 28.2, 28.7, 28.8
 */

export * from './types';
export * from './MigrationService';
export * from './RollbackService';
export * from './NotificationService';
export { MigrationService, DEFAULT_PLATFORM_ID, DEFAULT_PLATFORM_CONFIG, DEFAULT_BRANCH_CONFIG } from './MigrationService';
export { RollbackService, ROLLBACK_WINDOW_MS } from './RollbackService';
export { NotificationService, NOTIFICATION_TEMPLATES } from './NotificationService';
