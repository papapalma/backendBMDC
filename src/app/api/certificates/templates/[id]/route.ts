/**
 * GET    /api/certificates/templates/:id  — get template (Req 16.7)
 * PATCH  /api/certificates/templates/:id  — update template (Req 16.7)
 * DELETE /api/certificates/templates/:id  — delete template (Req 16.7)
 * POST   /api/certificates/templates/:id/set-default — set as default (Req 16.7)
 *
 * Requirements: 16.7
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse,
  notFoundResponse,
  noContentResponse,
  forbiddenResponse, } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { getCertificateTemplate,
  updateCertificateTemplate,
  deleteCertificateTemplate,
  setDefaultCertificateTemplate, } from '@/services/certificateTemplateService';
import { z } from 'zod';

const updateTemplateSchema = z.object({ name: z.string().min(1).max(100).optional(),
  accentColor: z
    .string()
    .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
    .optional(),
  secondaryColor: z
    .string()
    .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
    .optional(),
  fontFamily: z.string().max(100).optional(),
  signatoryName: z.string().max(255).optional(),
  signatoryTitle: z.string().max(255).optional(),
  footerText: z.string().max(500).optional(),
  showLogo: z.boolean().optional(), });

// OPTIONS /api/certificates/templates/:id

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/certificates/templates/:id

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, role } = ctxResult.context;

    const allowedRoles = ['local_admin', 'staff_training_coordinator'];
    if (!allowedRoles.includes(role)) { return forbiddenResponse('Insufficient permissions'); }

const { id } = await params;
    const template = await getCertificateTemplate(tenantId, id);
    if (!template) return notFoundResponse('Certificate template not found');

    return successResponse(template); }
);

// PATCH /api/certificates/templates/:id — partial update (Req 16.7)

export const PATCH = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, role } = ctxResult.context;

    const adminRoles = ['local_admin', 'super_admin'];
    if (!adminRoles.includes(role)) { return forbiddenResponse('Only admins can update certificate templates'); }

const { id } = await params;
    const body = await request.json();
    const payload = updateTemplateSchema.parse(body);

    const updated = await updateCertificateTemplate(tenantId, id, payload);
    return successResponse(updated, 'Certificate template updated'); }
);

// DELETE /api/certificates/templates/:id (Req 16.7)

export const DELETE = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, role } = ctxResult.context;

    const adminRoles = ['local_admin', 'super_admin'];
    if (!adminRoles.includes(role)) { return forbiddenResponse('Only admins can delete certificate templates'); }

const { id } = await params;
    await deleteCertificateTemplate(tenantId, id);
    return noContentResponse(); }
);

// POST /api/certificates/templates/:id/set-default — promote to default (Req 16.7)

export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
    if (ctxResult.error) return ctxResult.error as NextResponse;

    const { tenantId, role } = ctxResult.context;

    const adminRoles = ['local_admin', 'super_admin'];
    if (!adminRoles.includes(role)) { return forbiddenResponse('Only admins can set the default certificate template'); }

const { id } = await params;
    const templates = await setDefaultCertificateTemplate(tenantId, id);
    return successResponse(templates, 'Default template updated'); }
);
