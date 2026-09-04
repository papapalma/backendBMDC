'use strict';

import WebSocket from 'ws';
import crypto from 'crypto';
import { logger } from '@/utils/logger';
import { writeAuditLog, AuditAction } from '@/lib/auditLog';

/**
 * Client connection state tracking
 * 
 * Represents a single connected WebSocket client with metadata about the connection,
 * authentication, and subscription state.
 * 
 * Validates: Requirements 1.3, 1.4, 1.6, 7.1
 */
export interface ClientConnection {
  /** Unique identifier for this connection */
  clientId: string;
  
  /** Tenant ID extracted from JWT token - used for data isolation */
  tenantId: string;
  
  /** User ID (trainee or staff) from JWT token */
  userId: string;
  
  /** Trainee ID if user is a trainee (optional for admin/staff) */
  traineeId?: string;
  
  /** User role (trainee, staff, admin, etc.) */
  role: string;
  
  /** Timestamp when connection was established */
  connectedAt: Date;
  
  /** Timestamp of last message received (used for idle detection) */
  lastHeartbeat: Date;
  
  /** Set of enrollment IDs this client is subscribed to */
  subscriptions: Set<string>;
  
  /** WebSocket connection object for sending messages */
  ws: WebSocket;
  
  /** Whether client has completed authentication */
  authenticated: boolean;
  
  /** Optional timeout handle for heartbeat detection */
  heartbeatTimeout?: NodeJS.Timeout;
}

/**
 * WebSocket Client Connection Manager
 * 
 * Manages the lifecycle of WebSocket client connections including:
 * - Adding and removing connections
 * - Tracking subscriptions per client
 * - Managing tenant isolation
 * - Subscription deduplication
 * - Cleanup of disconnected clients
 * 
 * Validates: Requirements 1.3, 1.4, 1.6, 7.1
 */
export class WebSocketClientManager {
  /** Map of clientId -> ClientConnection */
  private clients: Map<string, ClientConnection> = new Map();
  
  /** Map of enrollmentId -> Set of clientIds (for efficient broadcasting) */
  private subscriptions: Map<string, Set<string>> = new Map();
  
  /** Maximum number of concurrent clients supported */
  private readonly MAX_CLIENTS = 5000;

  /**
   * Add a new client connection
   * 
   * Validates: Requirements 1.3, 7.1, 9.3
   * 
   * @param clientId - Unique identifier for this connection
   * @param tenantId - Tenant ID from JWT claims
   * @param userId - User ID from JWT claims
   * @param role - User role from JWT claims
   * @param ws - WebSocket connection object
   * @param traineeId - Optional trainee ID (present if user is a trainee)
   * @returns The added ClientConnection
   * @throws Error if maximum client limit is reached
   */
  addConnection(
    clientId: string,
    tenantId: string,
    userId: string,
    role: string,
    ws: WebSocket,
    traineeId?: string
  ): ClientConnection {
    if (this.clients.size >= this.MAX_CLIENTS) {
      throw new Error(
        `Maximum concurrent connections (${this.MAX_CLIENTS}) reached`
      );
    }

    const now = new Date();
    const client: ClientConnection = {
      clientId,
      tenantId,
      userId,
      traineeId,
      role,
      connectedAt: now,
      lastHeartbeat: now,
      subscriptions: new Set(),
      ws,
      authenticated: true,
    };

    this.clients.set(clientId, client);

    // Log WebSocket client connection (Req 9.3)
    logger.info('[WebSocket] Client connected', {
      clientId,
      traineeId: traineeId || null,
      tenantId,
      userId,
      role,
      timestamp: now.toISOString(),
    });

    // Write audit log for connection event (Req 9.3)
    writeAuditLog({
      tenantId,
      userId,
      action: 'websocket.client_connected',
      entityType: 'websocket_connection',
      entityId: clientId,
      details: {
        clientId,
        traineeId: traineeId || null,
        role,
        connectedAt: now.toISOString(),
      },
    }).catch((err) => {
      logger.warn('[WebSocket] Failed to write connection audit log', { err });
    });

    return client;
  }

  /**
   * Remove a client connection and clean up all associated data
   * 
   * Validates: Requirements 1.6, 2.6, 9.4
   * 
   * @param clientId - Client ID to remove
   * @returns The removed ClientConnection, or undefined if not found
   */
  removeConnection(clientId: string): ClientConnection | undefined {
    const client = this.clients.get(clientId);
    if (!client) {
      return undefined;
    }

    // Clear heartbeat timeout
    if (client.heartbeatTimeout) {
      clearTimeout(client.heartbeatTimeout);
    }

    // Calculate connection duration (Req 9.4)
    const disconnectTime = new Date();
    const durationMs = disconnectTime.getTime() - client.connectedAt.getTime();
    const durationSeconds = Math.round(durationMs / 1000);

    // Remove from all subscriptions
    for (const [enrollmentId, subscribers] of this.subscriptions.entries()) {
      if (subscribers.has(clientId)) {
        subscribers.delete(clientId);
        // Clean up empty subscription sets
        if (subscribers.size === 0) {
          this.subscriptions.delete(enrollmentId);
        }
      }
    }

    // Remove client
    this.clients.delete(clientId);

    // Log WebSocket client disconnection (Req 9.4)
    logger.info('[WebSocket] Client disconnected', {
      clientId,
      traineeId: client.traineeId || null,
      tenantId: client.tenantId,
      userId: client.userId,
      duration: `${durationSeconds}s`,
      durationMs,
      connectedAt: client.connectedAt.toISOString(),
      disconnectedAt: disconnectTime.toISOString(),
    });

    // Write audit log for disconnection event (Req 9.4)
    writeAuditLog({
      tenantId: client.tenantId,
      userId: client.userId,
      action: 'websocket.client_disconnected',
      entityType: 'websocket_connection',
      entityId: clientId,
      details: {
        clientId,
        traineeId: client.traineeId || null,
        durationSeconds,
        durationMs,
        connectedAt: client.connectedAt.toISOString(),
        disconnectedAt: disconnectTime.toISOString(),
      },
    }).catch((err) => {
      logger.warn('[WebSocket] Failed to write disconnection audit log', { err });
    });

    return client;
  }

  /**
   * Get a client connection by ID
   * 
   * @param clientId - Client ID to retrieve
   * @returns The ClientConnection or undefined if not found
   */
  getConnection(clientId: string): ClientConnection | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Add a subscription for a client
   * 
   * Implements deduplication - adding the same subscription twice only
   * results in one subscription.
   * 
   * Validates: Requirements 2.2, 2.3, 2.4
   * 
   * @param clientId - Client ID to subscribe
   * @param enrollmentId - Enrollment ID to subscribe to
   * @returns true if subscription was added, false if already existed
   */
  addSubscription(clientId: string, enrollmentId: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    // Check for duplicate subscription
    if (client.subscriptions.has(enrollmentId)) {
      return false; // Already subscribed
    }

    // Add to client's subscriptions
    client.subscriptions.add(enrollmentId);

    // Add to global subscriptions mapping
    if (!this.subscriptions.has(enrollmentId)) {
      this.subscriptions.set(enrollmentId, new Set());
    }
    this.subscriptions.get(enrollmentId)!.add(clientId);

    return true;
  }

  /**
   * Remove a subscription for a client
   * 
   * Validates: Requirements 2.6
   * 
   * @param clientId - Client ID to unsubscribe
   * @param enrollmentId - Enrollment ID to unsubscribe from
   * @returns true if subscription was removed, false if not subscribed
   */
  removeSubscription(clientId: string, enrollmentId: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    // Check if actually subscribed
    if (!client.subscriptions.has(enrollmentId)) {
      return false;
    }

    // Remove from client's subscriptions
    client.subscriptions.delete(enrollmentId);

    // Remove from global subscriptions
    const subscribers = this.subscriptions.get(enrollmentId);
    if (subscribers) {
      subscribers.delete(clientId);
      // Clean up empty subscription sets
      if (subscribers.size === 0) {
        this.subscriptions.delete(enrollmentId);
      }
    }

    return true;
  }

  /**
   * Get all subscriptions for a client
   * 
   * @param clientId - Client ID
   * @returns Set of enrollment IDs, or empty Set if client not found
   */
  getClientSubscriptions(clientId: string): Set<string> {
    const client = this.clients.get(clientId);
    return client ? new Set(client.subscriptions) : new Set();
  }

  /**
   * Get all client IDs subscribed to an enrollment
   * 
   * Validates: Requirements 3.3, 7.3
   * 
   * @param enrollmentId - Enrollment ID
   * @returns Set of client IDs subscribed to this enrollment
   */
  getSubscribers(enrollmentId: string): Set<string> {
    const subscribers = this.subscriptions.get(enrollmentId);
    return subscribers ? new Set(subscribers) : new Set();
  }

  /**
   * Get all clients subscribed to an enrollment (filtered by tenant)
   * 
   * Used for broadcasting to ensure tenant isolation.
   * 
   * Validates: Requirements 3.3, 7.3, 7.5
   * 
   * @param enrollmentId - Enrollment ID
   * @param tenantId - Tenant ID to filter by
   * @returns Array of ClientConnection objects matching the tenant
   */
  getSubscribersByTenant(enrollmentId: string, tenantId: string): ClientConnection[] {
    const subscriberIds = this.subscriptions.get(enrollmentId);
    if (!subscriberIds) {
      return [];
    }

    const result: ClientConnection[] = [];
    for (const clientId of subscriberIds) {
      const client = this.clients.get(clientId);
      if (client && client.tenantId === tenantId) {
        result.push(client);
      }
    }

    return result;
  }

  /**
   * Update the last heartbeat time for a client
   * 
   * Used to track idle connections for cleanup.
   * 
   * @param clientId - Client ID
   */
  updateHeartbeat(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastHeartbeat = new Date();
    }
  }

  /**
   * Get all currently connected clients
   * 
   * @returns Array of all ClientConnection objects
   */
  getAllConnections(): ClientConnection[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get all clients that are idle (no heartbeat for specified duration)
   * 
   * Validates: Requirements 11.4
   * 
   * @param idleTimeMs - Idle time threshold in milliseconds
   * @returns Array of idle ClientConnection objects
   */
  getIdleConnections(idleTimeMs: number): ClientConnection[] {
    const now = new Date();
    const result: ClientConnection[] = [];

    for (const client of this.clients.values()) {
      const idleTime = now.getTime() - client.lastHeartbeat.getTime();
      if (idleTime > idleTimeMs) {
        result.push(client);
      }
    }

    return result;
  }

  /**
   * Get connection statistics (for monitoring and debugging)
   * 
   * @returns Statistics object
   */
  getStats(): {
    connectedClients: number;
    totalSubscriptions: number;
    subscriptionsByEnrollment: number;
    uniqueEnrollments: number;
  } {
    const totalSubscriptions = Array.from(this.clients.values()).reduce(
      (sum, client) => sum + client.subscriptions.size,
      0
    );

    return {
      connectedClients: this.clients.size,
      totalSubscriptions,
      subscriptionsByEnrollment: this.subscriptions.size,
      uniqueEnrollments: this.subscriptions.size,
    };
  }

  /**
   * Clear all connections (used for testing and shutdown)
   */
  clear(): void {
    this.clients.clear();
    this.subscriptions.clear();
  }

  /**
   * Get number of connected clients
   * 
   * @returns Number of clients currently connected
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Check if a specific client is connected
   * 
   * @param clientId - Client ID to check
   * @returns true if client is connected, false otherwise
   */
  isClientConnected(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  /**
   * Log a WebSocket connection error
   * 
   * Logs connection errors for debugging and audit purposes.
   * 
   * Validates: Requirements 9.5
   * 
   * @param clientId - Client ID (may not be fully established)
   * @param tenantId - Tenant ID if available
   * @param userId - User ID if available
   * @param error - The error that occurred
   * @param errorType - Type of error (e.g., 'connection_refused', 'auth_failed', 'message_error')
   */
  logConnectionError(
    clientId: string,
    tenantId: string | null,
    userId: string | null,
    error: Error | string,
    errorType: string
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Log to console (Req 9.5)
    logger.error('[WebSocket] Connection error', {
      clientId,
      tenantId,
      userId,
      errorType,
      errorMessage,
      errorStack,
      timestamp: new Date().toISOString(),
    });

    // Write security audit log for connection errors (Req 9.5)
    writeAuditLog({
      tenantId: tenantId || undefined,
      userId: userId || undefined,
      action: 'websocket.connection_error',
      entityType: 'websocket_connection',
      entityId: clientId,
      details: {
        clientId,
        errorType,
        errorMessage,
        errorStack: errorStack || undefined,
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => {
      logger.warn('[WebSocket] Failed to write error audit log', { err });
    });
  }
}

// Export singleton instance
export const webSocketClientManager = new WebSocketClientManager();
