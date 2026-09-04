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
   * @param isExistingTrainee Whether this is an existing trainee applying to a new program (optional)
   */
  async submitRegistration(data: TraineeRegistrationInput, tenantId: string, isExistingTrainee: boolean = false, enrollmentSource: string = 'direct'): Promise<PendingRegistration> {
    console.log('[RegistrationService] submitRegistration called with:', {
      email: data.email,
      username: data.username,
      isExistingTrainee,
      tenantId,
      enrollmentSource, // NEW: log the source
    });

    // For existing trainees, only check for pending registrations (not approved ones)
    // since they already have approved registrations from their initial signup

    const pendingStatusFilter = isExistingTrainee ? ['pending'] : ['pending', 'approved'];
    
    console.log('[RegistrationService] Checking for existing pending registrations with statuses:', pendingStatusFilter);
    
    // Check for duplicate email in trainees table with registration status
    // (Normalized schema: pending_registrations merged into trainees table)

    const { data: existingTrainee, error: existingTraineeError } = await supabaseAdmin
      .from('trainees')
      .select('id, registration_status')
      .eq('email', data.email.toLowerCase())
      .eq('tenant_id', tenantId)
      .in('registration_status', pendingStatusFilter)
      .maybeSingle();

    if (existingTraineeError && existingTraineeError.code !== 'PGRST116') {
      this.throwIfPendingRegistrationsMissing(existingTraineeError);
      throw existingTraineeError;
    }

    console.log('[RegistrationService] Existing trainee registration found:', existingTrainee);

    if (existingTrainee) {
      if (existingTrainee.registration_status === 'approved' || existingTrainee.registration_status === 'completed') {
        throw new Error('An account with this email already exists. Please log in.');
      }
      throw new Error('A registration request with this email is already pending review.');
    }

    // Only check for existing user account if this is NOT an existing trainee applying to a new program
    // Existing trainees already have user accounts, so we don't need to check
    if (!isExistingTrainee) {
      // Check if email already has an active user account
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', data.email.toLowerCase())
        .maybeSingle();

      if (existingUser) {
        throw new Error('An account with this email already exists. Please log in.');
      }
    }

    // Only check if username is taken if this is NOT an existing trainee
    // Existing trainees are reusing their existing username
    if (!isExistingTrainee) {
      const { data: existingUsername } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('username', data.username)
        .maybeSingle();

      if (existingUsername) {
        throw new Error('This username is already taken. Please choose another.');
      }
    }

    // Check for pending registration with same username (for new trainees only)
    // In normalized schema, username is in users table, not trainees
    if (!isExistingTrainee) {
      const { data: existingPendingUsername } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('username', data.username)
        .maybeSingle();

      if (existingPendingUsername) {
        throw new Error('This username is already taken. Please choose another.');
      }
    }

    // ========== NEW: Check for incomplete enrollment in trainees table ==========
    // Before allowing a new registration, verify the trainee doesn't have an 
    // active or inactive enrollment already. Completed/dropped enrollments are 
    // allowed since those trainees may be re-enrolling.
    // Requirements: 1.1, 1.2, 2.1, 4.3

const incompleteEnrollmentCheck = await this.checkIncompleteEnrollment(
      data.email.toLowerCase(),
      tenantId
    );

    if (incompleteEnrollmentCheck.hasIncompleteEnrollment) {
      // Log the rejection for audit purposes

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
    // ========== END: Incomplete enrollment check ==========

    // NORMALIZED SCHEMA: Insert into trainees table with registration_status = 'pending'
    // (Instead of separate pending_registrations table)
    
    // Generate unique QR code for trainee
    const qrCode = `TRAINEE-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    // Note: Password hash and username are stored in users table (created later during approval)
    const { data: trainee, error } = await supabaseAdmin
      .from('trainees')
      .insert({
        tenant_id: tenantId,
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
        qr_code: qrCode,  // Generate unique QR code
        registration_status: 'pending',  // Mark as pending approval
        // Note: registration_reviewed_by and registration_reviewed_at set during approval
        status: 'inactive',  // Inactive until registration is approved and completed
        consent_given: false,
        is_verified: false,
      })
      .select()
      .single();

    if (error) {
      this.throwIfPendingRegistrationsMissing(error);
      throw error;
    }

    // Store the hashed password temporarily in pending_registration_passwords table
    // This will be retrieved during approval and moved to users.password_hash
    const hashedPassword = await hashPassword(data.password);
    const { error: passwordError } = await supabaseAdmin
      .from('pending_registration_passwords')
      .insert({
        trainee_id: trainee.id,
        password_hash: hashedPassword,
      });

    if (passwordError) {
      console.error('[Registration] Failed to store temporary password:', passwordError);
      throw passwordError;
    }

    // Create enrollment record with the specified enrollment source
    const { data: enrollment, error: enrollmentError } = await supabaseAdmin
      .from('enrollments')
      .insert({
        tenant_id: tenantId,
        trainee_id: trainee.id,
        program_id: data.program_id,
        enrollment_date: new Date().toISOString().split('T')[0], // Today's date
        source: enrollmentSource, // Store enrollment source: 'direct', 'social_share', 'admin_assigned'
        status: 'enrolled', // Pending enrollment approval
      })
      .select()
      .single();

    if (enrollmentError) {
      console.error('[Registration] Failed to create enrollment record:', enrollmentError);
      // Note: trainee was created but enrollment failed - this is unusual
      throw enrollmentError;
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
        enrollments(id, program_id, programs(id, name, description, start_date, end_date, status))
      `)
      .eq('registration_status', filters?.status || 'pending')
      .order('created_at', { ascending: false });

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
    return (data || []) as PendingRegistration[];
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
        enrollments(id, program_id, programs(id, name, description, start_date, end_date, status))
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
    const { password_hash, ...safe } = data;
    return safe as PendingRegistration;
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
        enrollments(id, program_id, programs(id, name, description, start_date, end_date, status))
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

    return (data || []) as PendingRegistration[];
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
        enrollments(program_id)
      `)
      .eq('id', id)
      .single();

    if (fetchError) {
      this.throwIfPendingRegistrationsMissing(fetchError);
    }

    if (fetchError || !traineeReg) throw new Error('Registration not found');
    if (traineeReg.registration_status !== 'pending') throw new Error(`Registration is already ${traineeReg.registration_status}`);

    console.log('[RegistrationService] approveRegistration: Processing registration', {
      trainee_id: id,
      email: traineeReg.email,
      program_id: traineeReg.enrollments?.[0]?.program_id,
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

    // Check if user account already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', traineeReg.email)
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

      // Create user account with the trainee's submitted password
      // Password is stored in users table (not trainees table)
      const { data: newUser, error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          email: traineeReg.email,
          username: traineeReg.email.split('@')[0], // Fallback username from email
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

      // Create users_tenants association so trainee can login to their tenant
      const { error: userTenantError } = await supabaseAdmin
        .from('users_tenants')
        .insert({
          user_id: user.id,
          tenant_id: traineeReg.tenant_id,
        });

      if (userTenantError) throw userTenantError;

      // Create trainee_accounts link (for backward compatibility and query efficiency)
      const { error: traineeAccountError } = await supabaseAdmin
        .from('trainee_accounts')
        .insert({
          tenant_id: traineeReg.tenant_id,
          trainee_id: id,
          user_id: user.id,
        });

      if (traineeAccountError) throw traineeAccountError;

      // Delete the temporary password from pending_registration_passwords table
      await supabaseAdmin
        .from('pending_registration_passwords')
        .delete()
        .eq('trainee_id', id);
    }

    // Complete the registration
    const { error: completeError } = await supabaseAdmin
      .from('trainees')
      .update({
        registration_status: 'completed',
        user_id: user.id,
        status: 'active',
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
