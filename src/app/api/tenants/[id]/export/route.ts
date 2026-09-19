/**
 * POST /api/tenants/:id/export  — trigger a full tenant data export (Req 20.1–20.4)
 * GET  /api/tenants/:id/export  — list existing exports for a tenant
 *
 * Access rules:
 *   - Local Admin: can only export their own tenant
 *   - Super Admin: can export any tenant
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantContext } from '@/middleware/tenantContext';
import { successResponse, forbiddenResponse, errorResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';
import { generateTenantExport,
  listTenantExports, } from '@/services/tenantExportService';

export async function OPTIONS(request: NextRequest) { return handleOptionsRequest(request); }

// GET /api/tenants/:id/ -- list existing exports

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, role, isSuperAdmin } = ctxResult.context;

  const { id: targetTenantId } = await params;

  // Access control: Local Admin can only access their own tenant (Req 20.1)

const adminRoles = ['local_admin', 'super_admin'];
  if (!adminRoles.includes(role) && !isSuperAdmin) { return forbiddenResponse('Only administrators can access tenant exports'); }

if (!isSuperAdmin && targetTenantId !== tenantId) { return forbiddenResponse('You can only access exports for your own tenant'); }

const exports = await listTenantExports(targetTenantId);
  return successResponse(exports); }
);

// POST /api/tenants/:id/ -- generate a new export (Req 20.1-20.4)

export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => { const ctxResult = requireTenantContext(request);
  if (ctxResult.error) return ctxResult.error as NextResponse;

  const { tenantId, userId, role, isSuperAdmin } = ctxResult.context;

  const { id: targetTenantId } = await params;

//  to access their own tenant (Req 20.1)
  const adminRoles = ['local_admin', 'super_admin'];
  if (!adminRoles.includes(role) && !isSuperAdmin) { return forbiddenResponse('Only administrators can export tenant data'); }

if (!isSuperAdmin && targetTenantId !== tenantId) { return forbiddenResponse('You can only export data for your own tenant'); }

const result = await generateTenantExport({ tenantId:  targetTenantId,
  requestedBy: userId, });

  return successResponse(
  result,
  'Export generated successfully. Download link expires in 7 days.',
  201
  ); }
);
