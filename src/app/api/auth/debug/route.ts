import { supabaseAdmin } from '@/lib/supabase-admin'; 
import { comparePassword } from '@/lib/auth'; 

export async function GET() { try { const { data: user } = await supabaseAdmin .from('users') .select('id, email, password_hash') .eq('email', 'yemnlart@gmail.com') .single(); if (!user) { return Response.json({ error: 'User not found' }); } const isValid = await comparePassword('Admin123', user.password_hash); return Response.json({ user_email: user.email, password_hash_length: user.password_hash.length, password_hash_starts_with: user.password_hash.substring(0, 7), test_password: 'Admin123', bcrypt_compare_result: isValid }); 
    } catch (error: any) { return Response.json({ error: error.message }); } }