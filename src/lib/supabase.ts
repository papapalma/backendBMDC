import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : (createMissingProxy('Supabase client') as any);

export const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : (createMissingProxy('Supabase admin client') as any);

export default supabase;
