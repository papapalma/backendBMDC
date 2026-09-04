import { supabaseAdmin } from '@/lib/supabase-admin';
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
   * Get the current enrollment count for a program (active enrollments only)
   * Excludes dropped and cancelled enrollments
   * 
   * @param programId - UUID of the program
   * @param tenantId - UUID of the tenant
   * @returns Number of active enrollments, 0 if program not found
   */
  async getCurrentEnrollmentCount(programId: string, tenantId: string): Promise<number> {
    const { data, error } = await supabaseAdmin
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('program_id', programId)
      .eq('tenant_id', tenantId)
      .not('status', 'in', '(dropped,cancelled)');

    if (error) throw new Error(`Failed to count enrollments: ${error.message}`);
    return data?.length || 0;
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
   * Enrich a program or array of programs with current enrollment count
   * 
   * @param programs - Single program or array of programs
   * @returns Program(s) with current_enrollment field added
   */
  async enrichProgramWithEnrollment(
    programs: Program | Program[]
  ): Promise<Program | Program[]> {
    const isArray = Array.isArray(programs);
    const programsList = isArray ? programs : [programs];

    const enriched = await Promise.all(
      programsList.map(async (program) => {
        const currentEnrollment = await this.getCurrentEnrollmentCount(
          program.id,
          program.tenant_id || ''
        );
        return {
          ...program,
          current_enrollment: currentEnrollment,
        };
      })
    );

    return isArray ? enriched : enriched[0];
  }

  async getAllPrograms(filters?: {
    status?: string;
    search?: string;
    tenantId?: string;
  }): Promise<Program[]> {
    let query = supabaseAdmin
      .from('programs')
      .select('*');

    // Tenant isolation — filter by tenant_id when provided (Req 7.2, 7.3)

if (filters?.tenantId) {
      query = query.eq('tenant_id', filters.tenantId);
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
      .eq('id', id);

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
    await db.delete('programs', id);

    if (existingProgram?.image_path) {
      await deleteImageWithThumbnail(existingProgram.image_path);
    }
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
