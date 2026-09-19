import { supabaseAdmin } from '@/lib/supabase-admin';
import { TenantContext } from '@/middleware/tenantContext';

export interface BorrowingSlip {
  id: string;
  tenant_id: string;
  lending_id: string;
  item_id: string;
  borrower_name: string;
  item_name: string;
  borrowing_date: string;
  due_date: string;
  quantity: number;
  item_description?: string;
  borrower_contact?: string;
  notes?: string;
  slip_number?: string;
  status: 'active' | 'returned' | 'overdue';
  generated_at: string;
  returned_at?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateBorrowingSlipInput {
  lending_id: string;
  item_id: string;
  borrower_name: string;
  item_name: string;
  due_date: string; // ISO date string (YYYY-MM-DD)
  quantity?: number;
  item_description?: string;
  borrower_contact?: string;
  notes?: string;
}

export class BorrowingSlipService {
  /**
   * Generate a unique slip number based on date and sequence
   * Format: SLIP-YYYYMMDD-XXXX (where XXXX is sequence number)
   */
  private async generateSlipNumber(tenantId: string): Promise<string> {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    
    // Get count of slips created today for this tenant
    const { count, error } = await supabaseAdmin
      .from('borrowing_slips')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', new Date().toISOString().split('T')[0]);
    
    if (error) throw error;
    
    const sequence = String((count || 0) + 1).padStart(4, '0');
    return `SLIP-${today}-${sequence}`;
  }

  /**
   * Create a new borrowing slip when an item is borrowed
   * This is typically called during the lending creation process
   */
  async createBorrowingSlip(
    slipData: CreateBorrowingSlipInput,
    userId: string,
    tenantId: string
  ): Promise<BorrowingSlip> {
    // Generate unique slip number
    const slipNumber = await this.generateSlipNumber(tenantId);
    
    // Current date as borrowing date
    const borrowingDate = new Date().toISOString().split('T')[0];
    
    const newSlip = {
      tenant_id: tenantId,
      lending_id: slipData.lending_id,
      item_id: slipData.item_id,
      borrower_name: slipData.borrower_name,
      item_name: slipData.item_name,
      borrowing_date: borrowingDate,
      due_date: slipData.due_date,
      quantity: slipData.quantity || 1,
      item_description: slipData.item_description,
      borrower_contact: slipData.borrower_contact,
      notes: slipData.notes,
      slip_number: slipNumber,
      status: 'active',
      created_by: userId,
    };

    const { data: slip, error } = await supabaseAdmin
      .from('borrowing_slips')
      .insert(newSlip)
      .select('*')
      .single();

    if (error) throw error;
    return slip;
  }

  /**
   * Retrieve a borrowing slip by ID
   */
  async getBorrowingSlipById(
    context: TenantContext | null,
    id: string
  ): Promise<BorrowingSlip | null> {
    let query = supabaseAdmin
      .from('borrowing_slips')
      .select('*')
      .eq('id', id);

    if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  }

  /**
   * Retrieve borrowing slip by slip number
   */
  async getBorrowingSlipByNumber(
    context: TenantContext | null,
    slipNumber: string
  ): Promise<BorrowingSlip | null> {
    let query = supabaseAdmin
      .from('borrowing_slips')
      .select('*')
      .eq('slip_number', slipNumber);

    if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  }

  /**
   * Retrieve all borrowing slips with optional filters
   */
  async getAllBorrowingSlips(
    context: TenantContext | null,
    filters?: {
      status?: string;
      borrower_name?: string;
      start_date?: string;
      end_date?: string;
      item_id?: string;
      lending_id?: string;
    }
  ): Promise<BorrowingSlip[]> {
    let query = supabaseAdmin
      .from('borrowing_slips')
      .select('*');

    if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.borrower_name) {
      query = query.ilike('borrower_name', `%${filters.borrower_name}%`);
    }

    if (filters?.item_id) {
      query = query.eq('item_id', filters.item_id);
    }

    if (filters?.lending_id) {
      query = query.eq('lending_id', filters.lending_id);
    }

    if (filters?.start_date) {
      query = query.gte('borrowing_date', filters.start_date);
    }

    if (filters?.end_date) {
      query = query.lte('borrowing_date', filters.end_date);
    }

    query = query.order('borrowing_date', { ascending: false });

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  /**
   * Get active borrowing slips (not yet returned)
   */
  async getActiveBorrowingSlips(
    context: TenantContext | null
  ): Promise<BorrowingSlip[]> {
    return this.getAllBorrowingSlips(context, { status: 'active' });
  }

  /**
   * Get overdue borrowing slips (due date passed but not returned)
   */
  async getOverdueBorrowingSlips(
    context: TenantContext | null
  ): Promise<BorrowingSlip[]> {
    const today = new Date().toISOString().split('T')[0];
    
    let query = supabaseAdmin
      .from('borrowing_slips')
      .select('*')
      .eq('status', 'active')
      .lt('due_date', today);

    if (context && !context.isSuperAdmin) {
      query = query.eq('tenant_id', context.tenantId);
    }

    query = query.order('due_date', { ascending: true });

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  /**
   * Get borrowing slips for a specific lending record
   */
  async getSlipsForLending(
    context: TenantContext | null,
    lendingId: string
  ): Promise<BorrowingSlip[]> {
    return this.getAllBorrowingSlips(context, { lending_id: lendingId });
  }

  /**
   * Mark a borrowing slip as returned
   */
  async markAsReturned(
    context: TenantContext | null,
    id: string,
    notes?: string
  ): Promise<BorrowingSlip> {
    const slip = await this.getBorrowingSlipById(context, id);
    if (!slip) {
      throw new Error('Borrowing slip not found');
    }

    if (slip.status === 'returned') {
      throw new Error('Borrowing slip already marked as returned');
    }

    const updateData = {
      status: 'returned',
      returned_at: new Date().toISOString(),
      ...(notes && { notes: slip.notes ? `${slip.notes}\n${notes}` : notes }),
    };

    const { data: updated, error } = await supabaseAdmin
      .from('borrowing_slips')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return updated;
  }

  /**
   * Update borrowing slip status based on due date
   * Marks active slips as overdue if due_date has passed
   */
  async updateOverdueStatus(tenantId?: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    
    let query = supabaseAdmin
      .from('borrowing_slips')
      .select('*')
      .eq('status', 'active')
      .lt('due_date', today);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data: slips, error } = await query;

    if (error) throw error;

    let count = 0;
    for (const slip of slips || []) {
      let updateQuery = supabaseAdmin
        .from('borrowing_slips')
        .update({ status: 'overdue' })
        .eq('id', slip.id);

      if (tenantId) {
        updateQuery = updateQuery.eq('tenant_id', tenantId);
      }

      await updateQuery;
      count++;
    }

    return count;
  }

  /**
   * Get borrowing slip statistics for a tenant
   */
  async getBorrowingSlipStats(
    context: TenantContext | null
  ): Promise<{
    total: number;
    active: number;
    returned: number;
    overdue: number;
    dueToday: number;
  }> {
    const today = new Date().toISOString().split('T')[0];

    let baseQuery = supabaseAdmin.from('borrowing_slips').select('*');
    
    if (context && !context.isSuperAdmin) {
      baseQuery = baseQuery.eq('tenant_id', context.tenantId);
    }

    const { data: allSlips, error: allError } = await baseQuery;
    if (allError) throw allError;

    const total = allSlips?.length || 0;
    const active = allSlips?.filter(s => s.status === 'active').length || 0;
    const returned = allSlips?.filter(s => s.status === 'returned').length || 0;
    const overdue = allSlips?.filter(s => s.status === 'overdue').length || 0;
    const dueToday = allSlips?.filter(
      s => s.status === 'active' && s.due_date === today
    ).length || 0;

    return { total, active, returned, overdue, dueToday };
  }

  /**
   * Delete a borrowing slip (only if not yet printed/used)
   */
  async deleteBorrowingSlip(
    context: TenantContext | null,
    id: string
  ): Promise<void> {
    const slip = await this.getBorrowingSlipById(context, id);
    if (!slip) {
      throw new Error('Borrowing slip not found');
    }

    let deleteQuery = supabaseAdmin
      .from('borrowing_slips')
      .delete()
      .eq('id', id);

    if (context && !context.isSuperAdmin) {
      deleteQuery = deleteQuery.eq('tenant_id', context.tenantId);
    }

    const { error } = await deleteQuery;
    if (error) throw error;
  }
}

export const borrowingSlipService = new BorrowingSlipService();
