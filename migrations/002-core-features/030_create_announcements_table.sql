-- Migration: 030_create_announcements_table.sql
-- Description: Create announcements table for institution broadcasts and landing page showcases

CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    media_url VARCHAR(500),
    media_type VARCHAR(50) DEFAULT 'none', -- 'image' | 'video' | 'none'
    is_published BOOLEAN DEFAULT true,
    expires_at TIMESTAMPTZ,
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast public queries of active, published announcements
CREATE INDEX IF NOT EXISTS idx_announcements_published 
    ON public.announcements (is_published, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcements_tenant 
    ON public.announcements (tenant_id, is_published);
