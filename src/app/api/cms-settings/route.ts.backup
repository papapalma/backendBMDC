import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authenticateUser } from '@/middleware/auth';
import { successResponse, errorResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/cms-settings
export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

/**
 * GET /api/cms-settings
 * Get CMS settings for the current tenant
 * Public endpoint - can be called without auth for landing page
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    // Try to authenticate user to get tenant context
    const user = await authenticateUser(request);
    let tenantId: string | undefined;

    if (user) {
      // Authenticated user - use their tenant
      tenantId = user.tenantId && user.tenantId !== 'platform' ? user.tenantId : undefined;
    }

    // Build query to fetch CMS settings
    let query = supabaseAdmin.from('cms_settings').select('*');

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    } else {
      // For unauthenticated users, get the first/default tenant's settings
      query = query.order('created_at', { ascending: true }).limit(50);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[CMS Settings] Query error:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      // No settings found, return empty object
      return successResponse({});
    }

    // Convert array of key-value pairs into a structured object
    const settings: Record<string, any> = {
      hero: {
        badge: '',
        title: '',
        subtitle: '',
        ctaPrimary: 'Enroll Now',
        ctaSecondary: 'Browse Programs',
      },
      appearance: {
        logo: '',
        heroBackground: '',
      },
      mission: '',
      vision: '',
      contact: {
        address: '',
        addressLine2: '',
        phone: '',
        email: '',
        facebook: '',
      },
      footer: {
        companyName: '',
        tagline: '',
      },
    };

    // Map database records to settings structure
    for (const record of data) {
      const key = record.key as string;
      const value = record.value as string;

      // Parse key into nested object path
      if (key.startsWith('hero_')) {
        const heroKey = key.replace('hero_', '');
        settings.hero[heroKey] = value;
      } else if (key.startsWith('appearance_')) {
        const appearanceKey = key.replace('appearance_', '');
        settings.appearance[appearanceKey] = value;
      } else if (key.startsWith('contact_')) {
        const contactKey = key.replace('contact_', '');
        settings.contact[contactKey] = value;
      } else if (key.startsWith('footer_')) {
        const footerKey = key.replace('footer_', '');
        settings.footer[footerKey] = value;
      } else if (key === 'mission') {
        settings.mission = value;
      } else if (key === 'vision') {
        settings.vision = value;
      }
    }

    return successResponse(settings);
  } catch (error) {
    console.error('[CMS Settings] Error fetching settings:', error);
    // Return empty settings instead of error for better UX
    return successResponse({});
  }
});


