'use strict';

import WebSocket, { Server } from 'ws';
import { verifyToken } from './auth';
import { JWTPayload } from '@/types';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { WebSocketClientManager } from './websocket-client-manager';

/**
 * WebSocket message format for client-server communication
 * Validates: Requirements 1.1, 1.2, 8.1
 */
export interface WebSocketMessage {
  id: string;
  type:
    | 'auth'
    | 'subscribe'
    | 'unsubscribe'
    | 'enrollment-updated'
    | 'enrollment-added'
    | 'enrollment-removed'
    | 'heartbeat'
    | 'pong'
    | 'subscription-ack'
    | 'error';
  data?: {
    token?: string;
    enrollmentId?: string;
    enrollment?: any;
    enrollmentIds?: string[];
    error?: string;
    clientId?: string;
    subscribedTo?: string[];
    message?: string;
  };
  timestamp: string;
  error?: string;
}

// Re-export ClientConnection from the client manager
export type { ClientConnection } from './websocket-client-manager';

/**
 * Enrollment event from Event Bus
 * Validates: Requirements 3.1-3.7
 */
export interface EnrollmentEvent {
  type: 'enrollment-updated' | 'enrollment-added' | 'enrollment-removed';
  enrollment?: any;
  enrollmentId?: string;
  tenantId: string;
  timestamp: string;
  userId?: string;
}

/**
 * WebSocket Server Manager
 * 
 * Manages WebSocket connections, client subscriptions, and event broadcasting.
 * Implements JWT authentication, heartbeat, and graceful shutdown.
 * 
 * Uses WebSocketClientManager for managing client connections and subscriptions.
 * 
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 7.1, 14.1, 14.2
 */
export class WebSocketServerManager extends EventEmitter {
  private wss?: any;
  private clientManager: WebSocketClientManager = new WebSocketClientManager();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  private readonly HEARTBEAT_INTERVAL = 5000; // Send heartbeat every 5 seconds (Req 1.4)
  private readonly CONNECTION_TIMEOUT = 5000; // Connection establishment timeout
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes idle timeout (Req 11.4)

  constructor() {
    super();
  }

  /**
   * Start the WebSocket server
   * Validates: Requirements 1.1, 1.3, 15.1
   */
  async start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const isProduction = process.env.NODE_ENV === 'production';
        const protocol = isProduction ? 'wss' : 'ws';

        // @ts-ignore - ws Server class type resolution
        const WSServer = Server;
        this.wss = new WSServer({
          port,
          perMessageDeflate: false, // Disable compression for performance
          maxPayload: 64 * 1024, // 64KB max message size
        });

        this.wss.on('connection', (ws: WebSocket, req) => {
          this.handleConnection(ws, req);
        });

        this.wss.on('error', (error: Error) => {
          console.error('[WebSocket Server] Error:', error);
          this.emit('error', error);
        });

        // Start heartbeat mechanism
        this.startHeartbeat();

        // Start idle connection cleanup
        this.startIdleConnectionCleanup();

        console.log(
          `[WebSocket Server] Started on ${protocol}://localhost:${port}`
        );
        resolve();
      } catch (error) {
        console.error('[WebSocket Server] Failed to start:', error);
        reject(error);
      }
    });
  }

  /**
   * Stop the WebSocket server gracefully
   * Validates: Requirement 1.6
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.isShuttingDown = true;

      // Stop heartbeat
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }

      // Close all client connections
      const allClients = this.clientManager.getAllConnections();
      allClients.forEach((client) => {
        if (client.heartbeatTimeout) {
          clearTimeout(client.heartbeatTimeout);
        }
        client.ws.close(1000, 'Server shutting down');
      });

      // Close WebSocket server
      if (this.wss) {
        this.wss.close(() => {
          console.log('[WebSocket Server] Stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle new WebSocket connection
   * Validates: Requirements 1.2, 1.3, 14.1, 14.2
   */
  private handleConnection(ws: WebSocket, req: any): void {
    const clientId = crypto.randomUUID();

    console.log(`[WebSocket] New connection attempt: ${clientId}`);

    // Set connection timeout - client must authenticate within CONNECTION_TIMEOUT
    let connectionTimeout = setTimeout(() => {
      console.log(
        `[WebSocket] Connection timeout for ${clientId} - no auth received`
      );
      ws.close(4000, 'Connection timeout - no authentication received');
    }, this.CONNECTION_TIMEOUT);

    let isAuthenticated = false;

    const handleMessage = (rawData: WebSocket.Data) => {
      try {
        const data = JSON.parse(rawData.toString());

        // First message must be authentication
        if (!isAuthenticated && data.type !== 'auth') {
          console.warn(
            `[WebSocket] Non-auth first message from ${clientId}, closing`
          );
          ws.close(4001, 'Unauthorized - authentication required');
          return;
        }

        // Route message to appropriate handler
        if (data.type === 'auth') {
          this.handleAuth(clientId, ws, data, connectionTimeout);
          isAuthenticated = true;
        } else if (isAuthenticated) {
          this.handleMessage(clientId, data);
        }
      } catch (error) {
        console.error(`[WebSocket] Message parsing error for ${clientId}:`, error);
        this.sendError(ws, 'Invalid message format');
      }
    };

    const handleError = (error: Error) => {
      console.error(`[WebSocket] Client error for ${clientId}:`, error);
      if (connectionTimeout) clearTimeout(connectionTimeout);
      this.disconnectClient(clientId);
    };

    const handleClose = () => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      console.log(`[WebSocket] Connection closed: ${clientId}`);
      this.disconnectClient(clientId);
    };

    ws.on('message', handleMessage);
    ws.on('error', handleError);
    ws.on('close', handleClose);
  }

  /**
   * Handle authentication message
   * Validates: Requirements 1.2, 1.3, 14.1, 14.2
   */
  private handleAuth(
    clientId: string,
    ws: WebSocket,
    message: WebSocketMessage,
    connectionTimeout: NodeJS.Timeout
  ): void {
    const token = message.data?.token;

    if (!token) {
      console.warn(`[WebSocket] Auth failed - no token: ${clientId}`);
      ws.close(4001, 'Unauthorized - token required');
      clearTimeout(connectionTimeout);
      return;
    }

    // Verify JWT token (signature and expiration)
    const payload = verifyToken(token);

    if (!payload) {
      console.warn(`[WebSocket] Auth failed - invalid token: ${clientId}`);
      ws.close(4001, 'Unauthorized - invalid token');
      clearTimeout(connectionTimeout);
      return;
    }

    // Extract tenant_id and trainee_id from JWT claims
    const tenantId = payload.tenantId;
    const userId = payload.userId;
    const role = payload.role;

    // Note: traineeId is assumed to be userId for trainees, or extracted from context
    // This will be validated when subscriptions are made
    const traineeId = role === 'trainee' ? userId : undefined;

    try {
      const client = this.clientManager.addConnection(
        clientId,
        tenantId,
        userId,
        role,
        ws,
        traineeId
      );

      clearTimeout(connectionTimeout);

      console.log(
        `[WebSocket] Client authenticated: ${clientId} (tenant: ${tenantId}, user: ${userId})`
      );

      // Send authentication acknowledgement
      this.sendMessage(ws, {
        id: crypto.randomUUID(),
        type: 'subscription-ack',
        timestamp: new Date().toISOString(),
        data: {
          clientId,
          subscribedTo: Array.from(client.subscriptions),
        },
      });

      // Emit connection event for logging
      this.emit('client-connected', {
        clientId,
        tenantId,
        userId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[WebSocket] Error adding connection: ${clientId}`, error);
      ws.close(4000, 'Connection limit exceeded');
      clearTimeout(connectionTimeout);
    }
  }

  /**
   * Handle incoming WebSocket messages from authenticated clients
   * Validates: Requirements 1.5, 2.3, 14.4
   */
  private async handleMessage(clientId: string, message: WebSocketMessage): Promise<void> {
    const client = this.clientManager.getConnection(clientId);
    if (!client) {
      console.warn(`[WebSocket] Message from unknown client: ${clientId}`);
      return;
    }

    // Update last heartbeat time
    this.clientManager.updateHeartbeat(clientId);

    try {
      switch (message.type) {
        case 'subscribe':
          await this.handleSubscribe(clientId, message.data?.enrollmentId);
          break;

        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message.data?.enrollmentId);
          break;

        case 'pong':
          // Heartbeat response received, connection is alive
          if (client.heartbeatTimeout) {
            clearTimeout(client.heartbeatTimeout);
            client.heartbeatTimeout = undefined;
          }
          break;

        default:
          console.warn(
            `[WebSocket] Unknown message type from ${clientId}: ${message.type}`
          );
      }
    } catch (error) {
      console.error(
        `[WebSocket] Error handling message from ${clientId}:`,
        error
      );
      this.sendError(client.ws, 'Message processing failed');
    }
  }

  /**
   * Validate subscription request
   *
   * Checks that:
   * 1. Enrollment exists in database
   * 2. Enrollment belongs to client's tenant
   * 3. Client is authorized to subscribe (trainee can only subscribe to own enrollments, admins can subscribe to tenant enrollments)
   *
   * Validates: Requirements 2.1, 2.2, 2.3, 7.4, 7.5, 14.4
   *
   * @returns Object with { valid: boolean, error?: string }
   */
  private async validateSubscription(
    enrollmentId: string,
    clientTenantId: string,
    clientUserId: string,
    clientRole: string,
    clientTraineeId?: string
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      // Import supabaseAdmin for database queries
      const { supabaseAdmin } = await import('@/lib/supabase-admin');

      // Query enrollment from database
      const { data: enrollment, error: queryError } = await supabaseAdmin
        .from('enrollments')
        .select('id, tenant_id, trainee_id')
        .eq('id', enrollmentId)
        .maybeSingle();

      if (queryError) {
        console.error('[WebSocket] Database error validating subscription:', queryError);
        return { valid: false, error: 'Subscription validation failed' };
      }

      // Check if enrollment exists
      if (!enrollment) {
        return { valid: false, error: 'Enrollment not found' };
      }

      // Check tenant isolation - enrollment must belong to client's tenant
      if (enrollment.tenant_id !== clientTenantId) {
        console.warn(
          `[WebSocket] Cross-tenant subscription attempt: client tenant ${clientTenantId}, enrollment tenant ${enrollment.tenant_id}`
        );
        return { valid: false, error: 'Enrollment not found' }; // Don't leak tenant information
      }

      // Check authorization
      // Trainees can only subscribe to their own enrollments
      if (clientRole === 'trainee') {
        if (!clientTraineeId || enrollment.trainee_id !== clientTraineeId) {
          console.warn(
            `[WebSocket] Trainee ${clientUserId} attempted to subscribe to enrollment for trainee ${enrollment.trainee_id}`
          );
          return { valid: false, error: 'Not authorized to subscribe to this enrollment' };
        }
      }
      // Admins and staff can subscribe to any enrollment in their tenant (already checked above)

      return { valid: true };
    } catch (error) {
      console.error('[WebSocket] Error validating subscription:', error);
      return { valid: false, error: 'Subscription validation failed' };
    }
  }

  /**
   * Handle subscription request
   * Validates: Requirements 2.2, 2.3, 2.4, 7.5, 14.4
   */
  private async handleSubscribe(clientId: string, enrollmentId?: string): Promise<void> {
    if (!enrollmentId) {
      console.warn(`[WebSocket] Subscribe without enrollmentId: ${clientId}`);
      return;
    }

    const client = this.clientManager.getConnection(clientId);
    if (!client) return;

    try {
      // Validate enrollment exists and belongs to client's tenant
      const validationResult = await this.validateSubscription(
        enrollmentId,
        client.tenantId,
        client.userId,
        client.role,
        client.traineeId
      );

      if (!validationResult.valid) {
        console.warn(
          `[WebSocket] Subscription validation failed for ${clientId} -> ${enrollmentId}: ${validationResult.error}`
        );
        this.sendError(client.ws, validationResult.error || 'Subscription validation failed');
        return;
      }

      // Add subscription (handles deduplication internally)
      const isNew = this.clientManager.addSubscription(clientId, enrollmentId);

      if (!isNew) {
        console.log(
          `[WebSocket] Duplicate subscription ignored: ${clientId} -> ${enrollmentId}`
        );
      } else {
        console.log(
          `[WebSocket] Client subscribed: ${clientId} -> ${enrollmentId}`
        );
      }

      // Send subscription acknowledgement
      this.sendSubscriptionAck(client);
    } catch (error) {
      console.error(
        `[WebSocket] Error processing subscription for ${clientId}:`,
        error
      );
      this.sendError(client.ws, 'Subscription processing failed');
    }
  }

  /**
   * Handle unsubscription request
   * Validates: Requirements 2.6, 1.6
   */
  private handleUnsubscribe(clientId: string, enrollmentId?: string): void {
    if (!enrollmentId) {
      console.warn(`[WebSocket] Unsubscribe without enrollmentId: ${clientId}`);
      return;
    }

    const client = this.clientManager.getConnection(clientId);
    if (!client) return;

    // Remove subscription
    this.clientManager.removeSubscription(clientId, enrollmentId);

    console.log(
      `[WebSocket] Client unsubscribed: ${clientId} -> ${enrollmentId}`
    );

    // Send unsubscribe acknowledgement
    this.sendSubscriptionAck(client);
  }

  /**
   * Broadcast enrollment update to subscribed clients
   * Validates: Requirements 3.3, 3.4, 3.7, 7.3, 11.2
   */
  async broadcastEnrollmentUpdate(event: EnrollmentEvent): Promise<void> {
    const { type, enrollment, enrollmentId, tenantId, timestamp } = event;

    if (!enrollmentId) {
      console.warn('[WebSocket] Broadcast without enrollmentId');
      return;
    }

    // Get all subscribers for this enrollment (filtered by tenant)
    const subscribers = this.clientManager.getSubscribersByTenant(
      enrollmentId,
      tenantId
    );

    if (subscribers.length === 0) {
      console.log(
        `[WebSocket] No subscribers for enrollment: ${enrollmentId}`
      );
      return;
    }

    console.log(
      `[WebSocket] Broadcasting ${type} for enrollment ${enrollmentId} to ${subscribers.length} subscribers`
    );

    const message: WebSocketMessage = {
      id: crypto.randomUUID(),
      type: type as any,
      timestamp,
      data: {
        enrollment,
        enrollmentId,
      },
    };

    // Send to all subscribers
    const startTime = Date.now();
    let successCount = 0;
    let failureCount = 0;

    for (const client of subscribers) {
      try {
        this.sendMessage(client.ws, message);
        successCount++;
      } catch (error) {
        console.error(
          `[WebSocket] Failed to send to client ${client.clientId}:`,
          error
        );
        failureCount++;
        // Continue broadcasting to other subscribers (Req 10.6)
      }
    }

    const deliveryTime = Date.now() - startTime;
    console.log(
      `[WebSocket] Broadcast complete: ${successCount} sent, ${failureCount} failed in ${deliveryTime}ms`
    );

    // Emit event for logging
    this.emit('broadcast-complete', {
      enrollmentId,
      type,
      successCount,
      failureCount,
      deliveryTime,
    });
  }

  /**
   * Send a heartbeat ping to all connected clients
   * Validates: Requirements 1.4, 1.5
   */
  private sendHeartbeat(): void {
    const allClients = this.clientManager.getAllConnections();
    let pingCount = 0;

    allClients.forEach((client) => {
      // Check if client is alive (should have responded to previous ping)
      if (client.heartbeatTimeout) {
        console.warn(
          `[WebSocket] Client not responding to heartbeat: ${client.clientId}, closing`
        );
        client.ws.close(1000, 'Heartbeat timeout');
        return;
      }

      // Send heartbeat ping
      try {
        client.ws.ping();
        pingCount++;

        // Set timeout for pong response
        client.heartbeatTimeout = setTimeout(() => {
          console.warn(
            `[WebSocket] Pong timeout for client: ${client.clientId}`
          );
          client.ws.close(1000, 'Pong timeout');
        }, this.HEARTBEAT_INTERVAL);
      } catch (error) {
        console.error(
          `[WebSocket] Error sending heartbeat to ${client.clientId}:`,
          error
        );
      }
    });

    if (pingCount > 0) {
      console.log(`[WebSocket] Heartbeat sent to ${pingCount} clients`);
    }
  }

  /**
   * Start heartbeat mechanism
   * Validates: Requirements 1.4
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this.isShuttingDown) {
        this.sendHeartbeat();
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Start cleanup of idle connections
   * Validates: Requirements 11.4
   */
  private startIdleConnectionCleanup(): void {
    setInterval(() => {
      if (this.isShuttingDown) return;

      // Get idle connections
      const idleClients = this.clientManager.getIdleConnections(this.IDLE_TIMEOUT);

      if (idleClients.length > 0) {
        console.log(`[WebSocket] Found ${idleClients.length} idle connections`);

        idleClients.forEach((client) => {
          console.log(
            `[WebSocket] Closing idle connection: ${client.clientId}`
          );
          client.ws.close(1000, 'Idle timeout');
          this.disconnectClient(client.clientId);
        });
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Disconnect a client and clean up resources
   * Validates: Requirements 1.6, 2.6
   */
  private disconnectClient(clientId: string): void {
    const client = this.clientManager.removeConnection(clientId);
    if (!client) return;

    const connectionDuration =
      new Date().getTime() - client.connectedAt.getTime();

    console.log(
      `[WebSocket] Client disconnected: ${clientId} (connected for ${Math.round(connectionDuration / 1000)}s)`
    );

    // Emit disconnection event for logging
    this.emit('client-disconnected', {
      clientId,
      tenantId: client.tenantId,
      userId: client.userId,
      connectionDuration,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send a WebSocket message to a client
   */
  private sendMessage(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send subscription acknowledgement
   */
  private sendSubscriptionAck(client: any): void {
    this.sendMessage(client.ws, {
      id: crypto.randomUUID(),
      type: 'subscription-ack',
      timestamp: new Date().toISOString(),
      data: {
        subscribedTo: Array.from(client.subscriptions),
      },
    });
  }

  /**
   * Send error message to client
   */
  private sendError(ws: WebSocket, errorMessage: string): void {
    this.sendMessage(ws, {
      id: crypto.randomUUID(),
      type: 'error',
      timestamp: new Date().toISOString(),
      error: errorMessage,
    });
  }

  /**
   * Get connection statistics (for monitoring)
   */
  getStats(): {
    connectedClients: number;
    totalSubscriptions: number;
    subscriptionsByEnrollment: number;
  } {
    const stats = this.clientManager.getStats();
    return {
      connectedClients: stats.connectedClients,
      totalSubscriptions: stats.totalSubscriptions,
      subscriptionsByEnrollment: stats.subscriptionsByEnrollment,
    };
  }

  /**
   * Check if WebSocket server is running
   */
  isRunning(): boolean {
    return this.wss !== undefined && !this.isShuttingDown;
  }
}

// Export singleton instance
export const webSocketServerManager = new WebSocketServerManager();
