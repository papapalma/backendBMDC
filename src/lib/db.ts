import { supabaseAdmin } from './supabase-admin';

export class DatabaseError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export const executeQuery = async <T>(
  query: Promise<{ data: T | null; error: any }>
): Promise<T> => {
  const { data, error } = await query;
  
  if (error) {
    throw new DatabaseError(error.message, error.code);
  }

if (!data) {
    throw new DatabaseError('No data returned from query');
  }
  
  return data;
};

export const db = {
  // Generic query helpers
  async findById<T>(table: string, id: string): Promise<T | null> {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('*')
      .eq('id', id)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
      throw new DatabaseError(error.message, error.code);
    }
    
    return data as T | null;
  },

  async findAll<T>(
    table: string,
    filters?: Record<string, any>,
    orderBy?: { column: string; ascending?: boolean }
  ): Promise<T[]> {
    let query = supabaseAdmin.from(table).select('*');
    
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
    }

if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    }

const { data, error } = await query;
    
    if (error) {
      throw new DatabaseError(error.message, error.code);
    }
    
    return (data || []) as T[];
  },

  async create<T>(table: string, data: Partial<T>): Promise<T> {
    const { data: result, error } = await supabaseAdmin
      .from(table)
      .insert(data)
      .select()
      .single();
    
    if (error) {
      throw new DatabaseError(error.message, error.code);
    }
    
    return result as T;
  },

  async update<T>(table: string, id: string, data: Partial<T>): Promise<T> {
    const { data: result, error } = await supabaseAdmin
      .from(table)
      .update(data)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      throw new DatabaseError(error.message, error.code);
    }
    
    return result as T;
  },

  async delete(table: string, id: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq('id', id);
    
    if (error) {
      throw new DatabaseError(error.message, error.code);
    }
  },
};

export default db;
