import { supabaseAdmin } from '@/lib/supabase-admin';
import { db, DatabaseError } from '@/lib/db';

/**
 * Data synchronization utilities for maintaining consistency between
 * the denormalized trainees table and the authoritative enrollments table.
 * 
 * This module provides functions to clean up stale data that can lead to
 * false-positive conflict errors in the trainee registration system.
 */

export class DataSyncService {
  /**
   * Synchronize the trainees.program_id field based on the authoritative
   * enrollments table state. This progressively cleans up stale program_id
   * values that may cause false-positive enrollment conflicts.
   * 
   * Logic:
   * 1. Query enrollments table for this trainee: status IN ('enrolled', 'active', 'inactive')
   * 2. If incomplete enrollment exists: set trainees.program_id = latest incomplete enrollment's program_id
   * 3. If no incomplete enrollment exists: set trainees.program_id = null
   * 4. Update trainees record with new program_id value
   * 
   * Edge Cases Handled:
   * - Trainee doesn't exist: silently return (no update needed)
   * - No enrollments: set program_id to null
   * - Multiple incomplete enrollments: use the latest one (most recent)
   * - Database errors: log and rethrow with context
   * 
   * Benefits:
   * - Prevents future false-positive enrollment conflicts
   * - Improves data integrity between denormalized tables
   * - Maintains consistency across system
   * - Useful for progressive cleanup during normal operations
   * 
   * When to Call:
   * - After creating new enrollment
   * - After updating enrollment status (complete/drop/fail)
   * - Optional: periodic background job for preventive maintenance
   * 
   * @param traineeId - The ID of the trainee to synchronize
   * @param tenantId - The tenant ID for scoping and validation
   * @returns Object with sync result (updated: boolean, oldProgramId: string | null, newProgramId: string | null)
   * @throws DatabaseError if database operations fail
   * 
   * Example:
   * ```
   * // After marking an enrollment as completed
   * const result = await dataSyncService.syncTraineeProgramId(traineeId, tenantId);
   * console.log(`Updated trainee program_id: ${result.oldProgramId} → ${result.newProgramId}`);
   * 
   * // After creating a new enrollment
   * await dataSyncService.syncTraineeProgramId(traineeId, tenantId);
   * ```
   */
  async syncTraineeProgramId(
    traineeId: string,
    tenantId: string
  ): Promise<{
    updated: boolean;
    oldProgramId: string | null;
    newProgramId: string | null;
    incompleteEnrollmentCount: number;
  }> {
    try {
      // Step 1: Query enrollments table for incomplete enrollments (status IN ('enrolled', 'active'))
      // NOTE: 'inactive' is explicitly NOT included here - it's a terminal status for enrollment blocking purposes
      // Only 'enrolled' and 'active' are considered incomplete for registration purposes
      const { data: incompleteEnrollments, error: queryError } = await supabaseAdmin
        .from('enrollments')
        .select('id, program_id, status, created_at')
        .eq('trainee_id', traineeId)
        .eq('tenant_id', tenantId)
        .in('status', ['enrolled', 'active'])
        .order('created_at', { ascending: false });

      if (queryError) {
        console.error('[DataSync] Error querying incomplete enrollments:', {
          trainee_id: traineeId,
          tenant_id: tenantId,
          error: queryError.message,
        });
        throw new DatabaseError(
          `Failed to query enrollments for trainee ${traineeId}: ${queryError.message}`,
          queryError.code
        );
      }

      // Determine the new program_id value
      // If incomplete enrollments exist, use the latest one; otherwise, set to null
      const newProgramId =
        incompleteEnrollments && incompleteEnrollments.length > 0
          ? incompleteEnrollments[0].program_id
          : null;

      // Step 2: Get the current trainee record to check if update is needed
      const { data: trainee, error: traineeError } = await supabaseAdmin
        .from('trainees')
        .select('id, program_id')
        .eq('id', traineeId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (traineeError) {
        console.error('[DataSync] Error fetching trainee record:', {
          trainee_id: traineeId,
          tenant_id: tenantId,
          error: traineeError.message,
        });
        throw new DatabaseError(
          `Failed to fetch trainee ${traineeId}: ${traineeError.message}`,
          traineeError.code
        );
      }

      // If trainee doesn't exist, silently return (nothing to sync)
      if (!trainee) {
        console.log('[DataSync] Trainee not found, nothing to sync:', {
          trainee_id: traineeId,
          tenant_id: tenantId,
        });
        return {
          updated: false,
          oldProgramId: null,
          newProgramId: null,
          incompleteEnrollmentCount: incompleteEnrollments?.length || 0,
        };
      }

      const oldProgramId = trainee.program_id;

      // Step 3: Only update if the value has changed (prevent unnecessary updates)
      if (oldProgramId === newProgramId) {
        console.log('[DataSync] Program ID already in sync, no update needed:', {
          trainee_id: traineeId,
          tenant_id: tenantId,
          program_id: newProgramId,
        });
        return {
          updated: false,
          oldProgramId,
          newProgramId,
          incompleteEnrollmentCount: incompleteEnrollments?.length || 0,
        };
      }

      // Step 4: Update trainees record with new program_id value
      const { error: updateError } = await supabaseAdmin
        .from('trainees')
        .update({ program_id: newProgramId })
        .eq('id', traineeId)
        .eq('tenant_id', tenantId);

      if (updateError) {
        console.error('[DataSync] Error updating trainee program_id:', {
          trainee_id: traineeId,
          tenant_id: tenantId,
          old_program_id: oldProgramId,
          new_program_id: newProgramId,
          error: updateError.message,
        });
        throw new DatabaseError(
          `Failed to update trainee ${traineeId} program_id: ${updateError.message}`,
          updateError.code
        );
      }

      console.log('[DataSync] Successfully synced trainee program_id:', {
        trainee_id: traineeId,
        tenant_id: tenantId,
        old_program_id: oldProgramId,
        new_program_id: newProgramId,
        incomplete_enrollment_count: incompleteEnrollments?.length || 0,
      });

      return {
        updated: true,
        oldProgramId,
        newProgramId,
        incompleteEnrollmentCount: incompleteEnrollments?.length || 0,
      };
    } catch (error: any) {
      console.error('[DataSync] Unexpected error in syncTraineeProgramId:', {
        trainee_id: traineeId,
        tenant_id: tenantId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Bulk synchronize program_id values for all trainees in a tenant.
   * This is useful for periodic maintenance jobs or migrating after deployment.
   * 
   * This function:
   * 1. Queries all trainees in the tenant
   * 2. For each trainee, calls syncTraineeProgramId to update program_id
   * 3. Collects and reports results
   * 4. Handles errors gracefully (continues on individual failures)
   * 
   * Use Cases:
   * - Run as a periodic background job (e.g., nightly)
   * - Run after deploying the fix to clean up stale data
   * - Run after bulk enrollment operations
   * 
   * @param tenantId - The tenant ID to process
   * @param options - Optional configuration
   * @returns Object with summary of syncs performed
   * @throws DatabaseError if critical errors occur
   */
  async syncAllTraineeProgramIds(
    tenantId: string,
    options?: {
      dryRun?: boolean;
      batchSize?: number;
      onProgress?: (current: number, total: number) => void;
    }
  ): Promise<{
    totalTrainees: number;
    synced: number;
    skipped: number;
    errors: Array<{ traineeId: string; error: string }>;
  }> {
    const dryRun = options?.dryRun || false;
    const batchSize = options?.batchSize || 50;

    try {
      console.log('[DataSync] Starting bulk sync of program_id values:', {
        tenant_id: tenantId,
        dry_run: dryRun,
        batch_size: batchSize,
      });

      // Query all trainees in the tenant
      const { data: trainees, error: queryError } = await supabaseAdmin
        .from('trainees')
        .select('id')
        .eq('tenant_id', tenantId);

      if (queryError) {
        throw new DatabaseError(
          `Failed to query trainees for tenant ${tenantId}: ${queryError.message}`,
          queryError.code
        );
      }

      const totalTrainees = trainees?.length || 0;
      let synced = 0;
      let skipped = 0;
      const errors: Array<{ traineeId: string; error: string }> = [];

      if (totalTrainees === 0) {
        console.log('[DataSync] No trainees found in tenant:', { tenant_id: tenantId });
        return { totalTrainees: 0, synced: 0, skipped: 0, errors: [] };
      }

      // Process in batches
      for (let i = 0; i < totalTrainees; i += batchSize) {
        const batch = trainees!.slice(i, i + batchSize);

        for (const trainee of batch) {
          try {
            if (dryRun) {
              console.log('[DataSync] [DRY RUN] Would sync trainee:', {
                trainee_id: trainee.id,
                tenant_id: tenantId,
              });
              skipped++;
            } else {
              const result = await this.syncTraineeProgramId(trainee.id, tenantId);
              if (result.updated) {
                synced++;
              } else {
                skipped++;
              }
            }
          } catch (error: any) {
            console.error('[DataSync] Error syncing individual trainee:', {
              trainee_id: trainee.id,
              tenant_id: tenantId,
              error: error.message,
            });
            errors.push({
              traineeId: trainee.id,
              error: error.message,
            });
          }
        }

        // Report progress
        if (options?.onProgress) {
          options.onProgress(Math.min(i + batchSize, totalTrainees), totalTrainees);
        }
      }

      console.log('[DataSync] Completed bulk sync of program_id values:', {
        tenant_id: tenantId,
        total_trainees: totalTrainees,
        synced,
        skipped,
        errors: errors.length,
      });

      return { totalTrainees, synced, skipped, errors };
    } catch (error: any) {
      console.error('[DataSync] Critical error in bulk sync:', {
        tenant_id: tenantId,
        error: error.message,
      });
      throw error;
    }
  }
}

export const dataSyncService = new DataSyncService();
