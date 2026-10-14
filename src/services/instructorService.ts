import { supabaseAdmin } from '@/lib/supabase-admin';
import { deleteImageWithThumbnail, ensureThumbnailForImagePath } from '@/utils/fileUpload';

export interface Instructor {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  email: string;
  phone?: string;
  specialization?: string;
  bio?: string;
  photo_path?: string;
  thumbnail_path?: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface CreateInstructorData {
  first_name: string;
  last_name: string;
  middle_name?: string;
  email: string;
  phone?: string;
  specialization?: string;
  bio?: string;
  photo_path?: string;
}

export interface UpdateInstructorData extends Partial<CreateInstructorData> {
  status?: 'active' | 'inactive';
}

class InstructorService {
  private async withThumbnail(instructor: Instructor): Promise<Instructor> {
    return {
      ...instructor,
      thumbnail_path: await ensureThumbnailForImagePath(instructor.photo_path ?? null),
    };
  }

  async getAllInstructors(filters?: { status?: string; search?: string }) {
    let query = supabaseAdmin.from('instructors').select('*');

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

if (filters?.search) {
      query = query.or(`first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
    }

const { data, error } = await query.order('last_name', { ascending: true });

    if (error) throw error;

    const instructors = data || [];
    return Promise.all(instructors.map((instructor) => this.withThumbnail(instructor as Instructor)));
  }

  async getInstructorById(id: string) {
    const { data, error } = await supabaseAdmin
      .from('instructors')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return this.withThumbnail(data as Instructor);
  }

  async createInstructor(instructorData: CreateInstructorData) {
    const { data, error } = await supabaseAdmin
      .from('instructors')
      .insert(instructorData)
      .select()
      .single();

    if (error) throw error;
    return this.withThumbnail(data as Instructor);
  }

  async updateInstructor(id: string, instructorData: UpdateInstructorData) {
    let previousPhotoPath: string | undefined;
    try {
      const existingInstructor = await this.getInstructorById(id);
      previousPhotoPath = existingInstructor.photo_path;
    } catch {
      previousPhotoPath = undefined;
    }

const photoWasUpdated = Object.prototype.hasOwnProperty.call(instructorData, 'photo_path');

    const { data, error } = await supabaseAdmin
      .from('instructors')
      .update(instructorData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    if (
      photoWasUpdated &&
      previousPhotoPath &&
      instructorData.photo_path !== previousPhotoPath
    ) {
      await deleteImageWithThumbnail(previousPhotoPath);
    }

    return this.withThumbnail(data as Instructor);
  }

  async deleteInstructor(id: string) {
    let previousPhotoPath: string | undefined;
    try {
      const existingInstructor = await this.getInstructorById(id);
      previousPhotoPath = existingInstructor.photo_path;
    } catch {
      previousPhotoPath = undefined;
    }

const { error } = await supabaseAdmin
      .from('instructors')
      .delete()
      .eq('id', id);

    if (error) throw error;

    if (previousPhotoPath) {
      await deleteImageWithThumbnail(previousPhotoPath);
    }
  }

  async getInstructorsByProgram(programId: string) {
    const { data, error } = await supabaseAdmin
      .from('program_instructors')
      .select(`
        id,
        role,
        instructor:instructors(*)
      `)
      .eq('program_id', programId);

    if (error) throw error;
    return data;
  }

  async assignInstructorToProgram(programId: string, instructorId: string, role: string = 'instructor') {
    const { data, error } = await supabaseAdmin
      .from('program_instructors')
      .insert({
        program_id: programId,
        instructor_id: instructorId,
        role
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async removeInstructorFromProgram(programId: string, instructorId: string) {
    const { error } = await supabaseAdmin
      .from('program_instructors')
      .delete()
      .eq('program_id', programId)
      .eq('instructor_id', instructorId);

    if (error) throw error;
  }
}

export const instructorService = new InstructorService();
