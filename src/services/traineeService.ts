import { supabaseAdmin } from '@/lib/supabase-admin';
import { db } from '@/lib/db';
import { Trainee } from '@/types';
import { CreateTraineeInput, UpdateTraineeInput } from '@/utils/validators';
import { hashPassword } from '@/lib/auth';
import { deleteImageWithThumbnail, ensureThumbnailForImagePath } from '@/utils/fileUpload';
import { TenantContext } from '@/middleware/tenantContext';
import { chunkIds } from '@/lib/supabasePagination';

export class TraineeService {
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private getLinkedAccountEmail(row: any): string | undefined {
    const links = row?.trainee_accounts;

    if (!links) return undefined;

    const firstLink = Array.isArray(links) ? links[0] : links;
    if (!firstLink) return undefined;

    const user = Array.isArray(firstLink.users) ? firstLink.users[0] : firstLink.users;
    const email = user?.email;

    return typeof email === 'string' && email.trim().length > 0 ? this.normalizeEmail(email) : undefined;
  }

  private getLatestActivityTimestamp(row: any): number {
    let latest = row?.created_at ? Date.parse(row.created_at) : 0;
    if (Number.isNaN(latest)) latest = 0;

    if (Array.isArray(row?.enrollments)) {
      for (const enrollment of row.enrollments) {
        if (enrollment?.status === 'dropped' || enrollment?.status === 'failed') continue;
        const createdTs = enrollment?.created_at ? Date.parse(enrollment.created_at) : 0;
        const enrolledDateTs = enrollment?.enrollment_date ? Date.parse(enrollment.enrollment_date) : 0;
        const ts = Math.max(
          Number.isNaN(createdTs) ? 0 : createdTs,
          Number.isNaN(enrolledDateTs) ? 0 : enrolledDateTs
        );
        if (ts > latest) {
          latest = ts;
        }
      }
    }

    return latest;
  }

  private async withThumbnail(trainee: Trainee): Promise<Trainee> {
    return {
      ...trainee,
      thumbnail_path: await ensureThumbnailForImagePath(trainee.photo_path ?? null),
    };
  }

  async getAllTrainees(context: TenantContext | null, filters?: {
    program_id?: string;
    status?: string;
    search?: string;
    tenant_id?: string;
    includeDeleted?: boolean;
  }): Promise<Trainee[]> {
    let query = supabaseAdmin
      .from('trainees')
      .select('*, trainee_accounts(user_id, users(email)), enrollments(*, program:programs(id, name))');

    // Apply tenant filtering for non-super-admin users

if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

    // Also allow explicit tenant_id filter

if (filters?.tenant_id) {
      query = query.eq('tenant_id', filters.tenant_id);
    }
    
    // Exclude soft-deleted trainees by default (deleted_at IS NULL)

if (!filters?.includeDeleted) {
      query = query.is('deleted_at', null);
    }

if (filters?.program_id) {
      query = query.eq('program_id', filters.program_id);
    }

if (filters?.status) {
      query = query.eq('status', filters.status);
    }

if (filters?.search) {
      query = query.or(
        `first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
      );
    }
    
    query = query.order('created_at', { ascending: false });
    
    const { data, error } = await query;
    
    if (error) throw error;

    const trainees = (data || []).map((row: any) => {
      const accountEmail = this.getLinkedAccountEmail(row);
      const { trainee_accounts: _ta, ...base } = row;

      return {
        ...base,
        email: accountEmail || row.email,
      };
    });

    // Surface newly re-enrolled existing trainees alongside newly registered ones
    trainees.sort((a: any, b: any) => this.getLatestActivityTimestamp(b) - this.getLatestActivityTimestamp(a));

    // Batch-fetch latest remark per trainee in 1 query for authorized non-training-staff roles
    const canIncludeRemarks = Boolean(context && context.role !== 'staff_training_coordinator');
    let latestRemarkByTrainee: Map<string, string> | null = null;

    if (canIncludeRemarks && trainees.length > 0) {
      try {
        const traineeIds = trainees.map((t: any) => t.id).filter(Boolean);
        // Chunk `.in()` to avoid PostgREST URL length errors when >500 trainees exist
        const remarkChunks = await Promise.all(
          chunkIds(traineeIds, 150).map(async (idChunk) => {
            let remarksQuery = supabaseAdmin
              .from('trainee_remarks')
              .select('trainee_id, remark, created_at')
              .in('trainee_id', idChunk)
              .order('created_at', { ascending: false });

            if (!context!.isSuperAdmin) {
              remarksQuery = remarksQuery.eq('tenant_id', context!.tenantId);
            }

            const { data: remarksData, error: remarksError } = await remarksQuery;
            if (remarksError) throw remarksError;
            return (remarksData || []) as Array<{ trainee_id: string; remark?: string | null }>;
          })
        );

        latestRemarkByTrainee = new Map<string, string>();
        for (const chunk of remarkChunks) {
          for (const entry of chunk) {
            if (entry.trainee_id && !latestRemarkByTrainee.has(entry.trainee_id)) {
              latestRemarkByTrainee.set(entry.trainee_id, entry.remark || '');
            }
          }
        }
      } catch {
        // Non-fatal: keep trainee list working even if remarks query is unavailable
        latestRemarkByTrainee = null;
      }
    }

    return Promise.all(
      trainees.map((trainee: any) =>
        this.withThumbnail({
          ...trainee,
          ...(latestRemarkByTrainee !== null
            ? { latest_remark: latestRemarkByTrainee.get(trainee.id) ?? '' }
            : {}),
        } as Trainee)
      )
    );
  }

  async getTraineeById(context: TenantContext | null, id: string, includeDeleted: boolean = false): Promise<Trainee | null> {
    let query = supabaseAdmin
      .from('trainees')
      .select('*, trainee_accounts(user_id, users(email)), enrollments(*)')
      .eq('id', id);

    // Apply tenant filtering for non-super-admin users

if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

    // Exclude soft-deleted trainees by default

if (!includeDeleted) {
      query = query.is('deleted_at', null);
    }

const { data, error } = await query.maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

if (!data) {
      return null;
    }

const accountEmail = this.getLinkedAccountEmail(data);
    const { trainee_accounts: _ta, ...base } = data as any;

    return this.withThumbnail({
      ...base,
      email: accountEmail || base.email,
    } as Trainee);
  }

  async getTraineeByEmail(email: string, tenantId: string, includeDeleted: boolean = false): Promise<Trainee | null> {
    let query = supabaseAdmin
      .from('trainees')
      .select('*, trainee_accounts(user_id, users(email)), enrollments(*)')
      .eq('email', this.normalizeEmail(email))
      .eq('tenant_id', tenantId);

    // Exclude soft-deleted trainees by default

if (!includeDeleted) {
      query = query.is('deleted_at', null);
    }

const { data, error } = await query.single();
    
    if (error && error.code !== 'PGRST116') throw error;

    if (!data) {
      return null;
    }

    return this.withThumbnail(data as Trainee);
  }

  async createTrainee(traineeData: CreateTraineeInput & { tenantId?: string }): Promise<{ trainee: Trainee; temp_password: string; default_password: string }> {
    // Check if email already exists within the same tenant
    const { tenantId, ...rest } = traineeData as any;
    const existingTrainee = await this.getTraineeByEmail(traineeData.email, tenantId);
    if (existingTrainee) {
      throw new Error('A trainee with this email already exists');
    }

    const normalizedEmail = this.normalizeEmail(traineeData.email);

    const { data: existingUserByEmail, error: existingUserError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .is('deleted_at', null)
      .maybeSingle();

    if (existingUserError && existingUserError.code !== 'PGRST116') {
      throw existingUserError;
    }

if (existingUserByEmail) {
      throw new Error('An account with this email already exists');
    }

    const newTrainee: Partial<Trainee> & { tenant_id?: string; registration_status?: string } = {
      ...rest,
      email: normalizedEmail,
      status: 'active',
      registration_status: 'completed',
      // NOTE: enrollment_date, program_id are NOT stored on trainees table (normalized schema)
      // These are managed exclusively via the enrollments table
      // Explicitly remove these fields to prevent schema errors
      program_id: undefined,
      enrollment_date: undefined,
      // Map camelCase tenantId → snake_case tenant_id for DB (Req 9.2)
      ...(tenantId ? { tenant_id: tenantId } : {}),
    };
    
    // Use supabaseAdmin to bypass RLS policies

const { data, error } = await supabaseAdmin
      .from('trainees')
      .insert(newTrainee)
      .select()
      .single();
    
    if (error) throw error;
    const trainee: Trainee = data;

    // Create a user account with default password Admin123 so the trainee can log in immediately
    const defaultPassword = 'Admin123';
    const password_hash = await hashPassword(defaultPassword);

    const usernameBase = `${traineeData.first_name.toLowerCase().replace(/[^a-z0-9]/g, '')}${traineeData.last_name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const username = `${usernameBase}${Math.floor(1000 + Math.random() * 9000)}`;

    const { data: userRecord, error: userError } = await supabaseAdmin
      .from('users')
      .insert({ email: trainee.email, username, password_hash, role: 'trainee' })
      .select('id')
      .single();

    if (userError) throw userError;

    const { error: accountError } = await supabaseAdmin
      .from('trainee_accounts')
      .insert({ trainee_id: trainee.id, user_id: userRecord.id, tenant_id: tenantId });

    if (accountError) throw accountError;

    // Link user to tenant in users_tenants junction table for multi-tenant auth
    if (tenantId) {
      const { error: userTenantError } = await supabaseAdmin
        .from('users_tenants')
        .insert({
          user_id: userRecord.id,
          tenant_id: tenantId,
          is_primary: true,
        });

      if (userTenantError) {
        console.warn('[createTrainee] Failed to insert users_tenants:', userTenantError);
      }
    }

    // Create initial program enrollment in normalized enrollments table if program_id was provided
    if (traineeData.program_id) {
      const enrollDate = traineeData.enrollment_date
        ? traineeData.enrollment_date.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const { error: enrollError } = await supabaseAdmin
        .from('enrollments')
        .insert({
          trainee_id: trainee.id,
          program_id: traineeData.program_id,
          enrollment_date: enrollDate,
          status: 'enrolled',
          source: 'direct',
          ...(tenantId ? { tenant_id: tenantId } : {}),
        });
      if (enrollError) {
        console.warn('[createTrainee] Failed to create initial enrollment:', enrollError);
      }
    }

    const traineeWithThumbnail = await this.withThumbnail(trainee);
    return { trainee: traineeWithThumbnail, temp_password: defaultPassword, default_password: defaultPassword };
  }

  async updateTrainee(id: string, traineeData: UpdateTraineeInput): Promise<Trainee> {
    console.log('🔄 Updating trainee:', { id, data: traineeData });
    
    const existingTrainee = await this.getTraineeById(null, id);
    if (!existingTrainee) {
      console.error('❌ Trainee not found:', id);
      throw new Error('Trainee not found');
    }
    
    console.log('✅ Found existing trainee:', existingTrainee.email);

    const normalizedData: UpdateTraineeInput = {
      ...traineeData,
      ...(typeof traineeData.email === 'string'
        ? { email: this.normalizeEmail(traineeData.email) }
        : {}),
    };

    const emailChanged =
      typeof normalizedData.email === 'string' &&
      normalizedData.email !== this.normalizeEmail(existingTrainee.email);

    // NOTE: program_id and enrollment_date are no longer stored on trainees table (normalized schema)
    // Program enrollment is now exclusively managed via enrollments table
    // Remove these fields from update data if they were provided
    if ('program_id' in normalizedData) {
      delete (normalizedData as any).program_id;
    }
    if ('enrollment_date' in normalizedData) {
      delete (normalizedData as any).enrollment_date;
    }

    let linkedUserId: string | null = null;
    let nextEmail: string | null = null;

    // 1. Resolve linked user account via trainee_accounts
    const { data: accountLink, error: accountLinkError } = await supabaseAdmin
      .from('trainee_accounts')
      .select('user_id')
      .eq('trainee_id', id)
      .maybeSingle();

    if (accountLinkError && accountLinkError.code !== 'PGRST116') {
      throw accountLinkError;
    }

    linkedUserId = accountLink?.user_id ?? null;

    // If no trainee_accounts record, check if an active user exists with existing trainee email
    if (!linkedUserId) {
      const { data: userByEmail } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', this.normalizeEmail(existingTrainee.email))
        .is('deleted_at', null)
        .maybeSingle();

      if (userByEmail) {
        linkedUserId = userByEmail.id;
      }
    }

    if (emailChanged) {
      nextEmail = normalizedData.email as string;

      const { data: duplicateTrainee, error: duplicateTraineeError } = await supabaseAdmin
        .from('trainees')
        .select('id')
        .eq('email', nextEmail)
        .neq('id', id)
        .maybeSingle();

      if (duplicateTraineeError && duplicateTraineeError.code !== 'PGRST116') {
        throw duplicateTraineeError;
      }

      if (duplicateTrainee) {
        throw new Error('A trainee with this email already exists');
      }

      let duplicateUserQuery = supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', nextEmail)
        .is('deleted_at', null);

      if (linkedUserId) {
        duplicateUserQuery = duplicateUserQuery.neq('id', linkedUserId);
      }

      const { data: duplicateUser, error: duplicateUserError } = await duplicateUserQuery.maybeSingle();

      if (duplicateUserError && duplicateUserError.code !== 'PGRST116') {
        throw duplicateUserError;
      }

      if (duplicateUser) {
        throw new Error('This email is already connected to another account');
      }
    }

const photoWasUpdated = Object.prototype.hasOwnProperty.call(traineeData, 'photo_path');

    console.log('📊 Update Trainee Analysis:', {
      updatingEmail: emailChanged,
      hasPhotoUpdate: photoWasUpdated,
    });

    // Use supabaseAdmin to bypass RLS policies

const { data, error } = await supabaseAdmin
      .from('trainees')
      .update(normalizedData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      console.error('❌ Supabase update error:', error);
      throw error;
    }

if (
      photoWasUpdated &&
      existingTrainee.photo_path &&
      traineeData.photo_path !== existingTrainee.photo_path
    ) {
      await deleteImageWithThumbnail(existingTrainee.photo_path);
    }

    const targetEmail = nextEmail || this.normalizeEmail(data.email || existingTrainee.email);
    const effectiveTenantId = existingTrainee.tenant_id || (data as any)?.tenant_id;

    if (linkedUserId) {
      // Sync user email so users.email ALWAYS matches trainees.email
      const { error: syncUserEmailError } = await supabaseAdmin
        .from('users')
        .update({ email: targetEmail })
        .eq('id', linkedUserId);

      if (syncUserEmailError) {
        if (emailChanged) {
          await supabaseAdmin
            .from('trainees')
            .update({ email: this.normalizeEmail(existingTrainee.email) })
            .eq('id', id);

          throw new Error('Failed to sync trainee account email; trainee email update was reverted');
        }
        console.error('Failed to sync user email with trainee email:', syncUserEmailError);
      }

      // Ensure trainee_accounts and users_tenants link exist
      await supabaseAdmin
        .from('trainee_accounts')
        .upsert(
          { trainee_id: id, user_id: linkedUserId, ...(effectiveTenantId ? { tenant_id: effectiveTenantId } : {}) },
          { onConflict: 'trainee_id' }
        );

      if (effectiveTenantId) {
        await supabaseAdmin
          .from('users_tenants')
          .upsert(
            { user_id: linkedUserId, tenant_id: effectiveTenantId, is_primary: true },
            { onConflict: 'user_id,tenant_id' }
          );
      }
    } else {
      // If trainee never had a user account, provision one with targetEmail & default Admin123 password
      const defaultPassword = 'Admin123';
      const password_hash = await hashPassword(defaultPassword);
      const usernameBase = `${(data.first_name || existingTrainee.first_name || 'trainee').toLowerCase().replace(/[^a-z0-9]/g, '')}${(data.last_name || existingTrainee.last_name || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const username = `${usernameBase || 'trainee'}${Math.floor(1000 + Math.random() * 9000)}`;

      const { data: newUser, error: newUserError } = await supabaseAdmin
        .from('users')
        .insert({
          email: targetEmail,
          username,
          password_hash,
          role: 'trainee',
        })
        .select('id')
        .single();

      if (!newUserError && newUser) {
        await supabaseAdmin
          .from('trainee_accounts')
          .upsert(
            { trainee_id: id, user_id: newUser.id, ...(effectiveTenantId ? { tenant_id: effectiveTenantId } : {}) },
            { onConflict: 'trainee_id' }
          );

        if (effectiveTenantId) {
          await supabaseAdmin
            .from('users_tenants')
            .upsert(
              { user_id: newUser.id, tenant_id: effectiveTenantId, is_primary: true },
              { onConflict: 'user_id,tenant_id' }
            );
        }
      }
    }

    console.log('✅ Trainee updated successfully');
    return this.withThumbnail(data);
  }

  async deleteTrainee(id: string): Promise<void> {
    // Soft delete: set deleted_at to current timestamp

const { error } = await supabaseAdmin
      .from('trainees')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    
    console.log(`✅ Trainee ${id} soft-deleted successfully`);
  }

  async restoreTrainee(id: string): Promise<Trainee> {
    // Restore a soft-deleted trainee by clearing deleted_at

const { data, error } = await supabaseAdmin
      .from('trainees')
      .update({ deleted_at: null })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Trainee ${id} restored successfully`);
    return this.withThumbnail(data);
  }


  async getTraineesByProgram(programId: string, tenantId: string): Promise<Trainee[]> {
    return this.getAllTrainees(null, { program_id: programId, tenant_id: tenantId });
  }

  async resetTraineePassword(context: TenantContext | null, id: string): Promise<{ email: string; default_password: string; message: string }> {
    const trainee = await this.getTraineeById(context, id);
    if (!trainee) {
      throw new Error('Trainee not found');
    }

    const defaultPassword = 'Admin123';
    const password_hash = await hashPassword(defaultPassword);
    const normalizedEmail = this.normalizeEmail(trainee.email);

    // 1. Check if user account exists by email or trainee_accounts
    let userId: string | null = null;
    const { data: traineeAccount } = await supabaseAdmin
      .from('trainee_accounts')
      .select('user_id')
      .eq('trainee_id', id)
      .maybeSingle();

    if (traineeAccount?.user_id) {
      userId = traineeAccount.user_id;
    } else {
      const { data: userByEmail } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', normalizedEmail)
        .is('deleted_at', null)
        .maybeSingle();
      if (userByEmail?.id) {
        userId = userByEmail.id;
      }
    }

    if (userId) {
      // Update existing user password
      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ password_hash })
        .eq('id', userId);

      if (updateError) throw updateError;
    } else {
      // Create user account if it doesn't exist yet
      const usernameBase = `${trainee.first_name.toLowerCase().replace(/[^a-z0-9]/g, '')}${trainee.last_name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const username = `${usernameBase}${Math.floor(1000 + Math.random() * 9000)}`;

      const { data: newUser, error: createError } = await supabaseAdmin
        .from('users')
        .insert({ email: normalizedEmail, username, password_hash, role: 'trainee' })
        .select('id')
        .single();

      const effectiveTenantId = trainee.tenant_id || context?.tenantId;

      if (createError) throw createError;
      userId = newUser.id;

      await supabaseAdmin
        .from('trainee_accounts')
        .insert({ trainee_id: trainee.id, user_id: userId, tenant_id: effectiveTenantId });
    }

    // 2. Ensure users_tenants link exists for tenant login
    const effectiveTenantId = trainee.tenant_id || context?.tenantId;
    if (effectiveTenantId && userId) {
      const { data: existingUserTenant } = await supabaseAdmin
        .from('users_tenants')
        .select('user_id')
        .eq('user_id', userId)
        .eq('tenant_id', effectiveTenantId)
        .maybeSingle();

      if (!existingUserTenant) {
        await supabaseAdmin
          .from('users_tenants')
          .insert({ user_id: userId, tenant_id: effectiveTenantId, is_primary: true });
      }
    }

    // 3. Ensure trainee registration_status is completed and status is active
    await supabaseAdmin
      .from('trainees')
      .update({ registration_status: 'completed', status: 'active' })
      .eq('id', id);

    return {
      email: normalizedEmail,
      default_password: defaultPassword,
      message: 'Password successfully reset to default Admin123',
    };
  }
}

export const traineeService = new TraineeService();
