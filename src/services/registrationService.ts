import { supabaseAdmin } from '@/lib/supabase-admin';
import { hashPassword } from '@/lib/auth';
import { PendingRegistration } from '@/types';
import { TraineeRegistrationInput } from '@/utils/validators';
import { TenantContext } from '@/middleware/tenantContext';
import {
  sendAccountApprovalConfirmationEmail,
  sendWelcomeEmail,
  sendRegistrationRejectionEmail,
} from './emailService';
import { getTenantConfiguration } from './tenantConfigurationService';
import { initializeEnrollmentRequirements } from './enrollmentRequirementService';

/**
 * Custom error class for HTTP 409 Conflict responses
 * Used when a trainee has an incomplete enrollment blocking new applications
 */
export class ConflictError extends Error {
  public statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class RegistrationService {
  private throwIfPendingRegistrationsMissing(error: any): void {
    const message = typeof error?.message === 'string' ? error.message : '';
    const isMissingTraineesTable =
      message.includes("public.trainees") ||
      message.includes("relation \"trainees\" does not exist");

    if (isMissingTraineesTable) {
      throw new Error(
        'Trainees table is not initialized. Ensure your database schema (Normalize_full_schema.sql) has been applied.'
      );
    }
  }

  /**
   * Check if a trainee has an incomplete enrollment in the same tenant.
   * 
   * BUGFIX: This function now queries the authoritative `enrollments` table instead of
   * the denormalized `trainees` table to avoid false-positive conflicts from stale
   * program_id values. An incomplete enrollment is defined as an enrollment record with
   * status IN ('enrolled', 'active'). Completed, dropped, or failed enrollments do not
   * block new applications.
   * 
   * Implementation Logic:
   * 1. Resolve trainee_id from trainees table using email + tenant_id (for foreign key)
   * 2. Query enrollments table with: WHERE trainee_id = ? AND tenant_id = ? AND status IN ('enrolled', 'active')
   * 3. Use select('*', { count: 'exact' }) to get count of incomplete enrollments
   * 4. Return true only if count > 0 (has incomplete enrollments)
   * 
   * Edge Cases Handled:
   * - If trainee_id resolution fails (trainee doesn't exist) → return false (allow registration)
   * - If enrollments table count = 0 → return false (allow registration) ← THIS FIXES THE BUG
   * - If enrollments table count > 0 → return true (block registration)
   * 
   * @param email - Trainee email (will be normalized to lowercase)
   * @param tenantId - Tenant ID to scope the lookup
   * @returns Object with hasIncompleteEnrollment flag and optional trainee data
   * @throws Error if database query fails
   * 
   * Requirements: 2.1, 2.2, 3.1
   */
  private async checkIncompleteEnrollment(
    email: string,
    tenantId: string
  ): Promise<{ hasIncompleteEnrollment: boolean; trainee?: any }> {
    try {
      // Step 1: Resolve trainee_id from trainees table using email + tenant_id
      const { data: existingTrainee, error: traineeError } = await supabaseAdmin
        .from('trainees')
        .select('id, email, status')
        .eq('tenant_id', tenantId)
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (traineeError) {
        console.error('[Registration] Database error during trainee lookup:', {
          email: email.toLowerCase(),
          tenant_id: tenantId,
          error: traineeError.message,
        });
        throw traineeError;
      }

      // If trainee doesn't exist yet, allow registration (no incomplete enrollments)
      if (!existingTrainee) {
        console.log('[Registration] Trainee not found (new trainee allowed to register)', {
          email: email.toLowerCase(),
          tenant_id: tenantId,
        });
        return {
          hasIncompleteEnrollment: false,
          trainee: undefined,
        };
      }

      console.log('[Registration] Trainee found, checking enrollments table for incomplete enrollments', {
        email: email.toLowerCase(),
        tenant_id: tenantId,
        trainee_id: existingTrainee.id,
        trainee_status: existingTrainee.status,
      });

      // Step 2-3: Query enrollments table with status IN ('enrolled', 'active') and get exact count
      const { count, error: enrollmentError } = await supabaseAdmin
        .from('enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('trainee_id', existingTrainee.id)
        .eq('tenant_id', tenantId)
        .in('status', ['enrolled', 'active']);

      if (enrollmentError) {
        console.error('[Registration] Database error during enrollments table query:', {
          email: email.toLowerCase(),
          tenant_id: tenantId,
          trainee_id: existingTrainee.id,
          error: enrollmentError.message,
        });
        throw enrollmentError;
      }

      // Step 4: Return true only if count > 0 (has incomplete enrollments)
      const hasIncompleteEnrollment = (count || 0) > 0;

      console.log('[Registration] Incomplete enrollment check result:', {
        email: email.toLowerCase(),
        tenant_id: tenantId,
        trainee_id: existingTrainee.id,
        incomplete_enrollment_count: count,
        has_incomplete_enrollment: hasIncompleteEnrollment,
        enrollment_statuses_checked: ['enrolled', 'active'],
      });

      return {
        hasIncompleteEnrollment,
        trainee: existingTrainee,
      };
    } catch (error: any) {
      console.error('[Registration] Error in checkIncompleteEnrollment:', error);
      throw error;
    }
  }

  /**
   * Submit a new trainee registration request (public - no auth)
   * Can be used for both new registrations and existing trainees applying to new programs
   * 
   * @param data Registration/application data
   * @param tenantId Tenant ID from the program
  /**
   * Select the active/pending target enrollment when a trainee has multiple historical enrollments.
   * Prioritizes 'enrolled' (pending approval) and 'active' over 'dropped'/'failed'/'completed',
   * breaking ties by the most recent updated_at / created_at / enrollment_date timestamp.
   */
  private pickTargetEnrollment(enrollments?: any[]): any | undefined {
    if (!Array.isArray(enrollments) || enrollments.length === 0) return undefined;
    if (enrollments.length === 1) return enrollments[0];

    const statusPriority: Record<string, number> = {
      enrolled: 3,
      active: 2,
      dropped: 1,
      failed: 1,
      completed: 0,
    };

    return [...enrollments].sort((a, b) => {
      const prioDiff = (statusPriority[b?.status] ?? -1) - (statusPriority[a?.status] ?? -1);
      if (prioDiff !== 0) return prioDiff;
      const timeA = new Date(a?.updated_at || a?.created_at || a?.enrollment_date || 0).getTime();
      const timeB = new Date(b?.updated_at || b?.created_at || b?.enrollment_date || 0).getTime();
      return timeB - timeA;
    })[0];
  }

  /**
   * Submit a new registration request into trainees table with registration_status = 'pending' (normalized schema)
   * @param data Registration input data
   * @param tenantId The tenant ID to assign to this registration
   * @param isExistingTrainee Whether this is an existing trainee applying to a new program (optional)
   */
  async submitRegistration(data: TraineeRegistrationInput, tenantId: string, isExistingTrainee: boolean = false, enrollmentSource: string = 'direct'): Promise<PendingRegistration> {
    console.log('[RegistrationService] submitRegistration called with:', {
      email: data.email,
      username: data.username,
      isExistingTrainee,
      tenantId,
      enrollmentSource,
    });

    // Look up any existing trainee record for (tenant_id, email) in the 3NF trainees table
    const { data: existingTrainee, error: existingTraineeError } = await supabaseAdmin
      .from('trainees')
      .select('id, user_id, registration_status, status, qr_code, deleted_at')
      .eq('email', data.email.toLowerCase())
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (existingTraineeError && existingTraineeError.code !== 'PGRST116') {
      this.throwIfPendingRegistrationsMissing(existingTraineeError);
      throw existingTraineeError;
    }

    console.log('[RegistrationService] Existing trainee registration found:', existingTrainee);

    if (existingTrainee) {
      if (!existingTrainee.deleted_at && existingTrainee.registration_status === 'pending') {
        throw new ConflictError(
          isExistingTrainee
            ? 'You already have a pending application for a program. Please wait for administrator review.'
            : 'A registration request with this email is already pending review.'
        );
      }
      if (
        !isExistingTrainee &&
        (existingTrainee.registration_status === 'approved' || existingTrainee.registration_status === 'completed')
      ) {
        throw new ConflictError('An account with this email already exists. Please log in.');
      }
    }

    const isReapplyingWithExistingRecord = Boolean(existingTrainee);

    // Only check for existing user account / username collisions if this is a brand-new trainee registration
    if (!isExistingTrainee && !isReapplyingWithExistingRecord) {
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', data.email.toLowerCase())
        .is('deleted_at', null)
        .maybeSingle();

      if (existingUser) {
        throw new ConflictError('An account with this email already exists. Please log in.');
      }

      const { data: existingUsername } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('username', data.username)
        .is('deleted_at', null)
        .maybeSingle();

      if (existingUsername) {
        throw new ConflictError('This username is already taken. Please choose another.');
      }
    }

    // ========== Check for incomplete enrollment in trainees/enrollments tables ==========
    // Before allowing a new registration, verify the trainee doesn't have an
    // active or enrolled program already. Completed/dropped/failed enrollments are
    // allowed since those trainees may be re-enrolling.
    const incompleteEnrollmentCheck = await this.checkIncompleteEnrollment(
      data.email.toLowerCase(),
      tenantId
    );

    if (incompleteEnrollmentCheck.hasIncompleteEnrollment) {
      const trainee = incompleteEnrollmentCheck.trainee;
      console.log('[Registration] CONFLICT: Incomplete enrollment blocks application', {
        email: data.email.toLowerCase(),
        program_id: data.program_id,
        existing_trainee_id: trainee?.id,
        existing_status: trainee?.status,
        tenant_id: tenantId,
        timestamp: new Date().toISOString(),
      });

      throw new ConflictError(
        'You are already enrolled in an incomplete program. Please complete or drop your current program before applying to a new one.'
      );
    }

    // Check if the existing trainee already has an enrollment row for the target program
    let existingProgramEnrollment: { id: string; status: string } | null = null;
    if (existingTrainee && data.program_id) {
      const { data: progEnrollment, error: progEnrollmentError } = await supabaseAdmin
        .from('enrollments')
        .select('id, status')
        .eq('trainee_id', existingTrainee.id)
        .eq('program_id', data.program_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (progEnrollmentError && progEnrollmentError.code !== 'PGRST116') {
        throw progEnrollmentError;
      }

      if (progEnrollment) {
        if (progEnrollment.status === 'completed') {
          throw new ConflictError('You have already completed this program.');
        }
        if (progEnrollment.status === 'enrolled' || progEnrollment.status === 'active') {
          throw new ConflictError('You are already enrolled in this program.');
        }
        // status is 'dropped' or 'failed' -> eligible for reactivation
        existingProgramEnrollment = progEnrollment;
      }
    }

    // Hash password (if provided) and resolve user account
    const hashedPassword = await hashPassword(data.password || '');
    let userId: string | null = existingTrainee?.user_id || null;

    if (!isExistingTrainee && !isReapplyingWithExistingRecord) {
      const { data: newUser, error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          email: data.email.toLowerCase(),
          username: data.username,
          password_hash: hashedPassword,
          role: 'trainee',
        })
        .select('id')
        .single();

      if (userError) {
        console.error('[Registration] Failed to create user account:', userError);
        throw userError;
      }
      userId = newUser.id;
      console.log('[Registration] User account created in users table:', { userId, email: data.email });
    } else if (!userId) {
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', data.email.toLowerCase())
        .is('deleted_at', null)
        .maybeSingle();
      userId = existingUser?.id || null;
    }

    let trainee: any;

    if (existingTrainee) {
      // Respect DB trigger enforce_registration_transitions (approved -> completed -> pending)
      if (existingTrainee.registration_status === 'approved') {
        await supabaseAdmin
          .from('trainees')
          .update({ registration_status: 'completed' })
          .eq('id', existingTrainee.id);
      }

      // Reuse existing trainee record to respect UNIQUE(tenant_id, email) in 3NF schema
      const { data: updatedTrainee, error: updateError } = await supabaseAdmin
        .from('trainees')
        .update({
          user_id: userId,
          first_name: data.first_name,
          last_name: data.last_name,
          middle_name: data.middle_name || '',
          phone: data.phone,
          sex: data.sex,
          birth_date: data.birth_date,
          birth_place: data.birth_place,
          civil_status: data.civil_status,
          province: data.province,
          municipality: data.municipality,
          barangay: data.barangay,
          street: data.street,
          educational_attainment: data.educational_attainment,
          course: data.course,
          year_graduated: data.year_graduated,
          classification: data.classification,
          disability: data.disability || null,
          employment_status: data.employment_status,
          registration_status: 'pending',
          registration_rejection_reason: null,
          registration_reviewed_by: null,
          registration_reviewed_at: null,
          status: 'inactive', // Required by enforce_trainee_status_consistency while registration_status != 'completed'
          deleted_at: null, // Restore soft-deleted trainee row on re-enrollment
        })
        .eq('id', existingTrainee.id)
        .select()
        .single();

      if (updateError) {
        this.throwIfPendingRegistrationsMissing(updateError);
        throw updateError;
      }
      trainee = updatedTrainee;
    } else {
      // Brand-new trainee in this tenant: insert new trainees row
      const { data: insertedTrainee, error } = await supabaseAdmin
        .from('trainees')
        .insert({
          tenant_id: tenantId,
          user_id: userId,
          email: data.email.toLowerCase(),
          first_name: data.first_name,
          last_name: data.last_name,
          middle_name: data.middle_name || '',
          phone: data.phone,
          sex: data.sex,
          birth_date: data.birth_date,
          birth_place: data.birth_place,
          civil_status: data.civil_status,
          province: data.province,
          municipality: data.municipality,
          barangay: data.barangay,
          street: data.street,
          educational_attainment: data.educational_attainment,
          course: data.course,
          year_graduated: data.year_graduated,
          classification: data.classification,
          disability: data.disability || null,
          employment_status: data.employment_status,
          registration_status: 'pending',  // Mark as pending approval
          status: 'inactive',  // Inactive until registration is approved and completed
          consent_given: false,
          is_verified: true,  // Verified via OTP step 6
        })
        .select()
        .single();

      if (error) {
        this.throwIfPendingRegistrationsMissing(error);
        throw error;
      }
      trainee = insertedTrainee;
    }

    // Populate pending credential tables only for new trainee accounts
    if (!isExistingTrainee && !existingTrainee?.user_id) {
      try {
        await supabaseAdmin
          .from('pending_registration_usernames')
          .upsert(
            {
              trainee_id: trainee.id,
              username: data.username,
            },
            { onConflict: 'trainee_id' }
          );

        await supabaseAdmin
          .from('pending_registration_passwords')
          .upsert(
            {
              trainee_id: trainee.id,
              password_hash: hashedPassword,
            },
            { onConflict: 'trainee_id' }
          );
      } catch (legacyErr) {
        console.warn('[Registration] Warning upserting legacy pending tables:', legacyErr);
      }
    }

    const today = new Date().toISOString().split('T')[0];
    let enrollment: any;

    if (existingProgramEnrollment) {
      // Reactivate previously dropped/failed enrollment row to respect UNIQUE(trainee_id, program_id)
      const { data: reactivatedEnrollment, error: reactivateError } = await supabaseAdmin
        .from('enrollments')
        .update({
          enrollment_date: today,
          completion_date: null,
          source: enrollmentSource,
          status: 'enrolled',
        })
        .eq('id', existingProgramEnrollment.id)
        .select()
        .single();

      if (reactivateError) {
        console.error('[Registration] Failed to reactivate enrollment record:', reactivateError);
        throw reactivateError;
      }
      enrollment = reactivatedEnrollment;
    } else {
      // Create new enrollment record with the specified enrollment source
      const { data: newEnrollment, error: enrollmentError } = await supabaseAdmin
        .from('enrollments')
        .insert({
          tenant_id: tenantId,
          trainee_id: trainee.id,
          program_id: data.program_id,
          enrollment_date: today,
          source: enrollmentSource,
          status: 'enrolled',
        })
        .select()
        .single();

      if (enrollmentError) {
        console.error('[Registration] Failed to create enrollment record:', enrollmentError);
        throw enrollmentError;
      }
      enrollment = newEnrollment;
    }

    try {
      await initializeEnrollmentRequirements(enrollment.id, trainee.id, tenantId);
    } catch (reqErr) {
      console.warn('[Registration] Warning initializing enrollment requirements:', reqErr);
    }

    console.log('[Registration] Trainee registration created (pending approval):', {
      trainee_id: trainee.id,
      email: data.email.toLowerCase(),
      registration_status: 'pending',
      enrollment_source: enrollmentSource,
    });

    // Return trainee data in a format compatible with the API response
    const registration = {
      ...trainee,
      // For API compatibility, include program info from input
      program: { id: data.program_id },
      is_existing_trainee: isExistingTrainee,
      enrollment_source: enrollmentSource,
    };

    return registration;
  }

  /**
   * Get all pending registrations (admin/staff only)
   * Queries trainees table with registration_status = 'pending' (normalized schema)
   */
  async getAllRegistrations(context: TenantContext | null, filters?: { status?: string; search?: string }): Promise<PendingRegistration[]> {
    let query = supabaseAdmin
      .from('trainees')
      .select(`
        id,
        tenant_id,
        email,
        first_name,
        last_name,
        middle_name,
        phone,
        sex,
        birth_date,
        birth_place,
        civil_status,
        province,
        municipality,
        barangay,
        street,
        educational_attainment,
        course,
        year_graduated,
        classification,
        disability,
        employment_status,
        registration_status,
        registration_rejection_reason,
        registration_reviewed_by,
        registration_reviewed_at,
        created_at,
        updated_at,
        users:users!trainees_user_id_fkey(id, username),
        enrollments(id, program_id, status, enrollment_date, created_at, updated_at, programs(id, name, description, start_date, end_date, status))
      `)
      .order('created_at', { ascending: false });

    // Handle status filtering: 'all' returns all, otherwise filter by status or default to 'pending'
    if (filters?.status && filters.status !== 'all') {
      query = query.eq('registration_status', filters.status);
    } else if (!filters?.status) {
      query = query.eq('registration_status', 'pending');
    }

    // Apply tenant filtering for non-super-admin users
    if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

    if (filters?.search) {
      query = query.or(
        `first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
      );
    }

    const { data, error } = await query;
    if (error) {
      this.throwIfPendingRegistrationsMissing(error);
      throw error;
    }

    // Normalize returned rows for frontend compatibility
    return (data || []).map((row: any) => {
      const targetEnrollment = this.pickTargetEnrollment(row.enrollments);
      return {
        ...row,
        status: row.registration_status || row.status || 'pending',
        username: row.users?.username || row.username || '',
        program: targetEnrollment?.programs || row.program || undefined,
        program_id: targetEnrollment?.program_id || row.program_id || undefined,
      };
    }) as PendingRegistration[];
  }

  /**
   * Get a single registration by trainee ID (normalized schema)
   */
  async getRegistrationById(context: TenantContext | null, id: string): Promise<PendingRegistration | null> {
    let query = supabaseAdmin
      .from('trainees')
      .select(`
        id,
        tenant_id,
        email,
        first_name,
        last_name,
        middle_name,
        phone,
        sex,
        birth_date,
        birth_place,
        civil_status,
        province,
        municipality,
        barangay,
        street,
        educational_attainment,
        course,
        year_graduated,
        classification,
        disability,
        employment_status,
        registration_status,
        registration_rejection_reason,
        registration_reviewed_by,
        registration_reviewed_at,
        created_at,
        updated_at,
        users:users!trainees_user_id_fkey(id, username),
        enrollments(id, program_id, status, enrollment_date, created_at, updated_at, programs(id, name, description, start_date, end_date, status))
      `)
      .eq('id', id);

    // Apply tenant filtering for non-super-admin users
    if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

    const { data, error } = await query.single();

    if (error && error.code !== 'PGRST116') {
      this.throwIfPendingRegistrationsMissing(error);
      throw error;
    }

    if (!data) return null;
    const { password_hash, ...safe } = data as any;
    const targetEnrollment = this.pickTargetEnrollment(safe.enrollments);
    return {
      ...safe,
      status: safe.registration_status || safe.status || 'pending',
      username: safe.users?.username || safe.username || '',
      program: targetEnrollment?.programs || safe.program || undefined,
      program_id: targetEnrollment?.program_id || safe.program_id || undefined,
    } as PendingRegistration;
  }

  /**
   * Get trainee's own registrations (for trainee-only access)
   */
  /**
   * Get trainee's own registrations (for trainee-only access)
   * Queries trainees table with pending registration status
   */
  async getTraineeRegistrations(email: string, tenantId?: string): Promise<PendingRegistration[]> {
    let query = supabaseAdmin
      .from('trainees')
      .select(`
        id,
        tenant_id,
        email,
        first_name,
        last_name,
        middle_name,
        phone,
        sex,
        birth_date,
        birth_place,
        civil_status,
        province,
        municipality,
        barangay,
        street,
        educational_attainment,
        course,
        year_graduated,
        classification,
        disability,
        employment_status,
        registration_status,
        registration_rejection_reason,
        registration_reviewed_by,
        registration_reviewed_at,
        created_at,
        updated_at,
        enrollments(id, program_id, status, enrollment_date, created_at, updated_at, programs(id, name, description, start_date, end_date, status))
      `)
      .eq('email', email.toLowerCase())
      .in('registration_status', ['pending', 'rejected']);

    // If tenantId is provided, scope to that tenant
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      this.throwIfPendingRegistrationsMissing(error);
      throw error;
    }

    return (data || []).map((row: any) => {
      const targetEnrollment = this.pickTargetEnrollment(row.enrollments);
      return {
        ...row,
        status: row.registration_status || row.status || 'pending',
        program: targetEnrollment?.programs || row.program || undefined,
        program_id: targetEnrollment?.program_id || row.program_id || undefined,
      };
    }) as PendingRegistration[];
  }

  /**
   * Approve a registration: handles two scenarios differently
   * 1. NEW TRAINEE: Creates user account + trainee profile + enrollment
   * 2. EXISTING TRAINEE: Only creates enrollment for new program
   * 
   * Sends confirmation and welcome emails (for new trainees) or enrollment confirmation (for existing trainees)
   */
  async approveRegistration(id: string, reviewerId: string): Promise<{ user: any; trainee: any }> {
    // Fetch trainee registration from trainees table
    // In normalized schema, pending_registrations merged into trainees table

    const { data: traineeReg, error: fetchError } = await supabaseAdmin
      .from('trainees')
      .select(`
        id,
        tenant_id,
        email,
        first_name,
        last_name,
        registration_status,
        created_at,
        enrollments(program_id, status, enrollment_date, created_at, updated_at)
      `)
      .eq('id', id)
      .single();

    if (fetchError) {
      this.throwIfPendingRegistrationsMissing(fetchError);
    }

    if (fetchError || !traineeReg) throw new Error('Registration not found');
    if (traineeReg.registration_status !== 'pending') throw new Error(`Registration is already ${traineeReg.registration_status}`);

    const targetEnrollment = this.pickTargetEnrollment(traineeReg.enrollments);

    console.log('[RegistrationService] approveRegistration: Processing registration', {
      trainee_id: id,
      email: traineeReg.email,
      program_id: targetEnrollment?.program_id,
    });

    // Update trainee record to mark registration as approved
    const reviewTimestamp = new Date().toISOString();
    const { error: approvalError } = await supabaseAdmin
      .from('trainees')
      .update({
        registration_status: 'approved',
        registration_reviewed_by: reviewerId,
        registration_reviewed_at: reviewTimestamp,
      })
      .eq('id', id);

    if (approvalError) throw approvalError;

    // Check if an active user account already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', traineeReg.email)
      .is('deleted_at', null)
      .maybeSingle();

    // If user doesn't exist, create one (new trainee flow)
    let user = existingUser;
    if (!user) {
      // Retrieve the password that trainee submitted during registration
      const { data: pendingPassword, error: passwordFetchError } = await supabaseAdmin
        .from('pending_registration_passwords')
        .select('password_hash')
        .eq('trainee_id', id)
        .single();

      if (passwordFetchError || !pendingPassword) {
        console.error('[RegistrationService] Pending password not found during approval:', {
          trainee_id: id,
          error: passwordFetchError?.message,
        });
        throw new Error('Registration password is missing. Please contact support.');
      }

      // Retrieve username that was stored during registration
      const { data: pendingUsername } = await supabaseAdmin
        .from('pending_registration_usernames')
        .select('username')
        .eq('trainee_id', id)
        .single();

      const username = pendingUsername?.username || traineeReg.email.split('@')[0];

      console.log('[Approval] Creating user account with username', {
        trainee_id: id,
        username: username,
        usernameSource: pendingUsername ? 'registration' : 'fallback',
      });

      // Create user account with the trainee's submitted password
      // Password is stored in users table (not trainees table)
      const { data: newUser, error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          email: traineeReg.email,
          username: username, // Use stored username, not email fallback
          role: 'trainee',
          password_hash: pendingPassword.password_hash, // Use the stored trainee password
        })
        .select()
        .single();

      if (userError) throw userError;
      user = newUser;

      console.log('[RegistrationService] New user created with trainee-provided password:', {
        email: traineeReg.email,
        user_id: user.id,
      });
    }

    // Ensure users_tenants association exists so trainee can login to their tenant
    const { data: existingUserTenant } = await supabaseAdmin
      .from('users_tenants')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('tenant_id', traineeReg.tenant_id)
      .maybeSingle();

    if (!existingUserTenant) {
      const { error: userTenantError } = await supabaseAdmin
        .from('users_tenants')
        .insert({
          user_id: user.id,
          tenant_id: traineeReg.tenant_id,
          is_primary: true,
        });

      if (userTenantError) {
        console.warn('[Approval] Failed to insert users_tenants (might already exist):', userTenantError);
      }
    }

    // Ensure trainee_accounts link exists (for backward compatibility and query efficiency)
    const { data: existingTraineeAccount } = await supabaseAdmin
      .from('trainee_accounts')
      .select('user_id')
      .eq('trainee_id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!existingTraineeAccount) {
      const { error: traineeAccountError } = await supabaseAdmin
        .from('trainee_accounts')
        .insert({
          tenant_id: traineeReg.tenant_id,
          trainee_id: id,
          user_id: user.id,
        });

      if (traineeAccountError) {
        console.warn('[Approval] Failed to insert trainee_accounts (might already exist):', traineeAccountError);
      }
    }

    // Delete any temporary password/username records
    try {
      await supabaseAdmin
        .from('pending_registration_passwords')
        .delete()
        .eq('trainee_id', id);

      await supabaseAdmin
        .from('pending_registration_usernames')
        .delete()
        .eq('trainee_id', id);
    } catch (cleanupErr) {
      console.warn('[Approval] Failed to clean up legacy pending tables:', cleanupErr);
    }

    // Complete the registration
    const { error: completeError } = await supabaseAdmin
      .from('trainees')
      .update({
        registration_status: 'completed',
        user_id: user.id,
        status: 'active',
        deleted_at: null, // Ensure approved trainee is not hidden by a prior soft-delete
      })
      .eq('id', id);

    if (completeError) throw completeError;

    // Send welcome email
    await sendAccountApprovalConfirmationEmail({
      tenantId: traineeReg.tenant_id,
      recipientEmail: traineeReg.email,
      traineeName: `${traineeReg.first_name} ${traineeReg.last_name}`,
      username: user.username || traineeReg.email,
      email: traineeReg.email,
      loginUrl: `${process.env.FRONTEND_URL}/login`,
    });

    // Send welcome email with platform overview
    await sendWelcomeEmail({
      tenantId: traineeReg.tenant_id,
      recipientEmail: traineeReg.email,
      traineeName: `${traineeReg.first_name} ${traineeReg.last_name}`,
      portalUrl: `${process.env.FRONTEND_URL}/dashboard`,
    });

    return { user, trainee: traineeReg };
  }

  /**
   * Reject a registration
   */
  async rejectRegistration(id: string, reviewerId: string, reason?: string): Promise<void> {
    const { data: trainee, error: fetchError } = await supabaseAdmin
      .from('trainees')
      .select('id, registration_status, email, first_name, last_name, tenant_id')
      .eq('id', id)
      .single();

    if (fetchError) {
      this.throwIfPendingRegistrationsMissing(fetchError);
    }

    if (fetchError || !trainee) throw new Error('Registration not found');
    if (trainee.registration_status !== 'pending') throw new ConflictError(`Registration is already ${trainee.registration_status}`);

    const reviewTimestamp = new Date().toISOString();
    const rejectionReason = reason || 'No reason provided';

    const { error } = await supabaseAdmin
      .from('trainees')
      .update({
        registration_status: 'rejected',
        registration_rejection_reason: rejectionReason,
        registration_reviewed_by: reviewerId,
        registration_reviewed_at: reviewTimestamp,
      })
      .eq('id', id);

    if (error) {
      // Handle state machine trigger violations gracefully
      const errorMsg = (error as any)?.message || JSON.stringify(error);
      if (errorMsg.includes('Cannot transition')) {
        console.error('[RegistrationService] State machine violation on rejection', {
          trainee_id: id,
          error: errorMsg,
        });
        throw new ConflictError(`Cannot reject registration: ${errorMsg}`);
      }
      if (errorMsg.includes('Rejection requires')) {
        console.error('[RegistrationService] Missing required rejection fields', {
          trainee_id: id,
          error: errorMsg,
        });
        throw new ConflictError(`Cannot reject registration: ${errorMsg}`);
      }
      throw error;
    }

    // Transition any pending 'enrolled' enrollment row for this trainee to 'dropped'
    // so rejected applications do not consume program capacity or block future applications
    try {
      await supabaseAdmin
        .from('enrollments')
        .update({ status: 'dropped' })
        .eq('trainee_id', id)
        .eq('tenant_id', trainee.tenant_id)
        .eq('status', 'enrolled');
    } catch (enrollCleanupErr) {
      console.warn('[RegistrationService] Warning updating rejected enrollment status to dropped:', enrollCleanupErr);
    }

    // Send rejection email to trainee
    await sendRegistrationRejectionEmail({
      tenantId: trainee.tenant_id,
      recipientEmail: trainee.email,
      traineeName: `${trainee.first_name} ${trainee.last_name}`,
      rejectionReason: rejectionReason,
    });

    console.log('[RegistrationService] Rejection email sent to trainee:', {
      trainee_id: id,
      email: trainee.email,
      reason: rejectionReason,
    });
  }

  /**
   * Count pending registrations for a specific tenant
   * Queries trainees table with registration_status = 'pending'
   */
  async countPendingByTenant(tenantId: string): Promise<number> {
    const { count, error } = await supabaseAdmin
      .from('trainees')
      .select('id', { count: 'exact', head: true })
      .eq('registration_status', 'pending')
      .eq('tenant_id', tenantId);

    if (error) {
      this.throwIfPendingRegistrationsMissing(error);
      throw error;
    }
    return count || 0;
  }
}

export const registrationService = new RegistrationService();
