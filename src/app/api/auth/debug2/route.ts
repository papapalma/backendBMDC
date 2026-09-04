import { supabaseAdmin } from '@/lib/supabase-admin'; 
import { comparePassword } from '@/lib/auth'; 

async function getUserTenants(userId: string) { 
    const { data, error } = await supabaseAdmin .from('users_tenants') .select(` is_primary, tenants ( id, name, status ) `) .eq('user_id', userId); if (error) throw error; if (!data || data.length === 0) 
        return []; 

    const tenants: Array<{ id: string; name: string; is_primary: boolean; status: string }> = [];

    for (const row of data) { 
        const tenant = row.tenants as any; 
        if (!tenant) continue; 
        if (tenant.status !== 'active') continue; 
        tenants.push({ 
            id: tenant.id, 
            name: tenant.name, 
            is_primary: row.is_primary, 
            status: 'active' as const,
        }); 
    } 
    
    return tenants; 

    } export async function GET() { try { const { data: user } = await supabaseAdmin .from('users') .select('id, email, password_hash, role') .eq('email', 'yemnlart@gmail.com') .single(); if (!user) return Response.json({ error: 'User not found' }); const isValid = await comparePassword('Admin123', user.password_hash); const tenants = await getUserTenants(user.id); return Response.json({ user_email: user.email, user_role: user.role, password_valid: isValid, tenant_count: tenants.length, tenants: tenants }); } catch (error: any) { return Response.json({ error: error.message }); } }