import { supabaseAdmin } from '@/lib/supabase-admin';
import { TraineeStatusRecord, TraineeStatusSummary } from '@/types';
import { CreateTraineeStatusInput, UpdateTraineeStatusInput, TraineeStatusFilterInput } from '@/utils/validators';
import { TenantContext } from '@/middleware/tenantContext';

export class TraineeStatusService {
  /**
   * Create a new trainee status record
   * Tracks post-graduation outcomes for a completed training enrollment
   */
  async createTraineeStatus(
    data: CreateTraineeStatusInput & { tenantId?: string; recordedBy: string }
  ): Promise<TraineeStatusRecord> {
    const { tenantId, recordedBy, ...statusData } = data;

    const { data: record, error } = await supabaseAdmin
      .from('trainee_status_records')
      .insert({
        ...statusData,
        tenant_id: tenantId,
        recorded_by: recordedBy,
      })
      .select(
        `
        *,
        trainee:trainees(id, first_name, last_name, email),
        enrollment:enrollments(*),
        certificate:certificates(id, certificate_number, issue_date)
      `
      )
      .single();

    if (error) throw error;
    return record as TraineeStatusRecord;
  }

  /**
   * Get trainee status record by enrollment
   */
  async getTraineeStatusByEnrollment(
    enrollmentId: string,
    tenantId: string
  ): Promise<TraineeStatusRecord | null> {
    const { data, error } = await supabaseAdmin
      .from('trainee_status_records')
      .select(
        `
        *,
        trainee:trainees(id, first_name, last_name, email),
        enrollment:enrollments(*),
        certificate:certificates(id, certificate_number, issue_date)
      `
      )
      .eq('enrollment_id', enrollmentId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;
    return data as TraineeStatusRecord | null;
  }

  /**
   * Get trainee status record by ID
   */
  async getTraineeStatusById(
    id: string,
    tenantId: string
  ): Promise<TraineeStatusRecord | null> {
    const { data, error } = await supabaseAdmin
      .from('trainee_status_records')
      .select(
        `
        *,
        trainee:trainees(id, first_name, last_name, email),
        enrollment:enrollments(*),
        certificate:certificates(id, certificate_number, issue_date)
      `
      )
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw error;
    return data as TraineeStatusRecord | null;
  }

  /**
   * Get all trainee status records for a trainee
   */
  async getTraineeStatusByTraineeId(
    traineeId: string,
    tenantId: string
  ): Promise<TraineeStatusRecord[]> {
    const { data, error } = await supabaseAdmin
      .from('trainee_status_records')
      .select(
        `
        *,
        trainee:trainees(id, first_name, last_name, email),
        enrollment:enrollments(*),
        certificate:certificates(id, certificate_number, issue_date)
      `
      )
      .eq('trainee_id', traineeId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('recorded_at', { ascending: false });

    if (error) throw error;
    return data as TraineeStatusRecord[];
  }

  /**
   * Update trainee status record
   */
  async updateTraineeStatus(
    id: string,
    data: UpdateTraineeStatusInput & { tenantId?: string; lastUpdatedBy: string }
  ): Promise<TraineeStatusRecord> {
    const { tenantId, lastUpdatedBy, ...updateData } = data;

    const { data: record, error } = await supabaseAdmin
      .from('trainee_status_records')
      .update({
        ...updateData,
        last_updated_by: lastUpdatedBy,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(
        `
        *,
        trainee:trainees(id, first_name, last_name, email),
        enrollment:enrollments(*),
        certificate:certificates(id, certificate_number, issue_date)
      `
      )
      .single();

    if (error) throw error;
    return record as TraineeStatusRecord;
  }

  /**
   * Query trainee status records with filters and pagination
   */
  async queryTraineeStatus(
    context: TenantContext | null,
    filters?: TraineeStatusFilterInput
  ): Promise<{ data: TraineeStatusRecord[]; count: number }> {
    let query = supabaseAdmin
      .from('trainee_status_records')
      .select(
        `
        *,
        trainee:trainees(id, first_name, last_name, email),
        enrollment:enrollments(*),
        certificate:certificates(id, certificate_number, issue_date)
      `,
        { count: 'exact' }
      );

    // Apply tenant filtering
    if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

    // Apply soft delete filter
    query = query.is('deleted_at', null);

    // Apply filters
    if (filters?.graduation_status) {
      query = query.eq('graduation_status', filters.graduation_status);
    }

    if (filters?.employment_status) {
      query = query.eq('employment_status', filters.employment_status);
    }

    if (filters?.skills_match) {
      query = query.eq('skills_match', filters.skills_match);
    }

    if (filters?.job_sector) {
      query = query.eq('job_sector', filters.job_sector);
    }

    if (filters?.program_id) {
      query = query.eq('enrollment.program_id', filters.program_id);
    }

    if (filters?.date_from) {
      query = query.gte('recorded_at', `${filters.date_from}T00:00:00`);
    }

    if (filters?.date_to) {
      query = query.lte('recorded_at', `${filters.date_to}T23:59:59`);
    }

    if (filters?.search) {
      query = query.or(
        `job_title.ilike.%${filters.search}%,employer_name.ilike.%${filters.search}%,remarks.ilike.%${filters.search}%`
      );
    }

    // Pagination
    const page = filters?.page || 1;
    const perPage = filters?.perPage || 20;
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    query = query.range(from, to);

    // Order by most recent first
    query = query.order('recorded_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) throw error;

    return {
      data: data as TraineeStatusRecord[],
      count: count || 0,
    };
  }

  /**
   * Query trainee status records with advanced filtering, sorting, and pagination
   * Supports multiple filter values with AND logic and flexible sorting
   * 
   * Requirements:
   * - Apply filters with AND logic: when multiple filter types are provided,
   *   ALL conditions must be satisfied
   * - Within each filter type: comma-separated values use OR logic
   *   (e.g., employment_status IN ('employed', 'self_employed'))
   * - Soft delete filtering: always exclude deleted_at IS NOT NULL
   * - Tenant filtering: always filter by tenant_id
   * 
   * Note on Supabase query composition:
   * - Multiple .eq() calls are implicitly ANDed
   * - .or() is used for OR conditions within a filter
   * - To properly combine AND and OR, we need to fetch and filter in application layer
   */
  async queryTraineeStatusAdvanced(
    context: TenantContext | null,
    filters: {
      graduation_status?: string[];
      employment_status?: string[];
      skills_match?: string[];
      sort_by?: 'name' | 'graduation_date' | 'employment_status' | 'skills_match' | 'recorded_at';
      sort_dir?: 'asc' | 'desc';
      page?: number;
      limit?: number;
      search?: string;
    }
  ): Promise<{ data: TraineeStatusRecord[]; count: number }> {
    // Start with base query
    let query = supabaseAdmin
      .from('trainee_status_records')
      .select(
        `
        *,
        trainee:trainees(id, first_name, last_name, email),
        enrollment:enrollments(*),
        certificate:certificates(id, certificate_number, issue_date)
      `,
        { count: 'exact' }
      );

    // Apply tenant filtering (always - AND condition)
    if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

    // Apply soft delete filter (always - AND condition)
    query = query.is('deleted_at', null);

    // Apply single-value filters with AND logic
    // These are base filters that apply to all queries
    if (filters?.employment_status && filters.employment_status.length === 1) {
      query = query.eq('employment_status', filters.employment_status[0]);
    }

    if (filters?.skills_match && filters.skills_match.length === 1) {
      query = query.eq('skills_match', filters.skills_match[0]);
    }

    if (filters?.graduation_status && filters.graduation_status.length === 1) {
      query = query.eq('graduation_status', filters.graduation_status[0]);
    }

    // Pagination
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    query = query.range(from, to);

    // Apply sorting
    const sortBy = filters?.sort_by || 'recorded_at';
    const sortDir = filters?.sort_dir || 'desc';
    const ascending = sortDir === 'asc';

    // Map sort_by parameter to actual column name
    let sortColumn = 'recorded_at';
    if (sortBy === 'name') {
      sortColumn = 'trainee.first_name'; // Note: Supabase joins may not support nested sorting, fallback to recorded_at
      sortColumn = 'recorded_at';
    } else if (sortBy === 'graduation_date') {
      sortColumn = 'graduation_date';
    } else if (sortBy === 'employment_status') {
      sortColumn = 'employment_status';
    } else if (sortBy === 'skills_match') {
      sortColumn = 'skills_match';
    } else {
      sortColumn = 'recorded_at';
    }

    query = query.order(sortColumn, { ascending });

    // Build OR conditions for multi-value filters
    // These will be applied to the final query result in JavaScript
    const orConditions = {
      employment_status: filters?.employment_status && filters.employment_status.length > 1 
        ? filters.employment_status 
        : null,
      skills_match: filters?.skills_match && filters.skills_match.length > 1 
        ? filters.skills_match 
        : null,
      graduation_status: filters?.graduation_status && filters.graduation_status.length > 1 
        ? filters.graduation_status 
        : null,
    };

    const { data, error, count } = await query;

    if (error) throw error;

    // Apply multi-value OR filters in JavaScript (AND logic between filter types)
    let filtered = data || [];
    
    if (orConditions.employment_status) {
      filtered = filtered.filter((r) => 
        orConditions.employment_status!.includes(r.employment_status)
      );
    }
    
    if (orConditions.skills_match) {
      filtered = filtered.filter((r) => 
        orConditions.skills_match!.includes(r.skills_match)
      );
    }
    
    if (orConditions.graduation_status) {
      filtered = filtered.filter((r) => 
        orConditions.graduation_status!.includes(r.graduation_status)
      );
    }

    // Apply search filter (searches trainee name, job title, employer name)
    if (filters?.search && filters.search.trim().length > 0) {
      const searchLower = filters.search.trim().toLowerCase();
      filtered = filtered.filter((r) =>
        (r.trainee?.first_name?.toLowerCase().includes(searchLower)) ||
        (r.trainee?.last_name?.toLowerCase().includes(searchLower)) ||
        (r.job_title?.toLowerCase().includes(searchLower)) ||
        (r.employer_name?.toLowerCase().includes(searchLower))
      );
    }

    return {
      data: filtered as TraineeStatusRecord[],
      count: count || 0,
    };
  }

  /**
   * Get employment summary statistics for a tenant
   */
  async getEmploymentSummary(
    tenantId: string,
    filters?: { program_id?: string; date_from?: string; date_to?: string }
  ): Promise<TraineeStatusSummary> {
    let query = supabaseAdmin
      .from('trainee_status_records')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .eq('graduation_status', 'graduated');

    if (filters?.program_id) {
      query = query.eq('enrollment.program_id', filters.program_id);
    }

    if (filters?.date_from) {
      query = query.gte('recorded_at', `${filters.date_from}T00:00:00`);
    }

    if (filters?.date_to) {
      query = query.lte('recorded_at', `${filters.date_to}T23:59:59`);
    }

    const { data: allRecords, count: totalGraduated, error } = await query;

    if (error) throw error;

    // Calculate statistics
    const records = allRecords || [];
    const employed = records.filter((r) => r.employment_status === 'employed').length;
    const unemployed = records.filter((r) => r.employment_status === 'unemployed').length;
    const deceased = records.filter((r) => r.employment_status === 'deceased').length;
    const selfEmployed = records.filter((r) => r.employment_status === 'self_employed').length;
    const totalEmployed = employed + selfEmployed;

    const exactMatch = records.filter((r) => r.skills_match === 'exact_match').length;
    const partialMatch = records.filter((r) => r.skills_match === 'partial_match').length;
    const noMatch = records.filter((r) => r.skills_match === 'no_match').length;
    const notApplicable = records.filter((r) => r.skills_match === 'not_applicable').length;

    const skillsWithPercentage = records.filter((r) => r.skills_match_percentage !== null);
    const avgSkillsMatch =
      skillsWithPercentage.length > 0
        ? skillsWithPercentage.reduce((sum, r) => sum + (r.skills_match_percentage || 0), 0) /
          skillsWithPercentage.length
        : 0;

    const employmentRate =
      totalGraduated && totalGraduated > 0 ? (totalEmployed / totalGraduated) * 100 : 0;

    return {
      total_completed_trainees: totalGraduated || 0,
      total_graduated: totalGraduated || 0,
      total_employed: totalEmployed,
      total_unemployed: unemployed,
      total_deceased: deceased,
      employment_rate: Math.round(employmentRate * 100) / 100,
      skills_match_stats: {
        exact_match: exactMatch,
        partial_match: partialMatch,
        no_match: noMatch,
        not_applicable: notApplicable,
      },
      average_skills_match_percentage: Math.round(avgSkillsMatch * 100) / 100,
    };
  }

  /**
   * Soft delete trainee status record
   */
  async deleteTraineeStatus(id: string, tenantId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from('trainee_status_records')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw error;
  }

  /**
   * Restore soft-deleted trainee status record
   */
  async restoreTraineeStatus(id: string, tenantId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from('trainee_status_records')
      .update({ deleted_at: null })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw error;
  }

  /**
   * Link trainee status record to enrollment
   * Updates the enrollment record with the trainee_status_record_id foreign key
   */
  async linkStatusRecordToEnrollment(
    enrollmentId: string,
    statusRecordId: string,
    tenantId: string
  ): Promise<void> {
    const { error } = await supabaseAdmin
      .from('enrollments')
      .update({ trainee_status_record_id: statusRecordId })
      .eq('id', enrollmentId)
      .eq('tenant_id', tenantId);

    if (error) throw error;
  }

  /**
   * Get trainee status overview (cached for dashboard)
   */
  async getTraineeStatusOverview(
    tenantId: string
  ): Promise<{
    graduated_count: number;
    employed_count: number;
    unemployed_count: number;
    deceased_count: number;
    pending_count: number;
  }> {
    const { data: records, error } = await supabaseAdmin
      .from('trainee_status_records')
      .select('employment_status, graduation_status')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    if (error) throw error;

    const recordList = records || [];
    const graduated = recordList.filter((r) => r.graduation_status === 'graduated').length;
    const employed = recordList.filter((r) => r.employment_status === 'employed').length;
    const unemployed = recordList.filter((r) => r.employment_status === 'unemployed').length;
    const deceased = recordList.filter((r) => r.employment_status === 'deceased').length;
    const pending = recordList.filter((r) => r.employment_status === 'pending').length;

    return {
      graduated_count: graduated,
      employed_count: employed,
      unemployed_count: unemployed,
      deceased_count: deceased,
      pending_count: pending,
    };
  }
}

export const traineeStatusService = new TraineeStatusService();
export default traineeStatusService;
