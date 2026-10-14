/**
 * POST /api/notifications  — trigger a notification (tenant-scoped, Req 12.5)
 *
 * Supported notification types:
 *  - enrollment_confirmation  (Req 12.1)
 *  - schedule_change  (Req 12.2)
 *  - training_reminder  (Req 12.3)
 *  - training_completion  (Req 12.4)
 *
 * All notifications are scoped to the requesting user's tenant.
 * Cross-tenant notifications are prevented at the service layer (Req 12.5).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, forbiddenResponse, errorResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import {
  notifyEnrollmentConfirmation,
  notifyScheduleChange,
  notifyTrainingReminder,
  notifyTrainingCompletion,
} from '@/services/notificationService';
import { activityLogService } from '@/services/activityLogService';
import { lendingService } from '@/services/lendingService';
import { z } from 'zod';

// Validation schemas
const enrollmentNotificationSchema = z.object({
  type: z.literal('enrollment_confirmation'),
  trainee_id: z.string().uuid('Invalid trainee ID'),
  program_name: z.string().min(1),
  start_date: z.string().min(1),
});

const scheduleChangeNotificationSchema = z.object({
  type: z.literal('schedule_change'),
  program_id: z.string().uuid('Invalid program ID'),
  program_name: z.string().min(1),
  change_description: z.string().min(1),
});

const reminderNotificationSchema = z.object({
  type: z.literal('training_reminder'),
  trainee_id: z.string().uuid('Invalid trainee ID'),
  program_name: z.string().min(1),
  session_date: z.string().min(1),
  session_time: z.string().min(1),
  location: z.string().optional(),
});

const completionNotificationSchema = z.object({
  type: z.literal('training_completion'),
  trainee_id: z.string().uuid('Invalid trainee ID'),
  program_name: z.string().min(1),
  certificate_url: z.string().url('Invalid certificate URL'),
});

const notificationSchema = z.discriminatedUnion('type', [
  enrollmentNotificationSchema,
  scheduleChangeNotificationSchema,
  reminderNotificationSchema,
  completionNotificationSchema,
]);

// OPTIONS /api/notifications
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/notifications - Get role- and tenant-scoped in-app notifications
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const context = ctxResult.context;
  const roleEntityTypes: Record<string, string[]> = {
    super_admin: ['item', 'lending', 'user', 'trainee', 'program', 'anomaly'],
    local_admin: ['item', 'lending', 'user', 'trainee', 'program', 'anomaly'],
    staff_inventory_manager: ['item', 'lending'],
    staff_training_coordinator: ['trainee', 'program'],
    trainee: [],
  };
  const allowedEntityTypes = roleEntityTypes[context.role] || [];

  const logs = allowedEntityTypes.length > 0
    ? await activityLogService.getAllLogs({
        tenant_id: context.tenantId,
        is_super_admin: context.isSuperAdmin,
        limit: 50,
      })
    : [];

  const notifications = logs
    .filter((log) => allowedEntityTypes.includes(log.entity_type))
    .map((log: any) => ({
      id: `activity-${log.id}`,
      type: 'activity',
      title: log.description || `${log.action} ${log.entity_type}`,
      description: `${log.module || log.entity_type} activity by ${log.userName || 'system'}`,
      createdAt: log.created_at,
      href: log.entity_type === 'item' ? `/items/${log.entity_id}/edit`
        : log.entity_type === 'lending' ? `/lendings/${log.entity_id}/slip`
        : log.entity_type === 'program' ? `/programs/${log.entity_id}`
        : log.entity_type === 'trainee' ? `/trainees/${log.entity_id}/edit`
        : '/dashboard',
    }));

  if (['super_admin', 'local_admin', 'staff_inventory_manager'].includes(context.role)) {
    const overdue = await lendingService.getOverdueLendings(context);
    notifications.push(...overdue.map((item: any) => ({
      id: `overdue-${item.id}`,
      type: 'overdue',
      title: 'Overdue item',
      description: `${item.item?.name || 'Inventory item'} is overdue${item.borrower_name ? ` for ${item.borrower_name}` : ''}`,
      createdAt: item.expected_return_date,
      href: '/lendings',
    })));
  }

  notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return successResponse({ notifications: notifications.slice(0, 50), unreadCount: notifications.length });
});

// POST /api/notifications - Trigger a notification (tenant-scoped, Req 12.5)
export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role } = ctxResult.context;

  // Only staff and admins can trigger notifications
  const allowedRoles = [
    'local_admin',
    'staff_training_coordinator',
    'staff_inventory_manager',
  ];
  if (!allowedRoles.includes(role)) {
    return forbiddenResponse('Insufficient permissions to send notifications');
  }

  const body = await request.json();
  const validated = notificationSchema.parse(body);

  let result: unknown;

  switch (validated.type) {
    case 'enrollment_confirmation':
      result = await notifyEnrollmentConfirmation({
        tenantId,
        traineeId: validated.trainee_id,
        programName: validated.program_name,
        startDate: validated.start_date,
      });
      break;

    case 'schedule_change':
      result = await notifyScheduleChange({
        tenantId,
        programId: validated.program_id,
        programName: validated.program_name,
        changeDescription: validated.change_description,
      });
      break;

    case 'training_reminder':
      result = await notifyTrainingReminder({
        tenantId,
        traineeId: validated.trainee_id,
        programName: validated.program_name,
        sessionDate: validated.session_date,
        sessionTime: validated.session_time,
        location: validated.location,
      });
      break;

    case 'training_completion':
      result = await notifyTrainingCompletion({
        tenantId,
        traineeId: validated.trainee_id,
        programName: validated.program_name,
        certificateUrl: validated.certificate_url,
      });
      break;

    default:
      return errorResponse('Unknown notification type', 400);
  }

  return successResponse(result, 'Notification dispatched');
});
