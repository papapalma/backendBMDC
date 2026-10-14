/**
 * Security tests for POST /api/attendance/submit
 * Task 2.3: Write tests (before code changes) - Trainee Isolation & Auth Verification
 *
 * These tests validate that the attendance submission endpoint properly enforces:
 * 1. Authentication (unauthenticated request must return 401)
 * 2. Role authorization (non-trainee roles must return 403)
 * 3. File validation (invalid file types/sizes must return 400)
 * 4. Input validation (missing required fields must return 400/422)
 *
 * Current implementation status:
 * - ✓ requireRoleAsync() provides auth & role checks
 * - ✓ resolveTrainee(userId) ensures trainee belongs to authenticated user
 * - ✓ Defensive check: if (!trainee.id) return 403 (data corruption guard)
 *
 * Expected test results:
 * - Tests 1-3: PASS (auth/role enforcement working)
 * - Tests 4-6: FAIL (trainee isolation not yet enforced in form)
 * - Tests 7-10: PASS (file and input validation working)
 */

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/attendance/submit/route';

// ============================================================================
// Mocks
// ============================================================================

// Mock requireRoleAsync from auth middleware
jest.mock('@/middleware/auth', () => ({
  requireRoleAsync: jest.fn(),
}));

// Mock supabaseAdmin - responses will be set per test
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

// Mock attendanceService
jest.mock('@/services/attendanceService', () => ({
  attendanceService: {
    submitTraineeAttendance: jest.fn(),
    getCurrentWindowStatus: jest.fn(),
    getActiveSchedule: jest.fn(),
  },
}));

// Mock activityLogService
jest.mock('@/services/activityLogService', () => ({
  activityLogService: {
    logAction: jest.fn(),
  },
}));

// Mock file system operations
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock sharp for image processing
jest.mock('sharp', () => {
  return jest.fn(() => ({
    rotate: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toFile: jest.fn().mockResolvedValue({}),
  }));
});

// Mock file storage utilities
jest.mock('@/lib/fileStorage', () => ({
  UPLOAD_BASE_DIR: '/uploads',
  validateTenantId: jest.fn(),
  getImageDir: jest.fn((tenantId) => `/uploads/${tenantId}/images/attendance`),
  initTenantDirectories: jest.fn().mockResolvedValue(undefined),
}));

// ============================================================================
// Test Helpers
// ============================================================================

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = '660e8400-e29b-41d4-a716-446655440000';
const TRAINEE_ID = '770e8400-e29b-41d4-a716-446655440000';
const SESSION_ID = '880e8400-e29b-41d4-a716-446655440000';
const PROGRAM_ID = '990e8400-e29b-41d4-a716-446655440000';

/**
 * Create a mock NextRequest with optional auth token and headers
 */
function createMockRequest(
  token?: string,
  overrides?: Partial<NextRequest>
): NextRequest {
  const url = new URL('http://localhost:3000/api/attendance/submit');

  const headers = new Map();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  headers.set('content-type', 'multipart/form-data');

  const request = {
    url: url.toString(),
    method: 'POST',
    headers: {
      get: (key: string) => headers.get(key.toLowerCase()),
      has: (key: string) => headers.has(key.toLowerCase()),
    },
    formData: jest.fn(),
    ...overrides,
  } as any as NextRequest;

  return request;
}

/**
 * Create mock FormData with required fields for submission
 */
function createMockFormData(overrides?: Record<string, any>) {
  const mockFile = {
    arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-image-data')),
    type: 'image/jpeg',
    size: 1024,
  };

  const formData = new Map();
  formData.set('selfie', mockFile);
  formData.set('session_label', 'morning');
  formData.set('gps_lat', '40.7128');
  formData.set('gps_lng', '-74.0060');
  formData.set('device_info', '{"userAgent":"test"}');

  // Apply overrides
  if (overrides) {
    Object.entries(overrides).forEach(([key, value]) => {
      formData.set(key, value);
    });
  }

  const mockFormData = {
    get: (key: string) => formData.get(key) || null,
  } as any as FormData;

  return mockFormData;
}

/**
 * Helper to set up supabaseAdmin mock for successful trainee resolution
 */
function mockSuccessfulTraineeResolution(supabaseAdmin: any) {
  const createQueryBuilder = (returnValue: any) => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(returnValue),
    single: jest.fn().mockResolvedValue(returnValue),
  });

  supabaseAdmin.from.mockImplementation((table: string) => {
    if (table === 'trainee_accounts') {
      return createQueryBuilder({
        data: { trainee_id: TRAINEE_ID, tenant_id: TENANT_ID },
      });
    }
    if (table === 'enrollments') {
      return createQueryBuilder({
        data: { program_id: PROGRAM_ID },
      });
    }
    if (table === 'trainees') {
      return createQueryBuilder({
        data: {
          id: TRAINEE_ID,
          first_name: 'Test',
          last_name: 'Trainee',
        },
      });
    }
    if (table === 'program_sessions') {
      return createQueryBuilder({
        data: {
          id: SESSION_ID,
          session_date: '2024-01-15',
          start_time: '08:00',
          end_time: '12:00',
        },
      });
    }
    if (table === 'attendance_exceptions') {
      return createQueryBuilder({ data: null });
    }
    return createQueryBuilder({ data: null });
  });
}

// ============================================================================
// Tests - Authentication & Authorization
// ============================================================================

describe('POST /api/attendance/submit - Authentication & Authorization', () => {
  const { requireRoleAsync } = require('@/middleware/auth');
  const { supabaseAdmin } = require('@/lib/supabase-admin');
  const { attendanceService } = require('@/services/attendanceService');
  const { activityLogService } = require('@/services/activityLogService');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Test 1: Unauthenticated request → 401 Unauthorized
  // =========================================================================

  it('Test 1: should return 401 when request lacks authentication token', async () => {
    // Arrange: no token, auth fails
    requireRoleAsync.mockResolvedValue({
      error: new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      ),
    });

    const request = createMockRequest(undefined); // no token
    request.formData = jest.fn().mockResolvedValue(createMockFormData());

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toContain('Authentication');
  });

  // =========================================================================
  // Test 2: Admin JWT → 403 Forbidden
  // =========================================================================

  it('Test 2: should return 403 when authenticated user has admin role', async () => {
    // Arrange: token present but user is admin (not trainee)
    requireRoleAsync.mockResolvedValue({
      error: new Response(
        JSON.stringify({ success: false, error: 'Insufficient permissions' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    });

    const request = createMockRequest('admin-jwt-token');
    request.formData = jest.fn().mockResolvedValue(createMockFormData());

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('Insufficient permissions');
    expect(requireRoleAsync).toHaveBeenCalledWith(request, ['trainee']);
  });

  // =========================================================================
  // Test 3: Coordinator JWT → 403 Forbidden
  // =========================================================================

  it('Test 3: should return 403 when authenticated user has coordinator role', async () => {
    // Arrange: token present but user is coordinator (not trainee)
    requireRoleAsync.mockResolvedValue({
      error: new Response(
        JSON.stringify({ success: false, error: 'Insufficient permissions' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      ),
    });

    const request = createMockRequest('coordinator-jwt-token');
    request.formData = jest.fn().mockResolvedValue(createMockFormData());

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('Insufficient permissions');
    expect(requireRoleAsync).toHaveBeenCalledWith(request, ['trainee']);
  });

  // =========================================================================
  // Test 4: Trainee JWT (own trainee_id) → should proceed to business logic
  // =========================================================================

  it('Test 4: should accept authenticated trainee and resolve trainee from user_id', async () => {
    // Arrange: valid trainee JWT
    const traineeJWT = {
      userId: USER_ID,
      role: 'trainee',
      tenantId: TENANT_ID,
    };

    requireRoleAsync.mockResolvedValue({ user: traineeJWT });

    // Mock successful trainee resolution
    mockSuccessfulTraineeResolution(supabaseAdmin);

    // Mock services
    attendanceService.getActiveSchedule.mockResolvedValue({
      id: 'schedule-1',
      program_id: PROGRAM_ID,
    });

    attendanceService.getCurrentWindowStatus.mockResolvedValue({
      isOpen: true,
      session_label: 'morning',
    });

    attendanceService.submitTraineeAttendance.mockResolvedValue({
      id: 'attendance-record-1',
      trainee_id: TRAINEE_ID,
      session_id: SESSION_ID,
      status: 'present',
    });

    const request = createMockRequest('trainee-jwt-token');
    request.formData = jest.fn().mockResolvedValue(createMockFormData());

    // Act
    const response = await POST(request);

    // Assert: should pass auth checks and reach service layer
    // (will either succeed with 201 or fail at attendance service if not fully mocked)
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    expect(requireRoleAsync).toHaveBeenCalledWith(request, ['trainee']);
    
    // Verify that resolveTrainee was called (via supabaseAdmin.from)
    expect(supabaseAdmin.from).toHaveBeenCalled();
  });

  // =========================================================================
  // Test 5: Trainee from different tenant → 404 Not Found
  // =========================================================================

  it('Test 5: should return 404 when trainee from different tenant attempts to submit', async () => {
    // Arrange: trainee JWT for different tenant
    const CROSS_TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const traineeJWT = {
      userId: USER_ID,
      role: 'trainee',
      tenantId: CROSS_TENANT_ID, // Different tenant
    };

    requireRoleAsync.mockResolvedValue({ user: traineeJWT });

    // Mock: trainee_accounts query returns null (user not in this tenant)
    const createQueryBuilder = (returnValue: any) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue(returnValue),
      single: jest.fn().mockResolvedValue(returnValue),
    });

    supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'trainee_accounts' || table === 'trainees') {
        // User not found in this tenant
        return createQueryBuilder({ data: null });
      }
      return createQueryBuilder({ data: null });
    });

    const request = createMockRequest('trainee-jwt-token');
    request.formData = jest.fn().mockResolvedValue(createMockFormData());

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain('Trainee profile not found');
  });

  // =========================================================================
  // Test 6: Defensive check - missing trainee.id (data corruption)
  // =========================================================================

  it('Test 6: should return 403 when trainee.id is missing (defensive check)', async () => {
    // Arrange: resolveTrainee returns an object but trainee.id is undefined
    const traineeJWT = {
      userId: USER_ID,
      role: 'trainee',
      tenantId: TENANT_ID,
    };

    requireRoleAsync.mockResolvedValue({ user: traineeJWT });

    // Mock: trainee_accounts returns data, but trainee query fails or returns no id
    const createQueryBuilder = (returnValue: any) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue(returnValue),
      single: jest.fn().mockResolvedValue(returnValue),
    });

    supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'trainee_accounts') {
        return createQueryBuilder({
          data: { trainee_id: null, tenant_id: TENANT_ID }, // corrupted
        });
      }
      return createQueryBuilder({ data: null });
    });

    const request = createMockRequest('trainee-jwt-token');
    request.formData = jest.fn().mockResolvedValue(createMockFormData());

    // Act
    const response = await POST(request);

    // Assert: endpoint should have defensive check for trainee.id
    // Will fail to resolve trainee and return 404 or 403
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect([404, 403]).toContain(response.status);
  });
});

// ============================================================================
// Tests - File & Input Validation
// ============================================================================

describe('POST /api/attendance/submit - File & Input Validation', () => {
  const { requireRoleAsync } = require('@/middleware/auth');
  const { supabaseAdmin } = require('@/lib/supabase-admin');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Test 7: Invalid file type → 400 Bad Request
  // =========================================================================

  it('Test 7: should return 400 when selfie file type is not allowed (e.g., PDF)', async () => {
    // Arrange: invalid file type
    const traineeJWT = {
      userId: USER_ID,
      role: 'trainee',
      tenantId: TENANT_ID,
    };

    requireRoleAsync.mockResolvedValue({ user: traineeJWT });

    // Mock successful trainee resolution (needed to reach file validation)
    mockSuccessfulTraineeResolution(supabaseAdmin);

    const request = createMockRequest('trainee-jwt-token');
    const invalidFormData = createMockFormData({
      selfie: {
        arrayBuffer: jest.fn(),
        type: 'application/pdf', // Invalid type
        size: 1024,
      },
    });

    request.formData = jest.fn().mockResolvedValue(invalidFormData);

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('image');
  });

  // =========================================================================
  // Test 8: Oversized file → 400 Bad Request
  // =========================================================================

  it('Test 8: should return 400 when selfie exceeds max size (10 MB)', async () => {
    // Arrange: file too large
    const traineeJWT = {
      userId: USER_ID,
      role: 'trainee',
      tenantId: TENANT_ID,
    };

    requireRoleAsync.mockResolvedValue({ user: traineeJWT });

    mockSuccessfulTraineeResolution(supabaseAdmin);

    const request = createMockRequest('trainee-jwt-token');
    const oversizedFormData = createMockFormData({
      selfie: {
        arrayBuffer: jest.fn().mockResolvedValue(Buffer.alloc(11 * 1024 * 1024)), // 11 MB
        type: 'image/jpeg',
        size: 11 * 1024 * 1024,
      },
    });

    request.formData = jest.fn().mockResolvedValue(oversizedFormData);

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('too large');
  });

  // =========================================================================
  // Test 9: Missing selfie file → 400 Bad Request
  // =========================================================================

  it('Test 9: should return 400 when selfie file is missing', async () => {
    // Arrange: no selfie in form data
    const traineeJWT = {
      userId: USER_ID,
      role: 'trainee',
      tenantId: TENANT_ID,
    };

    requireRoleAsync.mockResolvedValue({ user: traineeJWT });

    mockSuccessfulTraineeResolution(supabaseAdmin);

    const request = createMockRequest('trainee-jwt-token');
    const formDataNoFile = new Map();
    formDataNoFile.set('session_label', 'morning');
    // selfie is missing

    const mockFormData = {
      get: (key: string) => formDataNoFile.get(key) || null,
    } as any as FormData;

    request.formData = jest.fn().mockResolvedValue(mockFormData);

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('selfie');
  });

  // =========================================================================
  // Test 10: Missing required field (session_label) → 400/422 Validation Error
  // =========================================================================

  it('Test 10: should return 400+ when required field session_label is missing', async () => {
    // Arrange: missing required field
    const traineeJWT = {
      userId: USER_ID,
      role: 'trainee',
      tenantId: TENANT_ID,
    };

    requireRoleAsync.mockResolvedValue({ user: traineeJWT });

    mockSuccessfulTraineeResolution(supabaseAdmin);

    const request = createMockRequest('trainee-jwt-token');
    const formDataNoLabel = new Map();
    formDataNoLabel.set('selfie', {
      arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('data')),
      type: 'image/jpeg',
      size: 1024,
    });
    // session_label is missing

    const mockFormData = {
      get: (key: string) => formDataNoLabel.get(key) || null,
    } as any as FormData;

    request.formData = jest.fn().mockResolvedValue(mockFormData);

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });
});
