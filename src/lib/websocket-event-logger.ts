/**
 * WebSocket Event Logger
 *
 * Provides utilities for logging enrollment changes with WebSocket event source tracking.
 * Requirement 9.1: Mark enrollment changes from API vs WebSocket
 *
 * This module tracks whether enrollment changes originated from:
 * - API: REST API calls that emit events through the event bus
 * - WebSocket: Events broadcast to WebSocket clients from the event bus
 *
 * All events are ultimately logged through the audit_logs table via writeAuditLog,
 * with the eventSource field in the details JSON distinguishing the origin.
 *
 * Usage:
 *   // When broadcasting an event to WebSocket clients
 *   logWebSocketEventBroadcast({
 *     eventType: 'enrollment-updated',
 *     enrollmentId: 'enroll-123',
 *     tenantId: 'tenant-001',
 *     subscribedClientCount: 5,
 *   });
 */

import { logger } from '@/utils/logger';
import { AuditAction, writeAuditLog } from '@/lib/auditLog';

/**
 * WebSocket broadcast event logging parameters
 */
export interface WebSocketBroadcastLogParams {
  /** The type of enrollment event being broadcast */
  eventType: 'enrollment-updated' | 'enrollment-added' | 'enrollment-removed';
  /** The enrollment ID being broadcast */
  enrollmentId: string;
  /** The tenant ID scope */
  tenantId: string;
  /** Number of subscribed clients receiving this broadcast */
  subscribedClientCount?: number;
  /** Optional user ID if known */
  userId?: string;
  /** Optional trainee ID for context */
  traineeId?: string;
  /** Optional program ID for context */
  programId?: string;
  /** Optional enrollment status for context */
  enrollmentStatus?: string;
}

/**
 * Log a WebSocket event broadcast
 *
 * Records that an enrollment event was broadcast to WebSocket clients.
 * Requirement 9.1: Track WebSocket connection events in separate log if needed
 * Marks events with eventSource: 'websocket' to distinguish from API-originated events.
 *
 * @param params - WebSocket broadcast logging parameters
 */
export async function logWebSocketEventBroadcast(
  params: WebSocketBroadcastLogParams
): Promise<void> {
  try {
    const actionMap: { [key: string]: string } = {
      'enrollment-updated': AuditAction.DATA_UPDATE,
      'enrollment-added': AuditAction.DATA_CREATE,
      'enrollment-removed': AuditAction.DATA_DELETE,
    };

    // Write to audit log with WebSocket event source marking
    await writeAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      action: actionMap[params.eventType] || 'enrollment.websocket_broadcast',
      entityType: 'enrollment',
      entityId: params.enrollmentId,
      details: {
        eventType: params.eventType,
        eventSource: 'websocket', // Mark as WebSocket-originated broadcast
        subscribedClientCount: params.subscribedClientCount,
        traineeId: params.traineeId,
        programId: params.programId,
        enrollmentStatus: params.enrollmentStatus,
      },
    }).catch((err) => {
      // Silently fail - audit logging shouldn't block WebSocket operations
      logger.warn('[WebSocketEventLogger] Failed to write WebSocket broadcast log', { err });
    });

    // Also log to console for real-time visibility
    logger.info('[WebSocketEventLogger] WebSocket event broadcast', {
      eventType: params.eventType,
      enrollmentId: params.enrollmentId,
      tenantId: params.tenantId,
      subscribedClientCount: params.subscribedClientCount,
      eventSource: 'websocket',
    });
  } catch (err) {
    // Silently fail - logging errors should never break WebSocket operations
    logger.warn('[WebSocketEventLogger] Error logging WebSocket broadcast', { err });
  }
}

/**
 * WebSocket connection event logging parameters
 */
export interface WebSocketConnectionLogParams {
  /** The event type: 'connected' or 'disconnected' */
  eventType: 'connected' | 'disconnected';
  /** Client connection ID (UUID) */
  clientId: string;
  /** The authenticated trainee ID */
  traineeId: string;
  /** The tenant ID scope */
  tenantId: string;
  /** Optional: Duration of connection in milliseconds (for disconnection events) */
  connectionDurationMs?: number;
  /** Optional: Reason for disconnection */
  disconnectReason?: string;
}

/**
 * Log a WebSocket connection event (connect or disconnect)
 *
 * Records WebSocket client connection and disconnection events.
 * Requirement 9.3: Log WebSocket client connects with client_id, trainee_id, tenant_id, timestamp
 * Requirement 9.4: Log WebSocket client disconnects with client_id, trainee_id, and duration of connection
 *
 * @param params - WebSocket connection logging parameters
 */
export async function logWebSocketConnectionEvent(
  params: WebSocketConnectionLogParams
): Promise<void> {
  try {
    const action =
      params.eventType === 'connected'
        ? 'websocket.client_connected'
        : 'websocket.client_disconnected';

    // Write to audit log
    await writeAuditLog({
      tenantId: params.tenantId,
      userId: params.traineeId,
      action,
      entityType: 'websocket_connection',
      entityId: params.clientId,
      details: {
        eventType: params.eventType,
        clientId: params.clientId,
        traineeId: params.traineeId,
        connectionDurationMs: params.connectionDurationMs,
        disconnectReason: params.disconnectReason,
      },
    }).catch((err) => {
      // Silently fail - audit logging shouldn't block connection lifecycle
      logger.warn('[WebSocketEventLogger] Failed to write connection event log', { err });
    });

    // Also log to console for real-time visibility
    logger.info('[WebSocketEventLogger] WebSocket connection event', {
      eventType: params.eventType,
      clientId: params.clientId,
      traineeId: params.traineeId,
      tenantId: params.tenantId,
      connectionDurationMs: params.connectionDurationMs,
      disconnectReason: params.disconnectReason,
    });
  } catch (err) {
    // Silently fail - logging errors should never break connection lifecycle
    logger.warn('[WebSocketEventLogger] Error logging connection event', { err });
  }
}

/**
 * Log a WebSocket subscription event
 *
 * Records when a client subscribes to or unsubscribes from enrollment updates.
 * Useful for tracking client subscription patterns and debugging.
 *
 * @param eventType - 'subscribed' or 'unsubscribed'
 * @param params - Subscription logging parameters
 */
export async function logWebSocketSubscriptionEvent(
  eventType: 'subscribed' | 'unsubscribed',
  params: {
    clientId: string;
    traineeId: string;
    enrollmentId: string;
    tenantId: string;
  }
): Promise<void> {
  try {
    const action = eventType === 'subscribed'
      ? 'websocket.subscription_added'
      : 'websocket.subscription_removed';

    await writeAuditLog({
      tenantId: params.tenantId,
      userId: params.traineeId,
      action,
      entityType: 'enrollment',
      entityId: params.enrollmentId,
      details: {
        eventType,
        clientId: params.clientId,
        traineeId: params.traineeId,
      },
    }).catch((err) => {
      logger.warn('[WebSocketEventLogger] Failed to write subscription event log', { err });
    });
  } catch (err) {
    logger.warn('[WebSocketEventLogger] Error logging subscription event', { err });
  }
}

/**
 * Log a WebSocket validation error
 *
 * Records when a WebSocket message validation fails.
 * Requirement 9.5: Log validation errors with message content for debugging
 *
 * @param params - Validation error logging parameters
 */
export async function logWebSocketValidationError(
  params: {
    clientId?: string;
    traineeId?: string;
    tenantId?: string;
    errorType: string;
    errorMessage: string;
    messageContent?: string;
  }
): Promise<void> {
  try {
    await writeAuditLog({
      tenantId: params.tenantId,
      userId: params.traineeId,
      action: 'websocket.message_validation_failed',
      entityType: 'websocket_message',
      details: {
        clientId: params.clientId,
        errorType: params.errorType,
        errorMessage: params.errorMessage,
        messageContent: params.messageContent,
      },
    }).catch((err) => {
      logger.warn('[WebSocketEventLogger] Failed to write validation error log', { err });
    });

    logger.warn('[WebSocketEventLogger] WebSocket validation error', {
      clientId: params.clientId,
      errorType: params.errorType,
      errorMessage: params.errorMessage,
    });
  } catch (err) {
    logger.warn('[WebSocketEventLogger] Error logging validation error', { err });
  }
}
