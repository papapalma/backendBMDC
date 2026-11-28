import { NextRequest } from 'next/server';
import { POST, GET, OPTIONS } from '@/app/api/trainees/[id]/requirements/route';
import { generateToken, generateUploadToken, verifyUploadToken } from '@/lib/auth/jwt';
import { supabaseAdmin } from '@/lib/supabase-admin';
import * as trainingRequirementService from '@/services/trainingRequirementService';
import jwt from 'jsonwebtoken';

jest.mock('@/lib/supabase-admin');
jest.mock('@/services/trainingRequirementService');
jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Trainee Requirements Upload - Upload Token Verification & Security Hardening', () => {
  const traineeId = 'trainee-uuid-111';
  const tenantId = 'tenant-uuid-222';
  const validFileContent = 'test file content';

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock for uploadRequirementFile
    (trainingRequirementService.uploadRequirementFile as jest.Mock).mockResolvedValue({
      id: 'file-uuid-333',
      traineeId,
      requirementType: 'id_document',
      fileName: 'valid.pdf',
    });
  });

  const createUploadRequest = (headers: Record<string, string> = {}, bodyFields?: { file?: boolean; requirementType?: string }): NextRequest => {
    const formData = new FormData();
    if (bodyFields?.file !== false) {
      const blob = new Blob([validFileContent], { type: 'application/pdf' });
      formData.append('file', blob, 'test.pdf');
    }
    if (bodyFields?.requirementType !== undefined) {
      formData.append('requirement_type', bodyFields.requirementType);
    } else {
      formData.append('requirement_type', 'valid_id');
    }

    const request = new NextRequest(new URL(`http://localhost:3003/api/trainees/${traineeId}/requirements`), {
      method: 'POST',
      headers,
      body: formData,
    });

    return request;
  };

  describe('Upload Token Generation & Verification (Unit)', () => {
    it('should generate a valid upload token and verify its claims', () => {
      const token = generateUploadToken(traineeId, tenantId);
      expect(typeof token).toBe('string');

      const verified = verifyUploadToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.traineeId).toBe(traineeId);
      expect(verified?.tenantId).toBe(tenantId);
      expect(verified?.purpose).toBe('requirement_upload');
    });

    it('should reject forged or corrupted tokens', () => {
      expect(verifyUploadToken('invalid.token.string')).toBeNull();
      expect(verifyUploadToken('')).toBeNull();
    });

    it('should reject tokens with wrong purpose', () => {
      const wrongPurposeToken = jwt.sign(
        { traineeId, tenantId, purpose: 'wrong_purpose' },
        process.env.JWT_SECRET || 'test-jwt-secret-for-jest-testing-only-32-chars!'
      );
      expect(verifyUploadToken(wrongPurposeToken)).toBeNull();
    });
  });

  describe('Endpoint Security Enforcement on POST /api/trainees/:id/requirements', () => {
    it('should reject unauthenticated request when no upload token is provided', async () => {
      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'trainees') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: traineeId, tenant_id: tenantId, registration_status: 'pending' },
              error: null,
            }),
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      const request = createUploadRequest({});
      const response = await POST(request, { params: Promise.resolve({ id: traineeId }) });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toContain('Valid upload token required');
    });

    it('should reject request when upload token has mismatched traineeId', async () => {
      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'trainees') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: traineeId, tenant_id: tenantId, registration_status: 'pending' },
              error: null,
            }),
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      const otherTraineeToken = generateUploadToken('other-trainee-id', tenantId);
      const request = createUploadRequest({ 'X-Upload-Token': otherTraineeToken });
      const response = await POST(request, { params: Promise.resolve({ id: traineeId }) });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toContain('Valid upload token required');
    });

    it('should reject request when upload token has mismatched tenantId', async () => {
      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'trainees') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: traineeId, tenant_id: tenantId, registration_status: 'pending' },
              error: null,
            }),
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      const otherTenantToken = generateUploadToken(traineeId, 'other-tenant-id');
      const request = createUploadRequest({ 'X-Upload-Token': otherTenantToken });
      const response = await POST(request, { params: Promise.resolve({ id: traineeId }) });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toContain('Valid upload token required');
    });

    it('should reject request when trainee registration_status is not pending', async () => {
      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'trainees') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: traineeId, tenant_id: tenantId, registration_status: 'approved' },
              error: null,
            }),
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      const validToken = generateUploadToken(traineeId, tenantId);
      const request = createUploadRequest({ 'X-Upload-Token': validToken });
      const response = await POST(request, { params: Promise.resolve({ id: traineeId }) });

      expect(response.status).toBe(401);
    });

    it('should allow upload with valid upload token matching trainee and pending status', async () => {
      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'trainees') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: traineeId, tenant_id: tenantId, registration_status: 'pending', user_id: 'user-000' },
              error: null,
            }),
          };
        }
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'def-111' },
              error: null,
            }),
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      const validToken = generateUploadToken(traineeId, tenantId);
      const request = createUploadRequest({ 'X-Upload-Token': validToken });
      const response = await POST(request, { params: Promise.resolve({ id: traineeId }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(trainingRequirementService.uploadRequirementFile).toHaveBeenCalled();
    });

    it('should allow X-Upload-Token in CORS preflight OPTIONS response', async () => {
      const request = new NextRequest(
        new URL(`http://localhost:3003/api/trainees/${traineeId}/requirements`),
        {
          method: 'OPTIONS',
          headers: {
            origin: 'http://localhost:3001',
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'x-upload-token',
          },
        }
      );

      const response = await OPTIONS(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
      expect(response.headers.get('access-control-allow-headers')).toContain('X-Upload-Token');
    });

    it('should prioritize valid X-Upload-Token over an unrelated Authorization header and include CORS headers', async () => {
      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'trainees') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: traineeId, tenant_id: tenantId, registration_status: 'pending', user_id: 'user-000', email: 't@example.com' },
              error: null,
            }),
          };
        }
        if (table === 'requirement_definitions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'def-111' },
              error: null,
            }),
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      const validUploadToken = generateUploadToken(traineeId, tenantId);
      const otherTenantAuthToken = generateToken({
        userId: 'other-admin',
        email: 'admin@other.test',
        role: 'local_admin',
        tenantId: 'other-tenant-uuid',
      });

      const request = createUploadRequest({
        origin: 'http://localhost:3001',
        authorization: `Bearer ${otherTenantAuthToken}`,
        'X-Upload-Token': validUploadToken,
      });

      const response = await POST(request, { params: Promise.resolve({ id: traineeId }) });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
      expect(trainingRequirementService.uploadRequirementFile).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId, traineeId, userId: 'user-000' })
      );
    });

    it('should load trainee requirements for super_admin using trainee tenant_id with CORS headers', async () => {
      const mockFiles = [
        {
          id: 'file-1',
          requirement_type: 'valid_id_copy',
          file_path: `/uploads/${tenantId}/documents/trainees/${traineeId}/valid_id.pdf`,
          file_name: 'valid_id.pdf',
          file_size_bytes: 1234,
          uploaded_at: '2026-11-27T00:00:00Z',
          uploaded_by: 'user-000',
        },
      ];
      (trainingRequirementService.getTraineeRequirementFiles as jest.Mock).mockResolvedValue(mockFiles);
      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'trainees') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: traineeId, tenant_id: tenantId },
              error: null,
            }),
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      const superAdminToken = generateToken({
        userId: 'super-admin-1',
        email: 'super@bmdc.test',
        role: 'super_admin',
        tenantId: 'super-admin-home-tenant',
      });

      const request = new NextRequest(
        new URL(`http://localhost:3003/api/trainees/${traineeId}/requirements`),
        {
          method: 'GET',
          headers: {
            origin: 'http://localhost:3001',
            authorization: `Bearer ${superAdminToken}`,
          },
        }
      );

      const response = await GET(request, { params: Promise.resolve({ id: traineeId }) });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
      expect(trainingRequirementService.getTraineeRequirementFiles).toHaveBeenCalledWith(tenantId, traineeId);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.files).toEqual(mockFiles);
      expect(json.data).toEqual(mockFiles);
    });
  });
});
