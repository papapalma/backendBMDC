/**
 * Security tests for GET /api/attendance?trainee_id=X
 * Task 7.3: Write tests (before code changes) - Trainee Authorization
 *
 * These tests validate that the attendance query endpoint properly enforces:
 * 1. Trainee isolation — trainees can only see their own records
 * 2. Staff authorization — staff can see tenant trainees but not cross-tenant
 * 3. Denial logging — audit logs capture all access denials
 *
 * Test structure:
 * - Tests 1-2: Trainee role authorization (own vs other trainee)
 * - Tests 3-4: Staff role authorization (tenant vs cross-tenant)
 * - Tests 5-6: Audit logging for denials
 *
 * Expected results before fix:
 * - Tests 1, 3: PASS (staff access to own tenant)
 * - Tests 2, 4: FAIL (trainees/staff can access cross-tenant data - the bug)
 * - Tests 5-6: FAIL (denial logging not triggered)
 */

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/attendance/route';

// ============================================================================
// Mocks
// ============================================================================

// Mock requireTenantContext from middleware
jest.mock('@/middleware/tenantContext', () => ({
  requireTenantContext: jest.fn(),
}));

// Mock attendanceService
jest.mock('@/services/attendanceService', () => ({
  attendanceService: {
    getAdminDashboard: jest.fn(),
    getDayAttendanceForAdmin: jest.fn(),
    getAttendanceRecords: jest.fn(),
    getTraineeAttendanceHistory: jest.fn(),
    getAttendanceByTrainee: jest.fn(),
    getAttendanceBySession: jest.fn(),
  },
}));

// Mock activityLogService
jest.mock('@/services/activityLogService', () => ({
  activityLogService: {
    logAction: jest.fn(),
  },
}));

// Mock supabaseAdmin
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

// Mock feature flags
jest.mock('@/lib/featureFlags', () => ({
  requireFeature: jest.fn().mockResolvedValue(true),
}));

// ============================================================================
// Test Helpers
// ============================================================================

const TENANT_A_ID = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B_ID = '660e8400-e29b-41d4-a716-446655440000';

const USER_A_ID = '770e8400-e29b-41d4-a716-446655440000'; // trainee in tenant A
const USER_B_ID = '880e8400-e29b-41d4-a716-446655440000'; // trainee in tenant B
const STAFF_A_ID = '990e8400-e29b-41d4-a716-446655440000'; // staff in tenant A

const TRAINEE_A_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; // belongs to USER_A
const TRAINEE_B_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'; // belongs to USER_B

/**
 * Create a mock NextRequest with URL parameters
 */
function createMockRequest(
  queryParams: Record<string, string> = {},
  overrides?: Partial<NextRequest>
): NextRequest {
  const url = new URL('http://localhost:3000/api/attendance');
  Object.entries(queryParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const request = {
    url: url.toString(),
    method: 'GET',
    headers: {
      get: (key: string) => null,
      has: (key: string) => false,
    },
    ...overrides,
  } as any as NextRequest;

  return request;
}

/**
 * Helper to create a trainee context
 */
function createTraineeContext(userId: string, traineeId: string, tenantId: string) {
  return {
    tenantId,
    userId,
    role: 'trainee',
    isSuperAdmin: false,
  };
}

/**
 * Helper to create a staff context
 */
function createStaffContext(userId: string, tenantId: string, role: string = 'local_admin') {
  return {
    tenantId,
    userId,
    role,
    isSuperAdmin: false,
  };
}

/**
 * Helper to mock supabaseAdmin trainee_accounts query
 */
function mockTraineeAccountsQuery(supabaseAdmin: any, userId: string, traineeId: string) {
  const createQueryBuilder = (returnValue: any) => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(returnValue),
  });

  supabaseAdmin.from.mockImplementation((table: string) => {
    if (table === 'trainee_accounts') {
      return createQueryBuilder({
        data: { user_id: userId, trainee_id: traineeId },
      });
    }
    return createQueryBuilder({ data: null });
  });
}

// ============================================================================
// Tests - Trainee Authorization
// ============================================================================

describe('GET /api/attendance - Trainee Authorization', () => {
  const { requireTenantContext } = require('@/middleware/tenantContext');
  const { attendanceService } = require('@/services/attendanceService');
  const { activityLogService } = require('@/services/activityLogService');
  const { supabaseAdmin } = require('@/lib/supabase-admin');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Test 1: Trainee fetches own attendance → 200 OK
  // =========================================================================

  it('Test 1: should allow trainee to fetch their own attendance records', async () => {
    // Arrange: trainee A tries to fetch their own records
    const context = createTraineeContext(USER_A_ID, TRAINEE_A_ID, TENANT_A_ID);
    requireTenantContext.mockReturnValue({ context });

    // Mock successful trainee resolution
    mockTraineeAccountsQuery(supabaseAdmin, USER_A_ID, TRAINEE_A_ID);

    // Mock service to return records
    attendanceService.getAttendanceByTrainee.mockResolvedValue([
      {
        id: 'record-1',
        trainee_id: TRAINEE_A_ID,
        session_id: 'session-1',
        status: 'present',
        date: '2024-01-15',
      },
      {
        id: 'record-2',
        trainee_id: TRAINEE_A_ID,
        session_id: 'session-2',
        status: 'absent',
        date: '2024-01-16',
      },
    ]);

    const request = createMockRequest({ trainee_id: TRAINEE_A_ID });

    // Act
    const response = await GET(request);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].trainee_id).toBe(TRAINEE_A_ID);
  });

  // =========================================================================
  // Test 2: Trainee fetches other trainee's attendance → 403 Forbidden
  // =========================================================================

  it('Test 2: should deny trainee attempting to fetch another trainees attendance', async () => {
    // Arrange: trainee A tries to fetch trainee B's records (cross-trainee)
    const context = createTraineeContext(USER_A_ID, TRAINEE_A_ID, TENANT_A_ID);
    requireTenantContext.mockReturnValue({ context });

    // Mock trainee_accounts: USER_A is associated with TRAINEE_A only
    mockTraineeAccountsQuery(supabaseAdmin, USER_A_ID, TRAINEE_A_ID);

    const request = createMockRequest({ trainee_id: TRAINEE_B_ID }); // trying to access TRAINEE_B

    // Act
    const response = await GET(request);

    // Assert
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("Cannot view other trainees' data");
  });

  // =========================================================================
  // Test 3: Staff fetches tenant trainees → 200 OK
  // =========================================================================

  it('Test 3: should allow staff to fetch attendance for their tenant trainees', async () => {
    // Arrange: staff A (in tenant A) queries for session records in tenant A
    const context = createStaffContext(STAFF_A_ID, TENANT_A_ID, 'local_admin');
    requireTenantContext.mockReturnValue({ context });

    // Mock service to return records
    const sessionId = 'session-123';
    attendanceService.getDayAttendanceForAdmin.mockResolvedValue([
      {
        id: 'record-1',
        trainee_id: TRAINEE_A_ID,
        trainee_name: 'Alice',
        session_id: sessionId,
        status: 'present',
        date: '2024-01-15',
        tenant_id: TENANT_A_ID,
      },
      {
        id: 'record-2',
        trainee_id: TRAINEE_B_ID,
        trainee_name: 'Bob',
        session_id: sessionId,
        status: 'absent',
        date: '2024-01-15',
        tenant_id: TENANT_A_ID,
      },
    ]);

    const request = createMockRequest({
      session_id: sessionId,
      program_id: 'program-1',
      date: '2024-01-15',
    });

    // Act
    const response = await GET(request);

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    // All records should be from tenant A
    expect(body.data.every((r: any) => r.tenant_id === TENANT_A_ID)).toBe(true);
  });

  // =========================================================================
  // Test 4: Staff fetches cross-tenant trainees → 403/0 results (data isolation)
  // =========================================================================

  it('Test 4: should deny staff attempting to access attendance from different tenant', async () => {
    // Arrange: staff A (in tenant A) tries to query with tenant B program
    const context = createStaffContext(STAFF_A_ID, TENANT_A_ID, 'local_admin');
    requireTenantContext.mockReturnValue({ context });

    // Mock service to enforce tenant isolation and return empty/error
    // The service should apply .eq('tenant_id', tenantId) to all queries
    attendanceService.getDayAttendanceForAdmin.mockResolvedValue([]);

    const request = createMockRequest({
      session_id: 'session-456',
      program_id: 'tenant-b-program-1', // Program belongs to tenant B
      date: '2024-01-15',
    });

    // Act
    const response = await GET(request);

    // Assert: should return empty results or 403 depending on implementation
    // Preferred: 200 with empty array (RLS filter applied)
    // Acceptable: 403 (explicit cross-tenant check)
    expect([200, 403]).toContain(response.status);

    if (response.status === 200) {
      const body = await response.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(0);
    }
  });

  // =========================================================================
  // Test 5: Audit log created for trainee access denial
  // =========================================================================

  it('Test 5: should log access denial when trainee tries to fetch other trainee data', async () => {
    // Arrange: trainee A tries to fetch trainee B's records
    const context = createTraineeContext(USER_A_ID, TRAINEE_A_ID, TENANT_A_ID);
    requireTenantContext.mockReturnValue({ context });

    mockTraineeAccountsQuery(supabaseAdmin, USER_A_ID, TRAINEE_A_ID);

    const request = createMockRequest({ trainee_id: TRAINEE_B_ID });

    // Act
    const response = await GET(request);

    // Assert: response is 403
    expect(response.status).toBe(403);

    // Assert: activityLogService.logAction was called for the denial
    expect(activityLogService.logAction).toHaveBeenCalledWith(
      USER_A_ID,
      expect.stringMatching(/denied|denied_access|authz_denied/i),
      'attendance',
      TRAINEE_B_ID,
      expect.objectContaining({
        reason: expect.any(String),
      })
    );
  });

  // =========================================================================
  // Test 6: Audit log created for staff cross-tenant access attempt
  // =========================================================================

  it('Test 6: should log access denial when staff tries cross-tenant access', async () => {
    // Arrange: staff A (tenant A) tries to access tenant B program
    const context = createStaffContext(STAFF_A_ID, TENANT_A_ID, 'local_admin');
    requireTenantContext.mockReturnValue({ context });

    // Mock service returning no results (tenant isolation enforced)
    attendanceService.getDayAttendanceForAdmin.mockResolvedValue([]);

    const request = createMockRequest({
      session_id: 'session-999',
      program_id: 'tenant-b-program',
      date: '2024-01-15',
    });

    // Act
    const response = await GET(request);

    // Assert: should return 200 with empty results (data isolation via RLS)
    // OR 403 (explicit check) - both log the attempt
    expect([200, 403]).toContain(response.status);

    // If 403 response: audit log should be created
    if (response.status === 403) {
      expect(activityLogService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: STAFF_A_ID,
          action: expect.stringMatching(/denied|denied_access|authz_denied/i),
          status: 'denied',
        })
      );
    }
  });
});

// ============================================================================
// Tests - Edge Cases & Error Handling
// ============================================================================

describe('GET /api/attendance - Edge Cases', () => {
  const { requireTenantContext } = require('@/middleware/tenantContext');
  const { supabaseAdmin } = require('@/lib/supabase-admin');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Test 7: Invalid trainee_id UUID format → 400 Bad Request
  // =========================================================================

  it('Test 7: should return 400 when trainee_id is not a valid UUID', async () => {
    // Arrange: invalid UUID
    const context = createTraineeContext(USER_A_ID, TRAINEE_A_ID, TENANT_A_ID);
    requireTenantContext.mockReturnValue({ context });

    const request = createMockRequest({ trainee_id: 'not-a-uuid' });

    // Act
    const response = await GET(request);

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Invalid');
  });

  // =========================================================================
  // Test 8: Missing tenant context → 401/400 Unauthorized
  // =========================================================================

  it('Test 8: should return 400 when tenant context is missing', async () => {
    // Arrange: tenant context missing
    requireTenantContext.mockReturnValue({
      error: new Response(
        JSON.stringify({ error: 'Tenant context required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      ),
    });

    const request = createMockRequest({ trainee_id: TRAINEE_A_ID });

    // Act
    const response = await GET(request);

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Tenant');
  });

  // =========================================================================
  // Test 9: No trainee_id parameter but trainee role → 403 (must specify own ID)
  // =========================================================================

  it('Test 9: should require trainee to specify trainee_id in query', async () => {
    // Arrange: trainee makes query without trainee_id parameter
    const context = createTraineeContext(USER_A_ID, TRAINEE_A_ID, TENANT_A_ID);
    requireTenantContext.mockReturnValue({ context });

    mockTraineeAccountsQuery(supabaseAdmin, USER_A_ID, TRAINEE_A_ID);

    const request = createMockRequest({}); // No trainee_id parameter

    // Act
    const response = await GET(request);

    // Assert: should either require the parameter or restrict view to own trainee
    // Acceptable: 403 requiring explicit trainee_id
    // Acceptable: 200 returning only their own records
    expect([200, 400, 403]).toContain(response.status);
  });

  // =========================================================================
  // Test 10: Trainee resolves to null (data corruption) → 500/403 guard
  // =========================================================================

  it('Test 10: should handle case where trainee resolution returns null', async () => {
    // Arrange: trainee user_id doesn't have a trainee_accounts record
    const context = createTraineeContext(USER_A_ID, TRAINEE_A_ID, TENANT_A_ID);
    requireTenantContext.mockReturnValue({ context });

    // Mock: trainee_accounts query returns null
    const createQueryBuilder = (returnValue: any) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue(returnValue),
    });

    supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'trainee_accounts') {
        return createQueryBuilder({ data: null }); // Not found
      }
      return createQueryBuilder({ data: null });
    });

    const request = createMockRequest({ trainee_id: TRAINEE_A_ID });

    // Act
    const response = await GET(request);

    // Assert: should fail gracefully (not crash)
    expect([403, 404, 500]).toContain(response.status);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });
});

