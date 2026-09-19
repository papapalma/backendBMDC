/**
 * POST /api/admin/migrations/enrollment-requirements
 *
 * Migration endpoint for enrollment requirements system.
 *
 * Handles:
 * 1. Ensuring requirement_definitions are populated with 7 core types
 * 2. Migrating existing enrollments to enrollment_requirements
 * 3. Verifying migration completion
 *
 * Task 6.3: Create data migration to link existing requirements to definitions
 *
 * Requires: admin role
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireTenantContext } from '@/middleware/tenantContext';

import { successResponse, forbiddenResponse, errorResponse } from '@/utils/responses';

import { withErrorHandler } from '@/middleware/errorHandler';

import {
  ensureRequirementDefinitions,
  migrateExistingEnrollments,
  verifyMigration,
} from '@/services/enrollmentRequirementMigrationService';

import { z } from 'zod';

const migrationRequestSchema = z.object({
  action: z.enum(['ensure_definitions', 'migrate_enrollments', 'verify', 'full']),
  tenantId: z.string().uuid().optional(),
});

/**
 * POST /api/admin/migrations/enrollment-requirements
 *
 * Performs enrollment requirement data migration tasks
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  // Require tenant context
  const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role } = ctxResult.context;

  // Only admins can run migrations
  if (role !== 'local_admin') {
    return forbiddenResponse('Only administrators can run migrations');
  }

  const body = await request.json();
  const { action, tenantId: requestTenantId } = migrationRequestSchema.parse(body);

  // Use requested tenant ID if provided and user is admin, otherwise use context tenant
  const targetTenantId = requestTenantId || tenantId;

  try {
    switch (action) {
      case 'ensure_definitions': {
        console.log(`[Migration] Ensuring requirement definitions for tenant ${targetTenantId}`);

        const result = await ensureRequirementDefinitions(targetTenantId);

        return successResponse(
          {
            action: 'ensure_definitions',
            tenantId: targetTenantId,
            ...result,
          },
          `${result.created} requirement definitions created, ${result.existing} already exist`
        );
      }

      case 'migrate_enrollments': {
        console.log(`[Migration] Migrating existing enrollments for tenant ${targetTenantId}`);

        const result = await migrateExistingEnrollments(targetTenantId);

        return successResponse(
          {
            action: 'migrate_enrollments',
            tenantId: targetTenantId,
            ...result,
          },
          `${result.requirementsCreated} enrollment requirements created for ${result.enrollmentsProcessed} enrollments`
        );
      }

      case 'verify': {
        console.log(`[Migration] Verifying migration for tenant ${targetTenantId}`);

        const result = await verifyMigration(targetTenantId);

        const message = result.isComplete
          ? `Migration complete: ${result.totalCreatedRequirements} requirements created`
          : `Migration incomplete: ${result.missingRequirements} requirements missing`;

        return successResponse(
          {
            action: 'verify',
            tenantId: targetTenantId,
            ...result,
          },
          message
        );
      }

      case 'full': {
        console.log(`[Migration] Running full migration for tenant ${targetTenantId}`);

        // Step 1: Ensure definitions exist
        console.log('Step 1: Ensuring requirement definitions...');
        const defResult = await ensureRequirementDefinitions(targetTenantId);

        // Step 2: Migrate enrollments
        console.log('Step 2: Migrating existing enrollments...');
        const migResult = await migrateExistingEnrollments(targetTenantId);

        // Step 3: Verify completion
        console.log('Step 3: Verifying migration...');
        const verifyResult = await verifyMigration(targetTenantId);

        return successResponse(
          {
            action: 'full',
            tenantId: targetTenantId,
            definitions: defResult,
            migration: migResult,
            verification: verifyResult,
          },
          verifyResult.isComplete ? 'Full migration completed successfully' : 'Migration completed with issues'
        );
      }

      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (error) {
    console.error('[Migration Error]', error);
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Migration failed: ${message}`, 500);
  }
});
