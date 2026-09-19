import { supabaseAdmin } from '@/lib/supabase-admin';

export interface NonAttendanceDate {
  id: string;
  date: string;  // Maps to exception_date
  reason: string;
  description?: string;
  program_id?: string;
  is_recurring: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateNonAttendanceDateData {
  date: string;
  reason: string;
  description?: string;
  program_id?: string;
  is_recurring?: boolean;
  created_by?: string;
}

export class NonAttendanceDateService {
  /**
   * Get all non-attendance dates with optional filters
   * Queries attendance_exceptions table with exception_type = 'no_attendance_day'
   */
  async getAllNonAttendanceDates(filters?: {
    program_id?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<NonAttendanceDate[]> {
    let query = supabaseAdmin
      .from('attendance_exceptions')
      .select('id, exception_date, reason, program_id, created_by, created_at, updated_at')
      .eq('exception_type', 'no_attendance_day')
      .order('exception_date', { ascending: true });

    if (filters?.program_id) {
      // Get dates for specific program + global dates (program_id is null)
      query = query.in('program_id', [filters.program_id, null]);
    }

    if (filters?.start_date) {
      query = query.gte('exception_date', filters.start_date);
    }

    if (filters?.end_date) {
      query = query.lte('exception_date', filters.end_date);
    }

    const { data, error } = await query;
    if (error) throw error;
    
    // Map attendance_exceptions columns to NonAttendanceDate interface
    return (data || []).map(d => ({
      id: d.id,
      date: d.exception_date,
      reason: d.reason,
      description: d.reason,
      program_id: d.program_id,
      is_recurring: false,
      created_by: d.created_by,
      created_at: d.created_at,
      updated_at: d.updated_at,
    }));
  }

  /**
   * Check if a specific date is excluded from attendance
   */
  async isDateExcluded(date: string, programId?: string): Promise<boolean> {
    let query = supabaseAdmin
      .from('attendance_exceptions')
      .select('id')
      .eq('exception_type', 'no_attendance_day')
      .eq('exception_date', date);

    if (programId) {
      // Get dates for specific program + global dates (program_id is null)
      query = query.in('program_id', [programId, null]);
    } else {
      query = query.is('program_id', null);
    }

    const { data, error } = await query.limit(1);
    if (error) throw error;
    return (data?.length || 0) > 0;
  }

  /**
   * Get excluded dates within a date range (for attendance calculations)
   */
  async getExcludedDatesInRange(
    startDate: string,
    endDate: string,
    programId?: string
  ): Promise<string[]> {
    const dates = await this.getAllNonAttendanceDates({
      program_id: programId,
      start_date: startDate,
      end_date: endDate,
    });

    return dates.map(d => d.date);
  }

  /**
   * Create a new non-attendance date
   */
  async createNonAttendanceDate(data: CreateNonAttendanceDateData): Promise<NonAttendanceDate> {
    const { data: inserted, error } = await supabaseAdmin
      .from('attendance_exceptions')
      .insert({
        exception_type: 'no_attendance_day',
        exception_date: data.date,
        reason: data.reason,
        program_id: data.program_id || null,
        created_by: data.created_by,
      })
      .select('id, exception_date, reason, program_id, created_by, created_at, updated_at')
      .single();

    if (error) throw error;
    
    return {
      id: inserted.id,
      date: inserted.exception_date,
      reason: inserted.reason,
      description: inserted.reason,
      program_id: inserted.program_id,
      is_recurring: false,
      created_by: inserted.created_by,
      created_at: inserted.created_at,
      updated_at: inserted.updated_at,
    };
  }

  /**
   * Bulk create non-attendance dates (e.g., all weekends in a year)
   */
  async bulkCreateNonAttendanceDates(dates: CreateNonAttendanceDateData[]): Promise<NonAttendanceDate[]> {
    const insertData = dates.map(d => ({
      exception_type: 'no_attendance_day',
      exception_date: d.date,
      reason: d.reason,
      program_id: d.program_id || null,
      created_by: d.created_by,
    }));

    const { data, error } = await supabaseAdmin
      .from('attendance_exceptions')
      .insert(insertData)
      .select('id, exception_date, reason, program_id, created_by, created_at, updated_at');

    if (error) throw error;
    
    return (data || []).map(d => ({
      id: d.id,
      date: d.exception_date,
      reason: d.reason,
      description: d.reason,
      program_id: d.program_id,
      is_recurring: false,
      created_by: d.created_by,
      created_at: d.created_at,
      updated_at: d.updated_at,
    }));
  }

  /**
   * Update a non-attendance date
   */
  async updateNonAttendanceDate(
    id: string,
    data: Partial<CreateNonAttendanceDateData>
  ): Promise<NonAttendanceDate> {
    const updateData: any = {
      exception_type: 'no_attendance_day',
    };
    
    if (data.date) updateData.exception_date = data.date;
    if (data.reason) updateData.reason = data.reason;
    if (data.program_id !== undefined) updateData.program_id = data.program_id || null;
    if (data.created_by) updateData.created_by = data.created_by;

    const { data: updated, error } = await supabaseAdmin
      .from('attendance_exceptions')
      .update(updateData)
      .eq('id', id)
      .select('id, exception_date, reason, program_id, created_by, created_at, updated_at')
      .single();

    if (error) throw error;
    
    return {
      id: updated.id,
      date: updated.exception_date,
      reason: updated.reason,
      description: updated.reason,
      program_id: updated.program_id,
      is_recurring: false,
      created_by: updated.created_by,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
    };
  }

  /**
   * Delete a non-attendance date
   */
  async deleteNonAttendanceDate(id: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from('attendance_exceptions')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  /**
   * Generate weekend dates for a date range
   */
  generateWeekendDates(startDate: Date, endDate: Date): string[] {
    const weekends: string[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      const day = current.getDay();
      if (day === 0 || day === 6) { // Sunday = 0, Saturday = 6
        weekends.push(current.toISOString().split('T')[0]);
      }
      current.setDate(current.getDate() + 1);
    }

    return weekends;
  }

  /**
   * Auto-generate and save all weekends for a year
   */
  async generateWeekendsForYear(year: number, programId?: string, createdBy?: string): Promise<number> {
    const startDate = new Date(year, 0, 1); // January 1
    const endDate = new Date(year, 11, 31); // December 31

    const weekendDates = this.generateWeekendDates(startDate, endDate);

    // Idempotency: fetch dates already stored for this year so we only insert new ones (SEC-22)
    const { data: existing } = await supabaseAdmin
      .from('attendance_exceptions')
      .select('exception_date')
      .eq('exception_type', 'no_attendance_day')
      .gte('exception_date', `${year}-01-01`)
      .lte('exception_date', `${year}-12-31`)
      .eq('reason', 'Weekend');

    const existingSet = new Set((existing ?? []).map((r: { exception_date: string }) => r.exception_date));
    const newDates = weekendDates.filter(d => !existingSet.has(d));

    if (newDates.length === 0) return 0;

    const insertData = newDates.map(date => ({
      exception_type: 'no_attendance_day',
      exception_date: date,
      reason: 'Weekend',
      program_id: programId || null,
      created_by: createdBy,
    }));

    const inserted = await this.bulkCreateNonAttendanceDates(
      newDates.map(date => ({
        date,
        reason: 'Weekend',
        description: 'Auto-generated weekend date',
        program_id: programId,
        is_recurring: false,
        created_by: createdBy,
      }))
    );
    
    return inserted.length;
  }
}

export const nonAttendanceDateService = new NonAttendanceDateService();
