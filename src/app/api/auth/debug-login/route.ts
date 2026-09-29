import { NextRequest } from 'next/server'; 
import { supabaseAdmin } from '@/lib/supabase-admin'; 
import { comparePassword } from '@/lib/auth'; 
import { loginSchema } from '@/utils/validators'; 
import { getUserTenants } from '@/services/multiTenantAuthService'; 

export async function POST(request: NextRequest) { try { const body = await request.json(); console.log('[DEBUG-LOGIN] Request body:', { email: body.email, password: body.password ? '***' : 'empty' }); 

// Step 1: Validate 
const validatedData = loginSchema.parse(body); console.log('[DEBUG-LOGIN] Step 1 passed: Validation'); 

console.log('[DEBUG-LOGIN] Email being queried:', { original: body.email, validated: validatedData.email, length: validatedData.email.length, bytes: Buffer.from(validatedData.email).toString('hex') });

// Step 2: Find user 
const { data: user, error } = await supabaseAdmin .from('users') .select('id, email, username, role, password_hash, is_verified') .eq('email', validatedData.email) .single(); console.log('[DEBUG-LOGIN] Step 2:', { userFound: !!user, error: error?.message }); if (!user) return Response.json({ error: 'User not found' }, { status: 404 }); 

// Step 3: Check password 
const isPasswordValid = await comparePassword(validatedData.password, user.password_hash); console.log('[DEBUG-LOGIN] Step 3:', { isPasswordValid }); if (!isPasswordValid) return Response.json({ error: 'Password invalid' }, { status: 401 }); 

// Step 4: Get tenants 
const tenants = await getUserTenants(user.id); console.log('[DEBUG-LOGIN] Step 4:', { tenantCount: tenants.length, tenants }); return Response.json({ success: true, user: { id: user.id, email: user.email, role: user.role }, tenants, }); } catch (error: any) { console.error('[DEBUG-LOGIN] Error:', error.message); return Response.json({ error: error.message, stack: error.stack }, { status: 500 });

}}