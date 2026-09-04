/**
 * Feature flags and configuration for auth migration
 * 
 * This module centralizes feature flag management for the Supabase Auth migration.
 * Flags control which authentication path is active and enforce gradual rollout.
 */

export interface AuthConfig {
  // Phase 1-3: Enable Supabase Auth integration
  supabaseAuthEnabled: boolean;
  
  // Phase 2: Use Supabase JWT verification instead of custom JWT
  supabaseJwtVerification: boolean;
  
  // Phase 4: Enable optional app JWT exchange endpoint
  appJwtExchange: boolean;
}

/**
 * Load auth configuration from environment variables
 * All flags default to false for safety
 */
export const getAuthConfig = (): AuthConfig => {
  return {
    supabaseAuthEnabled: process.env.FEATURE_SUPABASE_AUTH_ENABLED === 'true',
    supabaseJwtVerification: process.env.FEATURE_SUPABASE_JWT_VERIFICATION === 'true',
    appJwtExchange: process.env.FEATURE_APP_JWT_EXCHANGE === 'true',
  };
};

/**
 * Singleton instance for consistent config access
 */
let authConfigCache: AuthConfig | null = null;

export const getAuthConfigCached = (): AuthConfig => {
  if (!authConfigCache) {
    authConfigCache = getAuthConfig();
  }
  return authConfigCache;
};

/**
 * Reset cached config (useful for testing)
 */
export const resetAuthConfigCache = (): void => {
  authConfigCache = null;
};
