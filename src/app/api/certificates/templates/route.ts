/** * GET  /api/certificates/templates  — list templates (tenant-scoped, Req 16.7) * POST /api/certificates/templates  — create template (tenant-scoped, Req 16.7) * * Requirements: 16.7 */import { NextRequest, NextResponse } from 'next/server';

import { requireTenantContext } from '@/middleware/tenantContext';

import { successResponse, forbiddenResponse } from '@/utils/responses';

import { withErrorHandler } from '@/middleware/errorHandler';

import { handleOptionsRequest } from '@/middleware/cors';

import { listCertificateTemplates,  createCertificateTemplate,} from '@/services/certificateTemplateService';

import { z } from 'zod';

const templateSchema = z.object({ name: z.string().min(1, 'Template name is required').max(100),  accentColor: z  .string()  .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Must be a valid hex color')  .optional(),  secondaryColor: z  .string()  .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Must be a valid hex color')  .optional(),  fontFamily: z.string().max(100).optional(),  signatoryName: z.string().max(255).optional(),  signatoryTitle: z.string().max(255).optional(),  footerText: z.string().max(500).optional(),  showLogo: z.boolean().optional(),});

// OPTIONS /api/certificates/templates

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request);}// GET /api/certificates/templates — list all templates (Req 16.7)

export const GET = withErrorHandler(async (request: NextRequest) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role } = ctxResult.context;

  const allowedRoles = ['local_admin', 'staff_training_coordinator'];
  if (!allowedRoles.includes(role)) { return forbiddenResponse('Insufficient permissions to view certificate templates');
}

const templates = await listCertificateTemplates(tenantId);
  return successResponse(templates);});

// POST /api/certificates/templates — create a new template (Req 16.7)

export const POST = withErrorHandler(async (request: NextRequest) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role } = ctxResult.context;

  const adminRoles = ['local_admin'];
  if (!adminRoles.includes(role)) { return forbiddenResponse('Only admins can create certificate templates');
}

const body = await request.json();
  const payload = templateSchema.parse(body);

  const template = await createCertificateTemplate(tenantId, payload);
  return successResponse(template, 'Certificate template created', 201);});
