import { supabaseAdmin } from '@/lib/supabase-admin';
import { db } from '@/lib/db';
import { Trainee } from '@/types';
import { CreateTraineeInput, UpdateTraineeInput } from '@/utils/validators';
import { hashPassword } from '@/lib/auth';
import { deleteImageWithThumbnail, ensureThumbnailForImagePath } from '@/utils/fileUpload';
import { TenantContext } from '@/middleware/tenantContext';

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
      .select('*, trainee_accounts(user_id, users(email)), enrollments(*)');

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

    return Promise.all(trainees.map((trainee) => this.withThumbnail(trainee as Trainee)));
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

  async createTrainee(traineeData: CreateTraineeInput & { tenantId?: string }): Promise<{ trainee: Trainee; temp_password: string }> {
    // Check if email already exists within the same tenant
    const { tenantId, ...rest } = traineeData as any;
    const existingTrainee = await this.getTraineeByEmail(traineeData.email, tenantId);
    if (existingTrainee) {
      throw new Error('A trainee with this email already exists');
    }

const qrCode = `TRAINEE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const normalizedEmail = this.normalizeEmail(traineeData.email);

    const { data: existingUserByEmail, error: existingUserError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingUserError && existingUserError.code !== 'PGRST116') {
      throw existingUserError;
    }

if (existingUserByEmail) {
      throw new Error('An account with this email already exists');
    }

    const newTrainee: Partial<Trainee> & { tenant_id?: string } = {
      ...rest,
      email: normalizedEmail,
      qr_code: qrCode,
      status: 'active',
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

    // Create a user account so the trainee can log in

const tempPassword = `BMDC-${Math.random().toString(36).slice(2, 7).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const password_hash = await hashPassword(tempPassword);

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

    const traineeWithThumbnail = await this.withThumbnail(trainee);
    return { trainee: traineeWithThumbnail, temp_password: tempPassword };
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

const { data: accountLink, error: accountLinkError } = await supabaseAdmin
        .from('trainee_accounts')
        .select('user_id')
        .eq('trainee_id', id)
        .maybeSingle();

      if (accountLinkError && accountLinkError.code !== 'PGRST116') {
        throw accountLinkError;
      }

      linkedUserId = accountLink?.user_id ?? null;

      let duplicateUserQuery = supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', nextEmail);

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

if (emailChanged && linkedUserId && nextEmail) {
      const { error: syncUserEmailError } = await supabaseAdmin
        .from('users')
        .update({ email: nextEmail })
        .eq('id', linkedUserId);

      if (syncUserEmailError) {
        await supabaseAdmin
          .from('trainees')
          .update({ email: this.normalizeEmail(existingTrainee.email) })
          .eq('id', id);

        throw new Error('Failed to sync trainee account email; trainee email update was reverted');
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

  async getTraineeByQRCode(qrCode: string, tenantId: string, includeDeleted: boolean = false): Promise<Trainee | null> {
    let query = supabaseAdmin
      .from('trainees')
      .select('*, trainee_accounts(user_id, users(email)), enrollments(*)')
      .eq('qr_code', qrCode)
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

  async getTraineesByProgram(programId: string, tenantId: string): Promise<Trainee[]> {
    return this.getAllTrainees(null, { program_id: programId, tenant_id: tenantId });
  }
}

export const traineeService = new TraineeService();
