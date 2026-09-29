/**
 * GET  /api/trainee-status/:id  — get trainee status record by ID (tenant-scoped)
 * PATCH  /api/trainee-status/:id  — update trainee status record (tenant-scoped)
 * DELETE /api/trainee-status/:id  — soft delete trainee status record (tenant-scoped)
 *
 * All operations require tenant context and appropriate role-based permissions.
 * PATCH and DELETE require 'local_admin' or 'staff_training_coordinator' role.
 * Soft deletes mark records with deleted_at timestamp, preserving audit trail.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { traineeStatusService } from '@/services/traineeStatusService';
import { updateTraineeStatusSchema } from '@/utils/validators';
import { successResponse, notFoundResponse, noContentResponse, forbiddenResponse, validationErrorResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { activityLogService } from '@/services/activityLogService';
import { logger } from '@/utils/logger';

// OPTIONS /api/trainee-status/:id - Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/trainee-status/:id - Get trainee status record by ID (tenant-scoped)
export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId } = ctxResult.context;
    const { id } = await params;

    try {
      const record = await traineeStatusService.getTraineeStatusById(id, tenantId);
      return successResponse(record);
    } catch (error) {
      logger.error('Failed to fetch trainee status record', { id, tenantId, error });
      return notFoundResponse('Trainee status record not found');
    }
  }
);

// PATCH /api/trainee-status/:id - Update trainee status record (tenant-scoped)
export const PATCH = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
    logger.info('PATCH: Request received');
    
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) {
      logger.info('PATCH: Authorization failed');
      return ctxResult.error as NextResponse;
    }

    const { tenantId, userId, role } = ctxResult.context;
    logger.info('PATCH: Authorization check passed', { userId, role });

    // Check permission
    if (!['local_admin', 'staff_training_coordinator'].includes(role)) {
      logger.info('PATCH: Insufficient permissions', { role });
      return forbiddenResponse('Insufficient permissions to update trainee status records');
    }

    const { id } = await params;

    try {
      // Verify record exists and belongs to current tenant
      const existing = await traineeStatusService.getTraineeStatusById(id, tenantId);
      if (!existing) {
        logger.info('PATCH: Record not found', { id, tenantId });
        return notFoundResponse('Trainee status record not found');
      }

      // Parse body (consumed once - result stored and reused)
      logger.info('PATCH: About to parse request body');
      const body = await request.json();
      logger.info('PATCH: Request body parsed', { bodyKeys: Object.keys(body) });
      
      const validatedData = updateTraineeStatusSchema.parse(body);
      logger.info('PATCH: Validation passed', { validatedFields: Object.keys(validatedData) });

      // Update trainee status record
      const updated = await traineeStatusService.updateTraineeStatus(id, {
        ...validatedData,
        tenantId,
        lastUpdatedBy: userId,
      });
      logger.info('PATCH: Service call completed, record updated', {
        recordId: id,
        updatedFields: Object.keys(validatedData),
      });

      // Log activity (non-blocking - failures won't affect response to client)
      try {
        await activityLogService.logAction(userId, 'update', 'trainee_status_record', id, {
          tenantId,
          changes: validatedData,
        });
        logger.info('PATCH: Activity logged successfully');
      } catch (logError) {
        logger.warn('PATCH: Failed to log activity, but proceeding with response', { logError });
      }

      // Prepare response object before returning
      const response = successResponse(updated, 'Trainee status record updated successfully');
      logger.info('PATCH: Response prepared, about to return with status 200');
      
      return response;
    } catch (error: any) {
      logger.error('PATCH: Failed to update trainee status record', { id, tenantId, error });

      // Handle validation errors
      if (error.name === 'ZodError') {
        logger.info('PATCH: Validation error encountered');
        const errorMap: Record<string, string[]> = {};
        error.errors.forEach((err: any) => {
          const path = err.path.join('.');
          if (!errorMap[path]) {
            errorMap[path] = [];
          }
          errorMap[path].push(err.message);
        });
        return validationErrorResponse(errorMap);
      }

      logger.error('PATCH: Unhandled error, rethrowing', { error });
      throw error;
    }
  }
);

// DELETE /api/trainee-status/:id - Soft delete trainee status record (tenant-scoped)
export const DELETE = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> => {
    logger.info('DELETE: Request received');
    
    const ctxResult = requireTenantContext(request);
    if (ctxResult.error) {
      logger.info('DELETE: Authorization failed');
      return ctxResult.error as NextResponse;
    }

    const { tenantId, userId, role } = ctxResult.context;
    logger.info('DELETE: Authorization check passed', { userId, role });

    // Check permission - require admin or training coordinator
    if (!['local_admin', 'staff_training_coordinator'].includes(role)) {
      logger.info('DELETE: Insufficient permissions', { role });
      return forbiddenResponse('Insufficient permissions to delete trainee status records');
    }

    const { id } = await params;

    try {
      // Verify record exists and belongs to current tenant
      const existing = await traineeStatusService.getTraineeStatusById(id, tenantId);
      if (!existing) {
        logger.info('DELETE: Record not found', { id, tenantId });
        return notFoundResponse('Trainee status record not found');
      }
      logger.info('DELETE: Record verified for soft-delete', { recordId: id });

      // Soft delete the trainee status record
      await traineeStatusService.deleteTraineeStatus(id, tenantId);
      logger.info('DELETE: Service call completed, record soft-deleted', { recordId: id });

      // Log activity (non-blocking - failures won't affect response to client)
      try {
        await activityLogService.logAction(userId, 'delete', 'trainee_status_record', id, undefined, undefined, tenantId);
        logger.info('DELETE: Activity logged successfully');
      } catch (logError) {
        logger.warn('DELETE: Failed to log activity, but proceeding with response', { logError });
      }

      // Prepare response object before returning
      const response = noContentResponse();
      logger.info('DELETE: Response prepared, about to return with status 204');
      
      return response;
    } catch (error) {
      logger.error('DELETE: Failed to delete trainee status record', { id, tenantId, error });
      throw error;
    }
  }
);
