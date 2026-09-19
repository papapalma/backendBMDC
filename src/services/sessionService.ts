import { supabaseAdmin } from '@/lib/supabase-admin';

export interface ProgramSession {
  id: string;
  program_id: string;
  title: string;
  description?: string;
  session_date: string;
  start_time: string;
  end_time: string;
  location?: string;
  session_type: 'lecture' | 'lab' | 'workshop' | 'exam' | 'seminar' | 'field_trip';
  status: 'scheduled' | 'completed' | 'cancelled' | 'postponed';
  created_at: string;
  updated_at: string;
}

export interface CreateSessionData {
  program_id: string;
  title: string;
  description?: string;
  session_date: string;
  start_time: string;
  end_time: string;
  location?: string;
  session_type?: 'lecture' | 'lab' | 'workshop' | 'exam' | 'seminar' | 'field_trip';
}

export interface UpdateSessionData extends Partial<CreateSessionData> {
  status?: 'scheduled' | 'completed' | 'cancelled' | 'postponed';
}

class SessionService {
  private normalizeSessionTitle(title: string | undefined): string {
    return (title || '').trim().toLowerCase();
  }

  private normalizeSessionTime(time: string | undefined): string {
    if (!time) return '';
    return time.length >= 5 ? time.slice(0, 5) : time;
  }

  private makeSessionSignature(session: {
    session_date?: string;
    start_time?: string;
    end_time?: string;
    title?: string;
  }): string {
    return [
      session.session_date || '',
      this.normalizeSessionTime(session.start_time),
      this.normalizeSessionTime(session.end_time),
      this.normalizeSessionTitle(session.title),
    ].join('|');
  }

  async getSessionsByProgram(programId: string) {
    const { data, error } = await supabaseAdmin
      .from('program_sessions')
      .select('*')
      .eq('program_id', programId)
      .order('session_date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) throw error;
    return data;
  }

  async getSessionById(id: string) {
    const { data, error } = await supabaseAdmin
      .from('program_sessions')
      .select('*, program:programs(*)')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }

  async createSession(sessionData: CreateSessionData, tenantId?: string) {
    const payload = tenantId
      ? { ...sessionData, tenant_id: tenantId }
      : sessionData;

    const { data, error } = await supabaseAdmin
      .from('program_sessions')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateSession(id: string, sessionData: UpdateSessionData) {
    const { data, error } = await supabaseAdmin
      .from('program_sessions')
      .update(sessionData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async deleteSession(id: string) {
    const { error } = await supabaseAdmin
      .from('program_sessions')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  async getUpcomingSessions(limit: number = 10) {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabaseAdmin
      .from('program_sessions')
      .select('*, program:programs(id, name)')
      .gte('session_date', today)
      .eq('status', 'scheduled')
      .order('session_date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return data;
  }

  async getTodaySessions() {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabaseAdmin
      .from('program_sessions')
      .select('*, program:programs(id, name)')
      .eq('session_date', today)
      .order('start_time', { ascending: true });

    if (error) throw error;
    return data;
  }

  async bulkCreateSessions(sessions: CreateSessionData[], tenantId?: string) {
    if (sessions.length === 0) return [];

    const programId = sessions[0].program_id;

    // Fetch existing sessions and build full signatures to avoid true duplicates.

const { data: existing, error: fetchError } = await supabaseAdmin
      .from('program_sessions')
      .select('session_date, start_time, end_time, title')
      .eq('program_id', programId);

    if (fetchError) throw fetchError;

    const existingSignatures = new Set(
      (existing ?? []).map((session: any) => this.makeSessionSignature(session))
    );

    // Also dedupe duplicates in the incoming payload itself.

const payloadSignatures = new Set<string>();
    const newSessions = sessions.filter((session) => {
      const signature = this.makeSessionSignature(session);
      if (existingSignatures.has(signature)) return false;
      if (payloadSignatures.has(signature)) return false;
      payloadSignatures.add(signature);
      return true;
    });

    if (newSessions.length === 0) return [];

    // Inject tenant_id into every row when provided

const rowsToInsert = tenantId
      ? newSessions.map(s => ({ ...s, tenant_id: tenantId }))
      : newSessions;

    const { data, error } = await supabaseAdmin
      .from('program_sessions')
      .insert(rowsToInsert)
      .select();

    if (error) throw error;
    return data;
  }
}

export const sessionService = new SessionService();
