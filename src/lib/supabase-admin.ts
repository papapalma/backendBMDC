import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const createMissingProxy = (name: string) =>
  new Proxy(
    {},
    {
      get() {
        throw new Error(`${name} not configured. Set required environment variables.`);
      },
      apply() {
        throw new Error(`${name} not configured. Set required environment variables.`);
      },
    }
  );

// Configure WebSocket for Node.js environments (including tests)
let transportConfig = {};
if (typeof WebSocket === 'undefined') {
  try {
    const ws = require('ws');
    transportConfig = { realtime: { transport: ws } };
  } catch (e) {
    // ws not available, will use default behavior
  }
}

export const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        ...transportConfig,
      })
    : (createMissingProxy('Supabase admin client') as any);

/**
 * Admin functions that bypass Row Level Security
 * Use these only when necessary and with proper authorization
 */

export const adminOperations = {
  /**
   * Create a new user with custom role
   */
  async createUser(userData: {
    email: string;
    username: string;
    password_hash: string;
    role: 'super_admin' | 'local_admin' | 'staff_training_coordinator' | 'staff_inventory_manager' | 'trainee';
  }) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .insert(userData)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  /**
   * Update user role (admin only)
   */
  async updateUserRole(userId: string, role: 'super_admin' | 'local_admin' | 'staff_training_coordinator' | 'staff_inventory_manager' | 'trainee') {
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ role })
      .eq('id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  /**
   * Delete user (admin only)
   */
  async deleteUser(userId: string) {
    const { error } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId);
    
    if (error) throw error;
  },

  /**
   * Get all users (admin only)
   */
  async getAllUsers() {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, username, role, created_at, updated_at')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  },

  /**
   * Bulk delete activity logs older than specified days
   */
  async cleanupOldLogs(daysOld: number = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const { error } = await supabaseAdmin
      .from('activity_logs')
      .delete()
      .lt('created_at', cutoffDate.toISOString());
    
    if (error) throw error;
  },

  /**
   * Force update item quantities (inventory adjustment)
   */
  async adjustInventory(itemId: string, newQuantity: number, newAvailableQuantity: number) {
    const { data, error } = await supabaseAdmin
      .from('items')
      .update({
        quantity: newQuantity,
        available_quantity: newAvailableQuantity,
      })
      .eq('id', itemId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    const [users, items, programs, trainees, lendings, anomalies, logs] = await Promise.all([
      supabaseAdmin.from('users').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('items').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('programs').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('trainees').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('lendings').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('anomalies').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('activity_logs').select('id', { count: 'exact', head: true }),
    ]);

    return {
      users: users.count || 0,
      items: items.count || 0,
      programs: programs.count || 0,
      trainees: trainees.count || 0,
      lendings: lendings.count || 0,
      anomalies: anomalies.count || 0,
      activityLogs: logs.count || 0,
    };
  },
};

export default supabaseAdmin;
