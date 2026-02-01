/**
 * Notification Service
 * 
 * Client-side utilities for feature notifications.
 * Requirements: 28.8
 * 
 * Key features:
 * - Format notifications for display
 * - Filter notifications by type and priority
 * - Create standard notification templates
 */

import {
  FeatureNotification,
  NotificationScope,
  NotificationType,
  NotificationPriority,
  CreateNotificationResult,
} from './types';

/**
 * Standard notification templates for common scenarios
 */
export const NOTIFICATION_TEMPLATES = {
  // Migration notifications
  migrationComplete: {
    title: 'Migration Complete',
    message: 'Your restaurant has been successfully migrated to the new platform.',
    type: 'migration' as NotificationType,
    priority: 'high' as NotificationPriority,
    featureName: 'migration_complete',
  },
  rollbackAvailable: {
    title: 'Rollback Available',
    message: 'You can rollback to the previous version within 30 days if needed.',
    type: 'migration' as NotificationType,
    priority: 'medium' as NotificationPriority,
    featureName: 'migration_complete',
  },
  rollbackExpiring: {
    title: 'Rollback Window Expiring Soon',
    message: 'Your rollback window will expire in a few days. After that, migration changes will be permanent.',
    type: 'migration' as NotificationType,
    priority: 'high' as NotificationPriority,
    featureName: 'migration_complete',
  },

  // Feature notifications
  multiTenantEnabled: {
    title: 'Multi-Branch Support Available',
    message: 'You can now manage multiple branches from a single dashboard.',
    type: 'new_feature' as NotificationType,
    priority: 'medium' as NotificationPriority,
    featureName: 'multi_tenant_enabled',
  },
  paymentsEnabled: {
    title: 'New Payment Options',
    message: 'Paystack, Flutterwave, and Cash-on-Delivery are now available.',
    type: 'new_feature' as NotificationType,
    priority: 'medium' as NotificationPriority,
    featureName: 'paystack_enabled',
  },
  whatsappEnabled: {
    title: 'WhatsApp Notifications',
    message: 'Send order updates to customers via WhatsApp.',
    type: 'new_feature' as NotificationType,
    priority: 'low' as NotificationPriority,
    featureName: 'whatsapp_enabled',
  },
  nigerianLanguageSupport: {
    title: 'Nigerian Language Support',
    message: 'AI agent now supports Nigerian English and Pidgin.',
    type: 'new_feature' as NotificationType,
    priority: 'low' as NotificationPriority,
    featureName: 'nigerian_english_enabled',
  },
  deliveryTracking: {
    title: 'Delivery Tracking',
    message: 'Track delivery status and rider assignments in real-time.',
    type: 'new_feature' as NotificationType,
    priority: 'medium' as NotificationPriority,
    featureName: 'delivery_tracking_enabled',
  },
  analyticsEnabled: {
    title: 'Advanced Analytics',
    message: 'View order funnel analytics and agent performance metrics.',
    type: 'new_feature' as NotificationType,
    priority: 'low' as NotificationPriority,
    featureName: 'funnel_analytics_enabled',
  },
};

/**
 * Notification Service class
 * 
 * Provides client-side utilities for notification operations.
 * Actual database operations are performed by Convex mutations.
 */
export class NotificationService {
  /**
   * Filter notifications by type
   * @param notifications - List of notifications
   * @param type - Notification type to filter by
   * @returns Filtered notifications
   */
  static filterByType(
    notifications: FeatureNotification[],
    type: NotificationType
  ): FeatureNotification[] {
    return notifications.filter((n) => n.type === type);
  }

  /**
   * Filter notifications by priority
   * @param notifications - List of notifications
   * @param priority - Minimum priority level
   * @returns Filtered notifications
   */
  static filterByPriority(
    notifications: FeatureNotification[],
    priority: NotificationPriority
  ): FeatureNotification[] {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const minPriority = priorityOrder[priority];
    return notifications.filter((n) => priorityOrder[n.priority] <= minPriority);
  }

  /**
   * Sort notifications by priority and date
   * @param notifications - List of notifications
   * @returns Sorted notifications (high priority first, then newest)
   */
  static sortNotifications(notifications: FeatureNotification[]): FeatureNotification[] {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return [...notifications].sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.createdAt - a.createdAt;
    });
  }

  /**
   * Get notification icon based on type
   * @param type - Notification type
   * @returns Icon name for the notification
   */
  static getNotificationIcon(type: NotificationType): string {
    switch (type) {
      case 'new_feature':
        return 'sparkles';
      case 'migration':
        return 'arrow-path';
      case 'deprecation':
        return 'exclamation-triangle';
      case 'update':
        return 'arrow-up-circle';
      default:
        return 'bell';
    }
  }

  /**
   * Get notification color based on priority
   * @param priority - Notification priority
   * @returns Color class for the notification
   */
  static getNotificationColor(priority: NotificationPriority): string {
    switch (priority) {
      case 'high':
        return 'text-danger';
      case 'medium':
        return 'text-warning';
      case 'low':
        return 'text-primary';
      default:
        return 'text-gray-500';
    }
  }

  /**
   * Format notification for display
   * @param notification - Notification to format
   * @returns Formatted notification object
   */
  static formatForDisplay(notification: FeatureNotification): {
    id: string;
    title: string;
    message: string;
    icon: string;
    color: string;
    dismissible: boolean;
    actionUrl?: string;
    actionLabel?: string;
    timestamp: string;
  } {
    return {
      id: notification.notificationId,
      title: notification.title,
      message: notification.message,
      icon: this.getNotificationIcon(notification.type),
      color: this.getNotificationColor(notification.priority),
      dismissible: notification.dismissible,
      actionUrl: notification.actionUrl,
      actionLabel: notification.actionLabel,
      timestamp: new Date(notification.createdAt).toLocaleDateString(),
    };
  }

  /**
   * Check if notification is expired
   * @param notification - Notification to check
   * @returns true if notification is expired
   */
  static isExpired(notification: FeatureNotification): boolean {
    if (!notification.expiresAt) return false;
    return Date.now() > notification.expiresAt;
  }

  /**
   * Check if notification should be displayed
   * @param notification - Notification to check
   * @returns true if notification should be shown
   */
  static shouldDisplay(notification: FeatureNotification): boolean {
    if (!notification.isActive) return false;
    if (Date.now() < notification.startsAt) return false;
    if (notification.expiresAt && Date.now() > notification.expiresAt) return false;
    return true;
  }

  /**
   * Get template for a notification type
   * @param templateName - Name of the template
   * @returns Notification template or undefined
   */
  static getTemplate(templateName: keyof typeof NOTIFICATION_TEMPLATES): typeof NOTIFICATION_TEMPLATES[keyof typeof NOTIFICATION_TEMPLATES] | undefined {
    return NOTIFICATION_TEMPLATES[templateName];
  }

  /**
   * Create notification data from template
   * @param templateName - Name of the template
   * @param scope - Notification scope
   * @param scopeId - Scope ID (platformId, restaurantId, or branchId)
   * @returns Notification creation data
   */
  static createFromTemplate(
    templateName: keyof typeof NOTIFICATION_TEMPLATES,
    scope: NotificationScope = 'global',
    scopeId?: string
  ): {
    scope: NotificationScope;
    scopeId?: string;
    title: string;
    message: string;
    featureName: string;
    type: NotificationType;
    priority: NotificationPriority;
    dismissible: boolean;
  } | null {
    const template = NOTIFICATION_TEMPLATES[templateName];
    if (!template) return null;

    return {
      scope,
      scopeId,
      title: template.title,
      message: template.message,
      featureName: template.featureName,
      type: template.type,
      priority: template.priority,
      dismissible: true,
    };
  }

  /**
   * Get count of unread notifications by priority
   * @param notifications - List of notifications
   * @returns Count by priority
   */
  static getCountByPriority(notifications: FeatureNotification[]): {
    high: number;
    medium: number;
    low: number;
    total: number;
  } {
    const counts = { high: 0, medium: 0, low: 0, total: 0 };
    for (const n of notifications) {
      counts[n.priority]++;
      counts.total++;
    }
    return counts;
  }
}

export default NotificationService;
