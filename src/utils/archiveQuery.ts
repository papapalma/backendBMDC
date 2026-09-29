import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Mapping of entity types to their corresponding table names
 */
export const ARCHIVE_TABLES = {
  trainee: 'trainees',
  program: 'programs',
  trainee_status: 'trainee_status_records',
  training_requirement_file: 'training_requirement_files',
} as const;

export type ArchivedEntityType = keyof typeof ARCHIVE_TABLES;

/**
 * Query filters for archived items
 */
export interface ArchiveQueryFilters {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

/**
 * Response structure for paginated archive results
 */
export interface ArchiveQueryResult {
  data: any[];
  count: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Query builder for soft-deleted (archived) items across any table.
 *
 * Fetches only records where deleted_at IS NOT NULL, filtered by tenant_id.
 * Supports pagination, sorting, and search.
 *
 * @param supabaseClient - Supabase admin client
 * @param tableName - Name of the table to query
 * @param tenantId - Tenant ID for isolation (filters records by tenant_id)
 * @param filters - Optional filters: page, limit, sortBy, sortOrder, search
 * @returns Paginated archive results
 *
 * @example
 * const result = await queryArchivedItems(
 *   supabaseAdmin,
 *   'trainees',
 *   'tenant-123',
 *   { page: 1, limit: 20, search: 'John', sortBy: 'deleted_at', sortOrder: 'desc' }
 * );
 */
export async function queryArchivedItems(
  supabaseClient: SupabaseClient,
  tableName: string,
  tenantId: string,
  filters?: ArchiveQueryFilters
): Promise<ArchiveQueryResult> {
  const page = filters?.page || 1;
  const limit = filters?.limit || 20;
  const sortBy = filters?.sortBy || 'deleted_at';
  const sortOrder = filters?.sortOrder || 'desc';
  const search = filters?.search?.trim() || '';

  // Validate page and limit
  const validPage = Math.max(1, page);
  const validLimit = Math.max(1, Math.min(limit, 1000)); // Cap at 1000 to prevent abuse

  const offset = (validPage - 1) * validLimit;

  try {
    // Build the base query: only soft-deleted records for this tenant
    let query = supabaseClient
      .from(tableName)
      .select('*', { count: 'exact' })
      .not('deleted_at', 'is', null) // WHERE deleted_at IS NOT NULL
      .eq('tenant_id', tenantId);

    // Apply search filter if provided
    if (search) {
      // Search on common fields (adjust based on table structure if needed)
      // For trainees: search by first_name, last_name, email
      // For programs: search by name
      // For trainee_status_records: search by id (minimal)
      const searchFields = getSearchFieldsForTable(tableName);
      if (searchFields.length > 0) {
        const searchCondition = searchFields
          .map((field) => `${field}.ilike.%${search}%`)
          .join(',');
        query = query.or(searchCondition);
      }
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + validLimit - 1);

    // Execute query
    const { data, error, count } = await query;

    if (error) {
      console.error(`[archiveQuery] Error querying ${tableName}:`, error);
      throw new Error(`Failed to query archived items from ${tableName}: ${error.message}`);
    }

    const totalPages = Math.ceil((count || 0) / validLimit);

    return {
      data: data || [],
      count: count || 0,
      page: validPage,
      limit: validLimit,
      totalPages,
    };
  } catch (err) {
    console.error(`[archiveQuery] Exception in queryArchivedItems for ${tableName}:`, err);
    throw err;
  }
}

/**
 * Get searchable fields for a given table
 * Used to determine which fields to include in search filters
 */
function getSearchFieldsForTable(tableName: string): string[] {
  const searchFieldsMap: Record<string, string[]> = {
    trainees: ['first_name', 'last_name', 'email'],
    programs: ['name'],
    trainee_status_records: ['id'], // Limited search capability
    training_requirement_files: ['name', 'file_name'],
  };
  return searchFieldsMap[tableName] || [];
}

/**
 * Check if a table has a deleted_at column
 * Used to verify soft-delete support before querying
 */
function supportsArchive(tableName: string): boolean {
  // Only these tables support soft deletes
  const archiveSupportedTables = ['trainees', 'programs', 'trainee_status_records', 'training_requirement_files'];
  return archiveSupportedTables.includes(tableName);
}
