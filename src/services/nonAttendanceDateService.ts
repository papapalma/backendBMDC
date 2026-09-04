import { supabaseAdmin } from '@/lib/supabase-admin';

export interface NonAttendanceDate {
  id: string;
  date: string;
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
   */
  async getAllNonAttendanceDates(filters?: {
    program_id?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<NonAttendanceDate[]> {
    let query = supabaseAdmin
      .from('non_attendance_dates')
      .select('*')
      .order('date', { ascending: true });

    if (filters?.program_id) {
      // Get dates for specific program + global dates (program_id is null)
      query = query.or(`program_id.eq.${filters.program_id},program_id.is.null`);
    }

if (filters?.start_date) {
      query = query.gte('date', filters.start_date);
    }

if (filters?.end_date) {
      query = query.lte('date', filters.end_date);
    }

const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Check if a specific date is excluded from attendance
   */
  async isDateExcluded(date: string, programId?: string): Promise<boolean> {
    let query = supabaseAdmin
      .from('non_attendance_dates')
      .select('id')
      .eq('date', date);

    if (programId) {
      query = query.or(`program_id.eq.${programId},program_id.is.null`);
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
      .from('non_attendance_dates')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return inserted;
  }

  /**
   * Bulk create non-attendance dates (e.g., all weekends in a year)
   */
  async bulkCreateNonAttendanceDates(dates: CreateNonAttendanceDateData[]): Promise<NonAttendanceDate[]> {
    const { data, error } = await supabaseAdmin
      .from('non_attendance_dates')
      .insert(dates)
      .select();

    if (error) throw error;
    return data || [];
  }

  /**
   * Update a non-attendance date
   */
  async updateNonAttendanceDate(
    id: string,
    data: Partial<CreateNonAttendanceDateData>
  ): Promise<NonAttendanceDate> {
    const { data: updated, error } = await supabaseAdmin
      .from('non_attendance_dates')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return updated;
  }

  /**
   * Delete a non-attendance date
   */
  async deleteNonAttendanceDate(id: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from('non_attendance_dates')
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
      .from('non_attendance_dates')
      .select('date')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .eq('reason', 'Weekend');

    const existingSet = new Set((existing ?? []).map((r: { date: string }) => r.date));
    const newDates = weekendDates.filter(d => !existingSet.has(d));

    if (newDates.length === 0) return 0;

    const data: CreateNonAttendanceDateData[] = newDates.map(date => ({
      date,
      reason: 'Weekend',
      description: 'Auto-generated weekend date',
      program_id: programId,
      is_recurring: false,
      created_by: createdBy,
    }));

    const inserted = await this.bulkCreateNonAttendanceDates(data);
    return inserted.length;
  }
}

export const nonAttendanceDateService = new NonAttendanceDateService();
