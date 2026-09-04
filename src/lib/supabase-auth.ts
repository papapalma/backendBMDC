import { supabaseAdmin } from '@/lib/supabase-admin';
import { User } from '@/types';
import { logger } from '@/utils/logger';

export interface SupabaseIdentity {
  authUserId: string;
  email: string | null;
}

type AppUserAuthInfo = Pick<User, 'id' | 'email' | 'role'> & { tenantId?: string };

export const verifySupabaseAccessToken = async (
  token: string
): Promise<SupabaseIdentity | null> => {
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  return {
    authUserId: data.user.id,
    email: data.user.email ?? null,
  };
};

export const resolveAppUserFromSupabaseIdentity = async (
  identity: SupabaseIdentity
): Promise<AppUserAuthInfo | null> => {
  // Primary lookup: explicit auth identity mapping.

const { data: mappedUser, error: mappedUserError } = await supabaseAdmin
    .from('users')
    .select('id, email, role')
    .eq('auth_user_id', identity.authUserId)
    .maybeSingle();

  if (mappedUserError) {
    logger.error('[SUPABASE_AUTH] Failed auth_user_id lookup', mappedUserError);
    return null;
  }

let appUser: AppUserAuthInfo | null = null;

  if (mappedUser) {
    appUser = mappedUser as AppUserAuthInfo;
  } else {
    // Transitional fallback: map by email and persist auth_user_id.

if (!identity.email) {
      return null;
    }

const { data: emailUser, error: emailUserError } = await supabaseAdmin
      .from('users')
      .select('id, email, role')
      .eq('email', identity.email.toLowerCase())
      .maybeSingle();

    if (emailUserError) {
      logger.error('[SUPABASE_AUTH] Failed email fallback lookup', emailUserError);
      return null;
    }

if (!emailUser) {
      return null;
    }

const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ auth_user_id: identity.authUserId })
      .eq('id', emailUser.id);

    if (updateError) {
      logger.warn('[SUPABASE_AUTH] Could not persist auth_user_id mapping', {
        userId: emailUser.id,
        authUserId: identity.authUserId,
        error: updateError,
      });
    }

    appUser = emailUser as AppUserAuthInfo;
  }

if (!appUser) return null;

  // Resolve tenant ID for the user

if (appUser.role === 'super_admin') {
    appUser.tenantId = 'platform';
  } else {
    const { data: tenantMappings, error: tenantError } = await supabaseAdmin
      .from('users_tenants')
      .select('tenant_id, is_primary')
      .eq('user_id', appUser.id);

    if (tenantError) {
      logger.error('[SUPABASE_AUTH] Failed to fetch tenant mappings', tenantError);
    } else if (tenantMappings && tenantMappings.length > 0) {
      const primary = tenantMappings.find((t: any) => t.is_primary);
      appUser.tenantId = primary ? primary.tenant_id : tenantMappings[0].tenant_id;
    }
  }

  return appUser;
};
