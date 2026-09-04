/**
 * WebSocket Broadcast Service
 *
 * Bridges the Event Bus and WebSocket Server. Translates enrollment events
 * from the event bus into WebSocket messages and broadcasts them to subscribed clients.
 *
 * Core Responsibilities:
 * - Listen to enrollment events from the event bus
 * - Find all subscribed clients for an enrollment
 * - Send WebSocket messages to relevant clients
 * - Ensure tenant isolation in all broadcasts
 * - Handle failed sends gracefully
 * - Log all broadcast operations
 *
 * Validates: Requirements 3.3, 3.4, 7.3
 */

import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { logger } from '@/utils/logger';
import { webSocketClientManager, ClientConnection } from '@/lib/websocket-client-manager';
import {
  enrollmentEventBus,
  EnrollmentEvent,
  EnrollmentEventType,
  Enrollment,
} from '@/lib/enrollment-event-bus';

/**
 * WebSocket Message Format
 *
 * Represents the structure of messages sent from server to client
 */
export interface WebSocketMessage {
  /** Unique identifier for message tracking */
  id: string;

  /** Message type: event type or system message */
  type: EnrollmentEventType | 'heartbeat' | 'subscription-ack' | 'error';

  /** Message payload data */
  data?: {
    enrollment?: Enrollment;
    enrollmentId?: string;
    subscribedTo?: string[];
    message?: string;
  };

  /** ISO 8601 timestamp when message was created */
  timestamp: string;

  /** Optional error message if type is 'error' */
  error?: string;
}

/**
 * Broadcast result tracking successful and failed sends
 */
export interface BroadcastResult {
  /** Total number of clients message was sent to */
  totalClients: number;

  /** Number of successful sends */
  successfulSends: number;

  /** Number of failed sends */
  failedSends: number;

  /** Client IDs that failed to receive message */
  failedClientIds: string[];
}

/**
 * WebSocket Broadcast Service
 *
 * Handles broadcasting of enrollment events to WebSocket clients.
 * Subscribes to the enrollment event bus and translates events into WebSocket messages.
 */
export class WebSocketBroadcastService {
  private unsubscribeFromEventBus?: () => void;

  constructor() {
    // Subscribe to all enrollment events
    this.subscribeToEvents();
  }

  /**
   * Subscribe to enrollment events from the event bus
   *
   * This method sets up listeners for enrollment-updated, enrollment-added, and enrollment-removed
   * events. When an event is received, it broadcasts the event to all subscribed clients.
   *
   * Validates: Requirements 3.2
   */
  private subscribeToEvents(): void {
    // For now, we'll set up subscriptions manually
    // In the future, this could be called from the WebSocket server initialization
    enrollmentEventBus.subscribe('enrollment-updated', (event) => {
      this.broadcastEnrollmentUpdate(event).catch((error) => {
        logger.error(
          '[WebSocketBroadcastService] Error broadcasting enrollment-updated event:',
          error
        );
      });
    });

    enrollmentEventBus.subscribe('enrollment-added', (event) => {
      this.broadcastEnrollmentUpdate(event).catch((error) => {
        logger.error(
          '[WebSocketBroadcastService] Error broadcasting enrollment-added event:',
          error
        );
      });
    });

    enrollmentEventBus.subscribe('enrollment-removed', (event) => {
      this.broadcastEnrollmentUpdate(event).catch((error) => {
        logger.error(
          '[WebSocketBroadcastService] Error broadcasting enrollment-removed event:',
          error
        );
      });
    });
  }

  /**
   * Broadcast an enrollment event to all subscribed clients
   *
   * This is the main entry point for event broadcasting. It:
   * 1. Extracts the enrollment ID from the event
   * 2. Finds all clients subscribed to that enrollment (filtered by tenant)
   * 3. Formats the event as a WebSocket message
   * 4. Sends the message to each subscribed client
   *
   * Validates: Requirements 3.2, 3.3, 3.4, 7.3
   *
   * @param event - The enrollment event to broadcast
   * @returns Promise resolving to broadcast result with success/failure counts
   * @throws Error if event is invalid or missing required data
   */
  async broadcastEnrollmentUpdate(event: EnrollmentEvent): Promise<BroadcastResult> {
    const { type, enrollment, enrollmentId, tenantId } = event;

    // Validate event has required fields
    if (!tenantId) {
      throw new Error('Enrollment event missing required tenantId');
    }

    // Determine enrollment ID from event
    const actualEnrollmentId = enrollment?.id || enrollmentId;
    if (!actualEnrollmentId) {
      throw new Error('Enrollment event missing enrollmentId and enrollment.id');
    }

    logger.debug(
      `[WebSocketBroadcastService] Broadcasting ${type} event for enrollment ${actualEnrollmentId} (tenant: ${tenantId})`
    );

    // Get all subscribed clients for this enrollment, filtered by tenant
    const subscribers = webSocketClientManager.getSubscribersByTenant(
      actualEnrollmentId,
      tenantId
    );

    if (subscribers.length === 0) {
      logger.debug(
        `[WebSocketBroadcastService] No subscribed clients for enrollment ${actualEnrollmentId}`
      );
      return {
        totalClients: 0,
        successfulSends: 0,
        failedSends: 0,
        failedClientIds: [],
      };
    }

    // Format the message
    const message = this.formatMessage(event);

    // Send to all subscribed clients
    return this.broadcastToClients(
      subscribers.map((client) => client.clientId),
      message
    );
  }

  /**
   * Send a message to specific clients
   *
   * Sends the provided message to each client in the list. If a send fails,
   * logs the error but continues broadcasting to other clients.
   *
   * Validates: Requirements 3.4, 10.6
   *
   * @param clientIds - Array of client IDs to send to
   * @param message - WebSocket message to send
   * @returns Promise resolving to broadcast result with success/failure counts
   */
  async broadcastToClients(
    clientIds: string[],
    message: WebSocketMessage
  ): Promise<BroadcastResult> {
    const result: BroadcastResult = {
      totalClients: clientIds.length,
      successfulSends: 0,
      failedSends: 0,
      failedClientIds: [],
    };

    // Send message to each client
    for (const clientId of clientIds) {
      try {
        const client = webSocketClientManager.getConnection(clientId);
        if (!client) {
          logger.warn(
            `[WebSocketBroadcastService] Client ${clientId} not found in manager`
          );
          result.failedSends++;
          result.failedClientIds.push(clientId);
          continue;
        }

        // Check if connection is still open
        if (client.ws.readyState !== WebSocket.OPEN) {
          logger.warn(
            `[WebSocketBroadcastService] Connection for client ${clientId} is not open (state: ${client.ws.readyState})`
          );
          result.failedSends++;
          result.failedClientIds.push(clientId);
          continue;
        }

        // Send the message
        client.ws.send(JSON.stringify(message));
        result.successfulSends++;

        logger.debug(
          `[WebSocketBroadcastService] Message ${message.id} sent to client ${clientId}`
        );
      } catch (error) {
        logger.error(
          `[WebSocketBroadcastService] Error sending message to client ${clientId}:`,
          error
        );
        result.failedSends++;
        result.failedClientIds.push(clientId);
        // Continue broadcasting to other clients despite this error
      }
    }

    return result;
  }

  /**
   * Broadcast a message to all connected clients (admin notifications)
   *
   * Sends a message to every currently connected client, regardless of tenant.
   * Should only be used for system-wide admin notifications.
   *
   * Validates: Requirements 3.4
   *
   * @param message - WebSocket message to broadcast
   * @returns Promise resolving to broadcast result
   */
  async broadcastToAll(message: WebSocketMessage): Promise<BroadcastResult> {
    const allClients = webSocketClientManager.getAllConnections();
    const clientIds = allClients.map((client) => client.clientId);

    logger.info(
      `[WebSocketBroadcastService] Broadcasting to all ${clientIds.length} connected clients`
    );

    return this.broadcastToClients(clientIds, message);
  }

  /**
   * Broadcast a message to all clients in a specific tenant
   *
   * Sends a message to all connected clients whose tenant_id matches the specified tenant.
   * Useful for tenant-wide announcements or system updates.
   *
   * Validates: Requirements 3.4, 7.3
   *
   * @param tenantId - Tenant ID to broadcast to
   * @param message - WebSocket message to broadcast
   * @returns Promise resolving to broadcast result
   */
  async broadcastToTenant(
    tenantId: string,
    message: WebSocketMessage
  ): Promise<BroadcastResult> {
    const allClients = webSocketClientManager.getAllConnections();

    // Filter to only clients in the specified tenant
    const tenantClients = allClients.filter((client) => client.tenantId === tenantId);
    const clientIds = tenantClients.map((client) => client.clientId);

    logger.info(
      `[WebSocketBroadcastService] Broadcasting to ${clientIds.length} clients in tenant ${tenantId}`
    );

    return this.broadcastToClients(clientIds, message);
  }

  /**
   * Format an enrollment event as a WebSocket message
   *
   * Converts an enrollment event into the WebSocket message format expected by clients.
   * Generates a unique message ID, includes timestamp, and preserves all enrollment data.
   *
   * Validates: Requirements 8.1, 8.2, 8.3, 8.4
   *
   * @param event - The enrollment event to format
   * @returns Formatted WebSocket message
   */
  private formatMessage(event: EnrollmentEvent): WebSocketMessage {
    const { type, enrollment, enrollmentId } = event;

    const message: WebSocketMessage = {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
    };

    // Add data based on event type
    if (type === 'enrollment-removed') {
      message.data = {
        enrollmentId: enrollment?.id || enrollmentId,
        enrollment, // Include full enrollment for audit purposes
      };
    } else {
      // enrollment-updated, enrollment-added
      message.data = {
        enrollment,
      };
    }

    return message;
  }

  /**
   * Create an error message to send to a client
   *
   * Formats an error message in the standard WebSocket message format.
   *
   * @param errorMessage - Human-readable error message
   * @returns Formatted error WebSocket message
   */
  createErrorMessage(errorMessage: string): WebSocketMessage {
    return {
      id: randomUUID(),
      type: 'error',
      timestamp: new Date().toISOString(),
      error: errorMessage,
      data: {
        message: errorMessage,
      },
    };
  }

  /**
   * Create a subscription acknowledgment message
   *
   * Sends a message to client confirming their subscription to enrollment(s).
   *
   * @param subscribedTo - Array of enrollment IDs the client is subscribed to
   * @returns Formatted subscription-ack message
   */
  createSubscriptionAckMessage(subscribedTo: string[]): WebSocketMessage {
    return {
      id: randomUUID(),
      type: 'subscription-ack',
      timestamp: new Date().toISOString(),
      data: {
        subscribedTo,
      },
    };
  }

  /**
   * Create a heartbeat ping message
   *
   * Sends a ping message to keep the connection alive and detect dead connections.
   *
   * @returns Formatted heartbeat message
   */
  createHeartbeatMessage(): WebSocketMessage {
    return {
      id: randomUUID(),
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get statistics about current broadcasts
   *
   * Returns information about connected clients and subscriptions.
   * Useful for monitoring and debugging.
   *
   * @returns Statistics object
   */
  getStats() {
    return webSocketClientManager.getStats();
  }

  /**
   * Cleanup and shutdown the broadcast service
   *
   * Should be called during application shutdown to clean up resources.
   */
  shutdown(): void {
    if (this.unsubscribeFromEventBus) {
      this.unsubscribeFromEventBus();
    }
  }
}

/**
 * Singleton instance of the WebSocket broadcast service
 * Export this for use throughout the application
 */
export const webSocketBroadcastService = new WebSocketBroadcastService();
