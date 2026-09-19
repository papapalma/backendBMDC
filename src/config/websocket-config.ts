/**
 * WebSocket Configuration
 * 
 * Manages WebSocket URL configuration based on environment.
 * Enforces WSS (secure WebSocket) in production, allows WS in development.
 * Implements Requirements 15.1
 * 
 * Validates: Requirements 15.1
 */

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  /** Protocol: 'ws' or 'wss' */
  protocol: 'ws' | 'wss';
  /** Host name or IP */
  host: string;
  /** Port number */
  port: number;
  /** Full URL string */
  url: string;
  /** Whether WSS is enforced */
  isSecure: boolean;
  /** Whether production environment */
  isProduction: boolean;
}

/**
 * Get WebSocket configuration based on environment
 * 
 * Production: ONLY WSS (wss://)
 * Development: Allow both WS (ws://) and WSS (wss://)
 * 
 * Validates: Requirement 15.1
 * 
 * @returns WebSocket configuration
 */
export function getWebSocketConfig(): WebSocketConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const host = process.env.WS_HOST || 'localhost';
  const port = parseInt(process.env.WS_PORT || '8080', 10);

  // In production, MUST use WSS
  if (isProduction) {
    const protocol = 'wss' as const;
    const url = `${protocol}://${host}:${port}`;

    return {
      protocol,
      host,
      port,
      url,
      isSecure: true,
      isProduction: true,
    };
  } else {
    // Development: allow both WS and WSS (default to WS for dev convenience)
    const configuredProtocol = (process.env.WS_PROTOCOL || 'ws') as 'ws' | 'wss';

    // Validate protocol is one of allowed values
    if (!['ws', 'wss'].includes(configuredProtocol)) {
      console.warn(
        `[WebSocket Config] Invalid WS_PROTOCOL: ${configuredProtocol}, defaulting to 'ws'`
      );
    }

    const protocol = ['ws', 'wss'].includes(configuredProtocol) ? configuredProtocol : ('ws' as const);
    const url = `${protocol}://${host}:${port}`;

    return {
      protocol,
      host,
      port,
      url,
      isSecure: protocol === 'wss',
      isProduction: false,
    };
  }
}

/**
 * Get WebSocket URL string
 * 
 * Validates: Requirement 15.1
 * 
 * @returns WebSocket URL (wss:// in production, ws:// in dev)
 */
export function getWebSocketUrl(): string {
  const config = getWebSocketConfig();
  return config.url;
}

/**
 * Get WebSocket protocol
 * 
 * Validates: Requirement 15.1
 * 
 * @returns Protocol: 'wss' in production, 'ws' or 'wss' in development
 */
export function getWebSocketProtocol(): 'ws' | 'wss' {
  const config = getWebSocketConfig();
  return config.protocol;
}

/**
 * Check if WSS is required (production environment)
 * 
 * Validates: Requirement 15.1
 * 
 * @returns True if in production (WSS required)
 */
export function isWSSRequired(): boolean {
  const isProduction = process.env.NODE_ENV === 'production';
  return isProduction;
}

/**
 * Validate WebSocket connection protocol
 * 
 * In production, only allows WSS.
 * In development, allows both WS and WSS.
 * 
 * Validates: Requirement 15.1
 * 
 * @param protocol - Protocol from connection attempt
 * @returns True if protocol is valid for current environment
 */
export function isProtocolValid(protocol: string): boolean {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    // Production: ONLY allow WSS
    return protocol === 'wss' || protocol === 'wss:';
  } else {
    // Development: allow both WS and WSS
    return ['ws', 'wss', 'ws:', 'wss:'].includes(protocol);
  }
}

/**
 * Get appropriate error message for rejected protocol
 * 
 * Validates: Requirement 15.1
 * 
 * @returns Error message for security policy
 */
export function getProtocolRejectionMessage(): string {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    return 'WebSocket Secure (WSS) is required in production';
  } else {
    return 'Invalid WebSocket protocol';
  }
}

/**
 * Export configuration singleton
 */
export const webSocketConfig = getWebSocketConfig();
