import { NextRequest, NextResponse } from 'next/server';
import { activityLogService } from '@/services/activityLogService';
import { requireRoleAsync } from '@/middleware/auth';
import { successResponse } from '@/utils/responses';
import { withErrorHandler } from '@/middleware/errorHandler';
import { handleOptionsRequest } from '@/middleware/cors';

// OPTIONS /api/activity-logs - Handle CORS preflight

export async function OPTIONS(request: NextRequest) {
  return handleOptionsRequest(request);
}

// GET /api/activity-logs - Get activity logs (admin and super_admin)

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRoleAsync(request, ['local_admin', 'super_admin']);
  if ('error' in authResult) return authResult.error as NextResponse;
  
  const user = authResult.user;
  const { searchParams } = new URL(request.url);
  const user_id = searchParams.get('user_id') || undefined;
  const entity_type = searchParams.get('entity_type') || undefined;
  const action = searchParams.get('action') || undefined;
  const start_date = searchParams.get('start_date') || undefined;
  const end_date = searchParams.get('end_date') || undefined;
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : undefined;
  let tenant_id = searchParams.get('tenant_id') || undefined;
  
  // Determine if user is super_admin
  const isSuperAdmin = user.role === 'super_admin';
  
  // Tenant isolation: 
  // - Super admins: bypass restrictions (can see all or filter by optional tenant_id)
  // - Local admins: MUST see only their own tenant's logs
  if (!isSuperAdmin) {
    tenant_id = user.tenantId;
  }
  
  // For super admins, use the optional tenant_id from query params if provided
  const logs = await activityLogService.getAllLogs({
    user_id,
    entity_type,
    action,
    start_date,
    end_date,
    limit,
    tenant_id,
    is_super_admin: isSuperAdmin,
  });
  
  // Transform to camelCase for frontend
// Requirement 9.1: Mark enrollment changes from API vs WebSocket

const transformedLogs = logs.map(log => {
  // Requirement 9.1: Extract event source from metadata
  // Events from event bus will have eventSource in details: 'api' or 'websocket'
  const eventSource = (log as any).metadata?.eventSource || 'unknown';
  
  return {
    id: log.id,
    userId: log.user_id,
    userName: (log as any).userName,
    action: log.action,
    module: (log as any).module,
    entityType: log.entity_type,
    entityId: log.entity_id,
    description: (log as any).description,
    metadata: (log as any).metadata,
    ipAddress: log.ip_address,
    userAgent: log.user_agent,
    createdAt: log.created_at,
    // Cross-tenant fields
    tenantId: (log as any).tenant_id,
    tenantName: (log as any).tenantName,
    scope: (log as any).scope,
    // Requirement 9.1: Event source tracking
    eventSource: eventSource,
    isWebSocketEvent: eventSource === 'websocket',
    isApiEvent: eventSource === 'api',
  };
});
  
  return successResponse(transformedLogs);
});
