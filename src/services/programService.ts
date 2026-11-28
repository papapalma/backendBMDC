import { supabaseAdmin } from '@/lib/supabase-admin';
import { chunkIds, fetchAllRows } from '@/lib/supabasePagination';
import { db } from '@/lib/db';
import { Program } from '@/types';
import { CreateProgramInput, UpdateProgramInput } from '@/utils/validators';
import { deleteImageWithThumbnail, ensureThumbnailForImagePath } from '@/utils/fileUpload';

export class ProgramService {
  private async withThumbnail(program: Program): Promise<Program> {
    return {
      ...program,
      thumbnail_path: await ensureThumbnailForImagePath(program.image_path ?? null),
    };
  }

  /**
   * Get the current enrollment count for a program (enrolled status only)
   * Only counts enrollments with 'enrolled' status
   * 
   * @param programId - UUID of the program
   * @param tenantId - UUID of the tenant
   * @returns Number of enrolled trainees, 0 if program not found
   */
  async getCurrentEnrollmentCount(programId: string, tenantId: string): Promise<number> {
    const { count, error } = await supabaseAdmin
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('program_id', programId)
      .eq('tenant_id', tenantId)
      .eq('status', 'enrolled');

    if (error) throw new Error(`Failed to count enrollments: ${error.message}`);
    return count || 0;
  }

  /**
   * Validate that the new enrollment limit is not below current enrollment count
   * 
   * @param programId - UUID of the program
   * @param newEnrollmentLimit - The new enrollment limit value
   * @param tenantId - UUID of the tenant
   * @returns Object with validation result and optional error message
   */
  async validateEnrollmentLimitUpdate(
    programId: string,
    newEnrollmentLimit: number,
    tenantId: string
  ): Promise<{ valid: boolean; error?: string }> {
    // Get current enrollment count
    const currentEnrollment = await this.getCurrentEnrollmentCount(programId, tenantId);

    // Check: newEnrollmentLimit >= currentEnrollment
    if (newEnrollmentLimit < currentEnrollment) {
      return {
        valid: false,
        error: `Enrollment limit cannot be lower than current enrollment count (${currentEnrollment} trainees already enrolled)`,
      };
    }

    return { valid: true };
  }

  /**
   * Enrich a program or array of programs with current enrollment count (and
   * optionally staff-only registration counts) using batched queries instead of
   * per-program N+1 roundtrips.
   *
   * @param programs - Single program or array of programs
   * @param options - Optional enrichment flags (includeRegistrationCounts is strictly RBAC-gated by callers)
   * @returns Program(s) with current_enrollment (and optionally total_registrations) added
   */
  async enrichProgramWithEnrollment(
    programs: Program | Program[],
    options?: { includeRegistrationCounts?: boolean }
  ): Promise<Program | Program[]> {
    const isArray = Array.isArray(programs);
    const programsList = isArray ? programs : [programs];

    if (programsList.length === 0) {
      return isArray ? [] : programs;
    }

    const programIds = programsList.map((p) => p.id).filter(Boolean);
    const includeRegistrations = options?.includeRegistrationCounts === true;

    const programChunks = chunkIds(programIds, 150);

    const enrollmentsPromise = Promise.all(
      programChunks.map((progChunk) =>
        fetchAllRows<{ program_id: string; tenant_id?: string | null }>(() =>
          supabaseAdmin
            .from('enrollments')
            .select('program_id, tenant_id')
            .in('program_id', progChunk)
            .eq('status', 'enrolled')
        )
      )
    )
      .then((batches) => ({ data: batches.flat(), error: null as Error | null }))
      .catch((error: Error) => ({ data: null, error }));

    const registrationsPromise = includeRegistrations
      ? Promise.all(
          programChunks.map((progChunk) =>
            fetchAllRows<any>(() =>
              supabaseAdmin
                .from('enrollments')
                .select('program_id, trainee_id, trainee:trainees!inner(id, tenant_id, registration_status)')
                .in('program_id', progChunk)
                .in('trainee.registration_status', ['pending', 'approved'])
            )
          )
        )
          .then((batches) => ({ data: batches.flat(), error: null as Error | null }))
          .catch((error: Error) => ({ data: null, error }))
      : Promise.resolve({ data: null, error: null });

    const [enrollmentsRes, registrationsRes] = await Promise.all([
      enrollmentsPromise,
      registrationsPromise,
    ]);

    if (enrollmentsRes.error) {
      throw new Error(`Failed to count enrollments: ${enrollmentsRes.error.message}`);
    }

    // Count enrollments keyed by (tenant_id, program_id) to preserve strict tenant isolation
    const enrollmentCountsByTenantAndProgram = new Map<string, number>();
    const enrollmentCountsByProgram = new Map<string, number>();
    for (const row of (enrollmentsRes.data || []) as Array<{ program_id: string; tenant_id?: string | null }>) {
      enrollmentCountsByProgram.set(
        row.program_id,
        (enrollmentCountsByProgram.get(row.program_id) || 0) + 1
      );
      if (row.tenant_id) {
        const key = `${row.tenant_id}:${row.program_id}`;
        enrollmentCountsByTenantAndProgram.set(
          key,
          (enrollmentCountsByTenantAndProgram.get(key) || 0) + 1
        );
      }
    }

    // Deduplicate registered trainees per (tenant_id, program_id) when requested
    const registeredTraineesByTenantAndProgram = new Map<string, Set<string>>();
    const registeredTraineesByProgram = new Map<string, Set<string>>();
    if (includeRegistrations && !registrationsRes.error && registrationsRes.data) {
      for (const row of registrationsRes.data as Array<{
        program_id: string;
        trainee_id: string;
        trainee: { id: string; tenant_id?: string | null; registration_status: string } | Array<{ id: string; tenant_id?: string | null; registration_status: string }>;
      }>) {
        const trainee = Array.isArray(row.trainee) ? row.trainee[0] : row.trainee;
        if (!trainee || !row.program_id || !row.trainee_id) continue;

        let byProg = registeredTraineesByProgram.get(row.program_id);
        if (!byProg) {
          byProg = new Set<string>();
          registeredTraineesByProgram.set(row.program_id, byProg);
        }
        byProg.add(row.trainee_id);

        if (trainee.tenant_id) {
          const key = `${trainee.tenant_id}:${row.program_id}`;
          let byTenantProg = registeredTraineesByTenantAndProgram.get(key);
          if (!byTenantProg) {
            byTenantProg = new Set<string>();
            registeredTraineesByTenantAndProgram.set(key, byTenantProg);
          }
          byTenantProg.add(row.trainee_id);
        }
      }
    }

    const enriched = programsList.map((program) => {
      const currentEnrollment = program.tenant_id
        ? (enrollmentCountsByTenantAndProgram.get(`${program.tenant_id}:${program.id}`) ?? 0)
        : (enrollmentCountsByProgram.get(program.id) ?? 0);

      if (!includeRegistrations) {
        return {
          ...program,
          current_enrollment: currentEnrollment,
        };
      }

      const totalRegistrations = program.tenant_id
        ? (registeredTraineesByTenantAndProgram.get(`${program.tenant_id}:${program.id}`)?.size ?? 0)
        : (registeredTraineesByProgram.get(program.id)?.size ?? 0);

      return {
        ...program,
        current_enrollment: currentEnrollment,
        total_registrations: totalRegistrations,
      };
    });

    return isArray ? enriched : enriched[0];
  }

  async getAllPrograms(filters?: {
    status?: string;
    search?: string;
    tenantId?: string;
    includeDeleted?: boolean;
  }): Promise<Program[]> {
    let query = supabaseAdmin
      .from('programs')
      .select('*');

    // Tenant isolation — filter by tenant_id when provided (Req 7.2, 7.3)

if (filters?.tenantId) {
      query = query.eq('tenant_id', filters.tenantId);
    }

    // Filter out soft-deleted items by default (exclude where deleted_at IS NOT NULL)
    if (!filters?.includeDeleted) {
      query = query.is('deleted_at', null);
    }

if (filters?.status) {
      query = query.eq('status', filters.status);
    }

if (filters?.search) {
      query = query.or(`name.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
    }
    
    query = query.order('start_date', { ascending: false });
    
    const { data, error } = await query;
    
    if (error) throw error;

    const programs = data || [];
    return Promise.all(programs.map((program) => this.withThumbnail(program as Program)));
  }

  async getProgramById(id: string, tenantId?: string): Promise<Program | null> {
    let query = supabaseAdmin
      .from('programs')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null); // Filter out soft-deleted programs

    // Tenant isolation — only return the program if it belongs to this tenant (Req 7.8)
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

const { data, error } = await query.maybeSingle();
    
    if (error && error.code !== 'PGRST116') throw error;

    if (!data) {
      return null;
    }

    return this.withThumbnail(data as Program);
  }

  async createProgram(programData: CreateProgramInput & { tenantId?: string }): Promise<Program> {
    const status = this.calculateProgramStatus(
      programData.start_date,
      programData.end_date
    );

    const { tenantId, ...rest } = programData as any;

    const newProgram = {
      ...rest,
      status,
      max_trainees: programData.max_trainees || 30,
      // Map camelCase tenantId → snake_case tenant_id for DB (Req 7.1)
      ...(tenantId ? { tenant_id: tenantId } : {}),
    };
    
    // Use supabaseAdmin to bypass RLS policies

const { data, error } = await supabaseAdmin
      .from('programs')
      .insert(newProgram)
      .select()
      .single();
    
    if (error) throw error;
    return this.withThumbnail(data);
  }

  async updateProgram(id: string, programData: UpdateProgramInput): Promise<Program> {
    const existingProgram = await this.getProgramById(id);
    if (!existingProgram) {
      throw new Error('Program not found');
    }

const updateData: any = { ...programData };
    
    if (programData.start_date || programData.end_date) {
      const startDate = programData.start_date || existingProgram.start_date;
      const endDate = programData.end_date || existingProgram.end_date;
      updateData.status = this.calculateProgramStatus(startDate, endDate);
    }

    // NEW: When program status changes to 'completed', auto-complete all incomplete enrollments for this program
    if (updateData.status === 'completed' && existingProgram.status !== 'completed') {
      console.log('[ProgramService] Program marked as completed, auto-completing all related enrollments', {
        program_id: id,
        tenant_id: existingProgram.tenant_id,
      });

      const completionDate = new Date().toISOString().split('T')[0];

      const { error: enrollmentError } = await supabaseAdmin
        .from('enrollments')
        .update({
          status: 'completed',
          completion_date: completionDate,
          updated_at: new Date().toISOString(),
        })
        .eq('program_id', id)
        .in('status', ['enrolled', 'active']);

      if (enrollmentError) {
        console.error('[ProgramService] Failed to auto-complete enrollments for program', {
          program_id: id,
          error: enrollmentError.message,
        });
        // Log error but don't fail the program update - the program completion is more important
      } else {
        console.log('[ProgramService] Successfully auto-completed enrollments for program', {
          program_id: id,
        });
      }
    }

const imageWasUpdated = Object.prototype.hasOwnProperty.call(programData, 'image_path');
    const updatedProgram = await db.update<Program>('programs', id, updateData);

    if (
      imageWasUpdated &&
      existingProgram.image_path &&
      programData.image_path !== existingProgram.image_path
    ) {
      await deleteImageWithThumbnail(existingProgram.image_path);
    }

    return this.withThumbnail(updatedProgram);
  }

  async deleteProgram(id: string): Promise<void> {
    const existingProgram = await this.getProgramById(id);
    if (!existingProgram) {
      throw new Error('Program not found');
    }

    // Soft delete: set deleted_at timestamp instead of hard delete
    await db.update<Program>('programs', id, {
      deleted_at: new Date().toISOString(),
    });

    // Note: Images are retained for archival purposes; they're not deleted during soft delete
    // Images are only deleted on permanent purge from the archive
  }

  private calculateProgramStatus(
    startDate: string,
    endDate: string
  ): 'upcoming' | 'active' | 'completed' {
    const now = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (now < start) return 'upcoming';
    if (now > end) return 'completed';
    return 'active';
  }

  async getProgramStats(programId: string): Promise<{
    totalTrainees: number;
    activeTrainees: number;
    graduatedTrainees: number;
  }> {
    // Query enrollments table instead of trainees.program_id (3NF normalized)
    // Joins with trainees to get status information
    const { data: enrollments, error } = await supabaseAdmin
      .from('enrollments')
      .select('trainees(status)')
      .eq('program_id', programId)
      .in('status', ['enrolled', 'active', 'completed']);
    
    if (error) throw error;
    
    const traineeStatuses = enrollments?.map((e: any) => e.trainees?.status).filter(Boolean) || [];
    
    return {
      totalTrainees: traineeStatuses.length,
      activeTrainees: traineeStatuses.filter((s: string) => s === 'active').length,
      graduatedTrainees: traineeStatuses.filter((s: string) => s === 'completed').length,
    };
  }
}

export const programService = new ProgramService();
