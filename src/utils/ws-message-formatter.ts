/**
 * WebSocket Message Formatter
 *
 * Formats and validates WebSocket messages for enrollment synchronization.
 * Generates unique message IDs, includes timestamps, and validates enrollment data
 * against schema before sending to clients.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 *
 * The formatter provides:
 * - Unique message ID generation (UUID)
 * - ISO8601 timestamp inclusion
 * - Enrollment data validation against Zod schema
 * - Type-safe message construction
 * - Support for all enrollment event types (updated, added, removed)
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { logger } from './logger';

/**
 * Enrollment schema for validation
 * Validates: Requirements 8.2, 8.3
 *
 * Defines all required fields that must be present in enrollment data:
 * - id: UUID of the enrollment record
 * - trainee_id: UUID of the trainee
 * - program_id: UUID of the program
 * - status: Current enrollment status
 * - enrollment_date: ISO8601 date when trainee enrolled
 * - completion_date: ISO8601 date if completed (nullable)
 * - created_at: ISO8601 timestamp of record creation
 * - updated_at: ISO8601 timestamp of last update
 */
const enrollmentSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  trainee_id: z.string().uuid('trainee_id must be a valid UUID'),
  program_id: z.string().uuid('program_id must be a valid UUID'),
  status: z.enum([
    'enrolled',
    'active',
    'completed',
    'dropped',
    'failed',
  ]),
  enrollment_date: z.string().datetime('enrollment_date must be ISO8601 format'),
  completion_date: z
    .string()
    .datetime('completion_date must be ISO8601 format')
    .nullable(),
  created_at: z.string().datetime('created_at must be ISO8601 format'),
  updated_at: z.string().datetime('updated_at must be ISO8601 format'),
});

/**
 * WebSocket message data for enrollment-updated events
 * Validates: Requirement 8.2
 *
 * Contains the complete enrollment object for updates
 */
const enrollmentUpdatedDataSchema = z.object({
  enrollment: enrollmentSchema,
});

/**
 * WebSocket message data for enrollment-added events
 * Validates: Requirement 8.3
 *
 * Contains the complete new enrollment object
 */
const enrollmentAddedDataSchema = z.object({
  enrollment: enrollmentSchema,
});

/**
 * WebSocket message data for enrollment-removed events
 * Validates: Requirement 8.4
 *
 * Contains both enrollmentId and the enrollment object (for audit purposes)
 */
const enrollmentRemovedDataSchema = z.object({
  enrollmentId: z.string().uuid('enrollmentId must be a valid UUID'),
  enrollment: enrollmentSchema,
});

/**
 * WebSocket message format schema
 * Validates: Requirement 8.1
 *
 * All server-to-client messages must conform to this format:
 * - id: Unique UUID for message tracking
 * - type: Message type identifier
 * - data: Message payload (varies by type)
 * - timestamp: ISO8601 timestamp of message creation
 * - error: Optional error message if present
 */
const webSocketMessageSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  type: z.enum([
    'enrollment-updated',
    'enrollment-added',
    'enrollment-removed',
  ]),
  data: z.object({}).passthrough(), // Data schema varies by message type
  timestamp: z.string().datetime('timestamp must be ISO8601 format'),
  error: z.string().optional(),
});

/**
 * Type definitions for formatted messages
 */
export type EnrollmentUpdatedMessage = {
  id: string;
  type: 'enrollment-updated';
  data: {
    enrollment: z.infer<typeof enrollmentSchema>;
  };
  timestamp: string;
};

export type EnrollmentAddedMessage = {
  id: string;
  type: 'enrollment-added';
  data: {
    enrollment: z.infer<typeof enrollmentSchema>;
  };
  timestamp: string;
};

export type EnrollmentRemovedMessage = {
  id: string;
  type: 'enrollment-removed';
  data: {
    enrollmentId: string;
    enrollment: z.infer<typeof enrollmentSchema>;
  };
  timestamp: string;
};

export type WebSocketMessage =
  | EnrollmentUpdatedMessage
  | EnrollmentAddedMessage
  | EnrollmentRemovedMessage;

/**
 * Format an enrollment-updated WebSocket message
 *
 * @param enrollment - The updated enrollment object
 * @returns Formatted WebSocket message with unique ID and ISO8601 timestamp
 * @throws Error if enrollment data fails schema validation
 *
 * Validates: Requirements 8.1, 8.2
 *
 * Message format:
 * {
 *   id: "550e8400-e29b-41d4-a716-446655440000",
 *   type: "enrollment-updated",
 *   data: {
 *     enrollment: { ...enrollment object... }
 *   },
 *   timestamp: "2024-01-15T10:30:45.123Z"
 * }
 */
export function formatEnrollmentUpdatedMessage(
  enrollment: unknown
): EnrollmentUpdatedMessage {
  // Validate enrollment data against schema
  const validatedEnrollment = enrollmentSchema.parse(enrollment);

  // Construct and validate message
  const message = {
    id: randomUUID(),
    type: 'enrollment-updated' as const,
    data: {
      enrollment: validatedEnrollment,
    },
    timestamp: new Date().toISOString(),
  };

  // Final validation against message schema
  const validated = webSocketMessageSchema.parse(message);

  return validated as EnrollmentUpdatedMessage;
}

/**
 * Format an enrollment-added WebSocket message
 *
 * @param enrollment - The new enrollment object
 * @returns Formatted WebSocket message with unique ID and ISO8601 timestamp
 * @throws Error if enrollment data fails schema validation
 *
 * Validates: Requirements 8.1, 8.3
 *
 * Message format:
 * {
 *   id: "550e8400-e29b-41d4-a716-446655440000",
 *   type: "enrollment-added",
 *   data: {
 *     enrollment: { ...enrollment object... }
 *   },
 *   timestamp: "2024-01-15T10:30:45.123Z"
 * }
 */
export function formatEnrollmentAddedMessage(
  enrollment: unknown
): EnrollmentAddedMessage {
  // Validate enrollment data against schema
  const validatedEnrollment = enrollmentSchema.parse(enrollment);

  // Construct and validate message
  const message = {
    id: randomUUID(),
    type: 'enrollment-added' as const,
    data: {
      enrollment: validatedEnrollment,
    },
    timestamp: new Date().toISOString(),
  };

  // Final validation against message schema
  const validated = webSocketMessageSchema.parse(message);

  return validated as EnrollmentAddedMessage;
}

/**
 * Format an enrollment-removed WebSocket message
 *
 * @param enrollmentId - The UUID of the removed enrollment
 * @param enrollment - The enrollment object (for audit purposes)
 * @returns Formatted WebSocket message with unique ID and ISO8601 timestamp
 * @throws Error if enrollment data fails schema validation
 *
 * Validates: Requirements 8.1, 8.4
 *
 * Message format:
 * {
 *   id: "550e8400-e29b-41d4-a716-446655440000",
 *   type: "enrollment-removed",
 *   data: {
 *     enrollmentId: "enrollment-uuid",
 *     enrollment: { ...enrollment object... }
 *   },
 *   timestamp: "2024-01-15T10:30:45.123Z"
 * }
 */
export function formatEnrollmentRemovedMessage(
  enrollmentId: string,
  enrollment: unknown
): EnrollmentRemovedMessage {
  // Validate enrollment data against schema
  const validatedEnrollment = enrollmentSchema.parse(enrollment);

  // Validate enrollmentId is a UUID
  if (!isValidUUID(enrollmentId)) {
    throw new Error('enrollmentId must be a valid UUID');
  }

  // Construct and validate message
  const message = {
    id: randomUUID(),
    type: 'enrollment-removed' as const,
    data: {
      enrollmentId,
      enrollment: validatedEnrollment,
    },
    timestamp: new Date().toISOString(),
  };

  // Final validation against message schema
  const validated = webSocketMessageSchema.parse(message);

  return validated as EnrollmentRemovedMessage;
}

/**
 * Validate that a string is a valid UUID
 *
 * @param value - String to validate
 * @returns True if value is a valid UUID format
 */
function isValidUUID(value: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Export all schemas for external use (e.g., in client-side validation)
 * These can be used to validate messages received from the server
 */
export const schemas = {
  enrollment: enrollmentSchema,
  enrollmentUpdatedData: enrollmentUpdatedDataSchema,
  enrollmentAddedData: enrollmentAddedDataSchema,
  enrollmentRemovedData: enrollmentRemovedDataSchema,
  webSocketMessage: webSocketMessageSchema,
};
