/**
 * Enrollment Event Bus
 *
 * Central pub/sub system for enrollment change events. Emits and broadcasts
 * enrollment updates to all interested subscribers across the application.
 *
 * Validates: Requirements 3.1, 3.2, 9.2
 *
 * The event bus provides:
 * - Synchronous event delivery to all subscribers
 * - Multiple event types: enrollment-updated, enrollment-added, enrollment-removed
 * - Graceful error handling (catches listener errors, logs them)
 * - Memory efficient (proper cleanup of listeners)
 * - Optional subscribeOnce for one-time listeners
 * - Event emission logging for audit trail compliance (Requirement 9.2)
 */

import { logger } from '@/utils/logger';
import { AuditAction, writeAuditLog } from '@/lib/auditLog';

/**
 * Enrollment record type - subset of enrollment data
 * Contains the core fields needed for event broadcasting
 */
export interface Enrollment {
  id: string;
  trainee_id: string;
  program_id: string;
  status: 'enrolled' | 'active' | 'completed' | 'dropped' | 'failed';
  source: 'social_share' | 'direct' | 'admin_assigned';
  enrollment_date: string;
  completion_date: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Enrollment event types supported by the event bus
 */
export type EnrollmentEventType =
  | 'enrollment-updated'
  | 'enrollment-added'
  | 'enrollment-removed';

/**
 * Enrollment event emitted through the event bus
 *
 * Contains:
 * - type: the event type (updated, added, removed)
 * - enrollment: the enrollment data (or just enrollmentId for removed events)
 * - tenantId: tenant scope for data isolation
 * - timestamp: ISO 8601 timestamp when event was created
 * - userId: optional user ID of who triggered the change
 */
export interface EnrollmentEvent {
  type: EnrollmentEventType;
  enrollment?: Enrollment;
  enrollmentId?: string;
  tenantId: string;
  timestamp: string;
  userId?: string;
}

/**
 * Listener function type for enrollment events
 */
export type EnrollmentEventListener = (event: EnrollmentEvent) => void;

/**
 * Internal structure for managing once-off subscriptions
 */
interface OnceSubscription {
  listener: EnrollmentEventListener;
  unsubscribe: () => void;
}

/**
 * Enrollment Event Bus - Singleton pub/sub system
 *
 * Usage:
 *   const unsubscribe = enrollmentEventBus.subscribe('enrollment-updated', (event) => {
 *     console.log('Enrollment updated:', event.enrollment);
 *   });
 *
 *   // Later, unsubscribe
 *   unsubscribe();
 *
 *   // Or emit an event
 *   enrollmentEventBus.emit({
 *     type: 'enrollment-updated',
 *     enrollment: enrollmentData,
 *     tenantId: 'tenant-123',
 *     timestamp: new Date().toISOString(),
 *     userId: 'user-456'
 *   });
 */
class EnrollmentEventBus {
  /**
   * Map of event type -> array of listeners
   * Allows multiple listeners per event type
   */
  private listeners: Map<EnrollmentEventType, Set<EnrollmentEventListener>>;

  /**
   * Map of event type -> set of once-off subscriptions
   * Stores listeners that should only be called once
   */
  private onceSubscriptions: Map<EnrollmentEventType, Set<OnceSubscription>>;

  constructor() {
    this.listeners = new Map();
    this.onceSubscriptions = new Map();

    // Initialize empty sets for each event type
    const eventTypes: EnrollmentEventType[] = [
      'enrollment-updated',
      'enrollment-added',
      'enrollment-removed',
    ];

    eventTypes.forEach((type) => {
      this.listeners.set(type, new Set());
      this.onceSubscriptions.set(type, new Set());
    });
  }

  /**
   * Emit an enrollment event to all subscribers
   *
   * @param event - The enrollment event to broadcast
   *
   * Behavior:
   * - Logs event emission for audit trail (Requirement 9.2)
   * - Calls all regular subscribers for the event type synchronously
   * - Calls all once-off subscribers for the event type, then unsubscribes them
   * - Catches and logs any errors from listener functions (doesn't crash)
   */
  emit(event: EnrollmentEvent): void {
    const { type } = event;

    // Validate event type
    if (!this.listeners.has(type)) {
      logger.warn(`[EnrollmentEventBus] Attempted to emit unknown event type: ${type}`);
      return;
    }

    // Log event emission for audit trail (Requirement 9.2)
    // Include event type, enrollment_id, tenant_id, timestamp, user_id
    this.logEventEmission(event);

    // Call all regular listeners
    const listenerSet = this.listeners.get(type);
    if (listenerSet) {
      listenerSet.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          logger.error(
            `[EnrollmentEventBus] Error in listener for event type "${type}":`,
            error
          );
          // Don't rethrow - continue broadcasting to other subscribers
        }
      });
    }

    // Call all once-off listeners and remove them
    const onceSet = this.onceSubscriptions.get(type);
    if (onceSet) {
      onceSet.forEach((subscription) => {
        try {
          subscription.listener(event);
        } catch (error) {
          logger.error(
            `[EnrollmentEventBus] Error in once listener for event type "${type}":`,
            error
          );
          // Don't rethrow - continue broadcasting to other subscribers
        } finally {
          // Always unsubscribe after calling, even if there's an error
          subscription.unsubscribe();
        }
      });

      // Clear all once subscriptions for this event type
      onceSet.clear();
    }
  }

  /**
   * Log event emission to audit log
   * Requirement 9.2: Log all enrollment events emitted including type, enrollment_id, tenant_id, timestamp, user_id
   * Requirement 9.1: Mark enrollment changes from API vs WebSocket
   *
   * @param event - The enrollment event being emitted
   */
  private logEventEmission(event: EnrollmentEvent): void {
    try {
      // Fire-and-forget audit log write (doesn't await)
      const enrollmentId = event.enrollment?.id || event.enrollmentId;
      const actionMap: { [key in EnrollmentEventType]?: string } = {
        'enrollment-updated': AuditAction.DATA_UPDATE,
        'enrollment-added': AuditAction.DATA_CREATE,
        'enrollment-removed': AuditAction.DATA_DELETE,
      };

      writeAuditLog({
        tenantId: event.tenantId,
        userId: event.userId,
        action: actionMap[event.type] || 'enrollment.event_emitted',
        entityType: 'enrollment',
        entityId: enrollmentId,
        details: {
          eventType: event.type,
          eventTimestamp: event.timestamp,
          enrollmentStatus: event.enrollment?.status,
          traineeId: event.enrollment?.trainee_id,
          programId: event.enrollment?.program_id,
          // Track event source: 'api' (REST API) or 'websocket' (broadcast to WebSocket clients)
          eventSource: 'api', // API events are emitted from enrollment API routes
        },
      }).catch((err) => {
        // Silently fail - audit logging failures shouldn't break event flow
        logger.warn('[EnrollmentEventBus] Failed to write audit log for event emission', { err });
      });

      // Also log to console logger for real-time visibility
      logger.info('[EnrollmentEventBus] Event emitted', {
        eventType: event.type,
        enrollmentId,
        tenantId: event.tenantId,
        timestamp: event.timestamp,
        userId: event.userId,
        eventSource: 'api',
      });
    } catch (err) {
      // Silently fail - logging failures should never break event flow
      logger.warn('[EnrollmentEventBus] Error logging event emission', { err });
    }
  }

  /**
   * Subscribe to a specific event type
   *
   * @param eventType - The event type to listen for
   * @param listener - Function called when event is emitted
   * @returns Unsubscribe function - call to remove listener
   *
   * Features:
   * - Multiple listeners per event type supported
   * - Multiple event types per listener supported (call subscribe multiple times)
   * - Listener added to set (automatic deduplication if same function added twice)
   * - Unsubscribe function is idempotent (safe to call multiple times)
   */
  subscribe(
    eventType: EnrollmentEventType,
    listener: EnrollmentEventListener
  ): () => void {
    // Validate event type
    if (!this.listeners.has(eventType)) {
      logger.warn(
        `[EnrollmentEventBus] Attempted to subscribe to unknown event type: ${eventType}`
      );
      return () => {}; // Return no-op unsubscribe
    }

    const listenerSet = this.listeners.get(eventType)!;
    listenerSet.add(listener);

    // Return unsubscribe function
    return () => {
      listenerSet.delete(listener);
    };
  }

  /**
   * Subscribe to a specific event type with a one-time listener
   *
   * @param eventType - The event type to listen for
   * @param listener - Function called once when event is emitted
   * @returns Unsubscribe function - call to cancel subscription before first emit
   *
   * Features:
   * - Listener called only on next event of that type
   * - Automatically unsubscribes after first call
   * - If no event is emitted, listener never called
   * - Can call unsubscribe to cancel before event is emitted
   * - Unsubscribe is idempotent (safe to call multiple times)
   *
   * Use case:
   *   // Wait for next enrollment update
   *   const unsubscribe = enrollmentEventBus.subscribeOnce('enrollment-updated', (event) => {
   *     console.log('Got update:', event);
   *   });
   *
   *   // If we change our mind before the event fires
   *   unsubscribe();
   */
  subscribeOnce(
    eventType: EnrollmentEventType,
    listener: EnrollmentEventListener
  ): () => void {
    // Validate event type
    if (!this.listeners.has(eventType)) {
      logger.warn(
        `[EnrollmentEventBus] Attempted to subscribeOnce to unknown event type: ${eventType}`
      );
      return () => {}; // Return no-op unsubscribe
    }

    const onceSet = this.onceSubscriptions.get(eventType)!;

    // Create a subscription object
    const subscription: OnceSubscription = {
      listener,
      unsubscribe: () => {
        onceSet.delete(subscription);
      },
    };

    onceSet.add(subscription);

    // Return the unsubscribe function
    return subscription.unsubscribe;
  }

  /**
   * Get count of listeners for a specific event type (for testing/debugging)
   *
   * @param eventType - The event type to check
   * @returns Number of listeners currently subscribed
   */
  listenerCount(eventType: EnrollmentEventType): number {
    return (this.listeners.get(eventType)?.size ?? 0) +
           (this.onceSubscriptions.get(eventType)?.size ?? 0);
  }

  /**
   * Clear all listeners for a specific event type (for testing)
   *
   * @param eventType - The event type to clear (or undefined to clear all)
   */
  clear(eventType?: EnrollmentEventType): void {
    if (eventType) {
      this.listeners.get(eventType)?.clear();
      this.onceSubscriptions.get(eventType)?.clear();
    } else {
      this.listeners.forEach((set) => set.clear());
      this.onceSubscriptions.forEach((set) => set.clear());
    }
  }
}

/**
 * Singleton instance of the enrollment event bus
 * Export this as the main interface for the rest of the application
 */
export const enrollmentEventBus = new EnrollmentEventBus();
