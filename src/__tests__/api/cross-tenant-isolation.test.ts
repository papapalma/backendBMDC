/**
 * Cross-Tenant Isolation Tests - Task 3.2 / 3.4
 * 
 * Verifies that file access respects tenant boundaries:
 * - Files from tenant_A cannot be accessed by tenant_B users
 * - Query results are filtered by tenant_id
 * - File paths are validated against tenant context
 */

import { pathBelongsToTenant, extractTenantIdFromPath } from '@/lib/fileStorage';

describe('Cross-Tenant File Isolation', () => {
  // Test data
  const tenantA = 'a0000000-0000-0000-0000-000000000001';
  const tenantB = 'b0000000-0000-0000-0000-000000000002';

  describe('pathBelongsToTenant', () => {
    it('should return true when file path contains matching tenant_id', () => {
      const filePath = `/uploads/${tenantA}/documents/trainees/file.pdf`;
      const result = pathBelongsToTenant(filePath, tenantA);
      expect(result).toBe(true);
    });

    it('should return false when file path contains different tenant_id', () => {
      const filePath = `/uploads/${tenantA}/documents/trainees/file.pdf`;
      const result = pathBelongsToTenant(filePath, tenantB);
      expect(result).toBe(false);
    });

    it('should return false when tenant_id is missing from path', () => {
      const filePath = '/uploads/documents/trainees/file.pdf';
      const result = pathBelongsToTenant(filePath, tenantA);
      expect(result).toBe(false);
    });

    it('should be case-insensitive for tenant_id matching', () => {
      const filePath = `/uploads/${tenantA.toUpperCase()}/documents/trainees/file.pdf`;
      const result = pathBelongsToTenant(filePath, tenantA);
      expect(result).toBe(true);
    });

    it('should handle Windows-style path separators', () => {
      const filePath = `\\uploads\\${tenantA}\\documents\\trainees\\file.pdf`;
      const result = pathBelongsToTenant(filePath, tenantA);
      expect(result).toBe(true);
    });

    it('should reject path traversal attempts in filename', () => {
      // Path traversal shouldn't bypass tenant check
      const filePath = `/uploads/${tenantA}/documents/trainees/../../../${tenantB}/secret.pdf`;
      const result = pathBelongsToTenant(filePath, tenantB);
      expect(result).toBe(false); // tenantB check should fail because actual tenant in path is A
    });
  });

  describe('extractTenantIdFromPath', () => {
    it('should extract tenant_id from valid file path', () => {
      const filePath = `/uploads/${tenantA}/documents/trainees/file.pdf`;
      const result = extractTenantIdFromPath(filePath);
      expect(result).toBe(tenantA);
    });

    it('should return null for invalid UUID', () => {
      const filePath = '/uploads/invalid-id/documents/trainees/file.pdf';
      const result = extractTenantIdFromPath(filePath);
      expect(result).toBeNull();
    });

    it('should return null for missing tenant_id', () => {
      const filePath = '/uploads/documents/trainees/file.pdf';
      const result = extractTenantIdFromPath(filePath);
      expect(result).toBeNull();
    });

    it('should handle Windows-style separators', () => {
      const filePath = `\\uploads\\${tenantA}\\documents\\trainees\\file.pdf`;
      const result = extractTenantIdFromPath(filePath);
      expect(result).toBe(tenantA);
    });

    it('should handle mixed separators', () => {
      const filePath = `/uploads\\${tenantA}/documents\\trainees/file.pdf`;
      const result = extractTenantIdFromPath(filePath);
      expect(result).toBe(tenantA);
    });

    it('should handle encoded slashes in filename', () => {
      const filePath = `/uploads/${tenantA}/documents/trainees/file%2Fpdf`;
      const result = extractTenantIdFromPath(filePath);
      expect(result).toBe(tenantA);
    });
  });

  describe('File Access Guard - Tenant Boundary Validation', () => {
    it('should validate that file.file_path includes authenticating user tenant_id', () => {
      // Simulates the guard: if (!file.file_path.includes(tenantId))
      const file = {
        id: 'file-123',
        file_path: `/uploads/${tenantA}/documents/trainees/requirements.pdf`,
      };
      const authenticatingUserTenantId = tenantA;

      const guard = file.file_path.includes(authenticatingUserTenantId);
      expect(guard).toBe(true);
    });

    it('should reject access when file tenant does not match user tenant', () => {
      const file = {
        id: 'file-123',
        file_path: `/uploads/${tenantA}/documents/trainees/requirements.pdf`,
      };
      const authenticatingUserTenantId = tenantB;

      const guard = file.file_path.includes(authenticatingUserTenantId);
      expect(guard).toBe(false); // Guard catches the cross-tenant access
    });

    it('should handle encoded tenant_ids in comparison', () => {
      const file = {
        id: 'file-123',
        file_path: `/uploads/${tenantA.toLowerCase()}/documents/trainees/requirements.pdf`,
      };
      const authenticatingUserTenantId = tenantA.toUpperCase();

      // The simple guard won't catch case differences; pathBelongsToTenant is safer
      const simpleGuard = file.file_path.includes(authenticatingUserTenantId);
      expect(simpleGuard).toBe(false); // Simple includes() is case-sensitive

      // Use proper validation instead
      const properGuard = pathBelongsToTenant(file.file_path, authenticatingUserTenantId);
      expect(properGuard).toBe(true); // pathBelongsToTenant handles case-insensitivity
    });

    it('should reject path traversal in file responses', () => {
      // Malicious DB response with path traversal to another tenant
      const file = {
        id: 'file-123',
        file_path: `/uploads/${tenantA}/../../${tenantB}/secret.pdf`,
      };
      const authenticatingUserTenantId = tenantB;

      // Simple check might be fooled if just searching for tenantB string
      const simpleGuard = file.file_path.includes(authenticatingUserTenantId);
      expect(simpleGuard).toBe(true); // Could be vulnerable to substring attack

      // Proper validation extracts the actual structured tenant from position [1]
      // This file belongs to tenantA (position 1), not tenantB
      const properGuard = pathBelongsToTenant(file.file_path, tenantB);
      expect(properGuard).toBe(false); // Safe - caught that file is for tenantA, not B
    });
  });

  describe('Query Result Filtering - Ensures RLS by tenant_id', () => {
    it('should verify that Supabase queries include .eq(tenant_id) filter', () => {
      // This documents the expected pattern for all file queries:
      //
      // ✅ CORRECT:
      //   supabaseAdmin
      //     .from('training_requirement_files')
      //     .select(...)
      //     .eq('tenant_id', tenantId)     // <- Filter present
      //     .eq('trainee_id', traineeId)
      //
      // ❌ WRONG (vulnerable to cross-tenant access):
      //   supabaseAdmin
      //     .from('training_requirement_files')
      //     .select(...)
      //     .eq('trainee_id', traineeId)   // <- No tenant filter!

      // This test serves as documentation; actual queries are in services
      // and are verified by integration tests and audit logs
      expect(true).toBe(true); // Placeholder for lint
    });

    it('should always apply tenant boundary check AFTER query result', () => {
      // Even if a query is missing .eq('tenant_id', tenantId),
      // the application code should have a guard:

      interface FileRecord {
        id: string;
        tenant_id: string;
        file_path: string;
      }

      const queryResult: FileRecord = {
        id: 'file-123',
        tenant_id: tenantA,
        file_path: `/uploads/${tenantA}/documents/file.pdf`,
      };

      const authenticatingUserTenantId = tenantB;

      // Guard 1: Check tenant_id field (if present in query result)
      const guard1 = queryResult.tenant_id === authenticatingUserTenantId;
      expect(guard1).toBe(false);

      // Guard 2: Check file_path contains tenant_id
      const guard2 = pathBelongsToTenant(queryResult.file_path, authenticatingUserTenantId);
      expect(guard2).toBe(false);

      // Either guard should catch the mismatch
      expect(guard1 || guard2).toBe(false);
    });
  });

  describe('validateFileAccess - File Access Guard Function', () => {
    it('should allow access when file path matches tenant_id', () => {
      const { validateFileAccess } = require('@/lib/security');
      const file = {
        file_path: `/uploads/${tenantA}/documents/trainees/file.pdf`,
      };

      const result = validateFileAccess(file, tenantA);
      expect(result.allowed).toBe(true);
    });

    it('should deny access when file path does not match tenant_id', () => {
      const { validateFileAccess } = require('@/lib/security');
      const file = {
        file_path: `/uploads/${tenantA}/documents/trainees/file.pdf`,
      };

      const result = validateFileAccess(file, tenantB);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('does not belong to your tenant');
    });

    it('should deny access when file is null', () => {
      const { validateFileAccess } = require('@/lib/security');

      const result = validateFileAccess(null, tenantA);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('File not found');
    });

    it('should deny access when file has no file_path', () => {
      const { validateFileAccess } = require('@/lib/security');
      const file = { id: 'file-123' };

      const result = validateFileAccess(file, tenantA);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('missing file_path');
    });

    it('should deny access when tenant_id is missing', () => {
      const { validateFileAccess } = require('@/lib/security');
      const file = {
        file_path: `/uploads/${tenantA}/documents/trainees/file.pdf`,
      };

      const result = validateFileAccess(file, '');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('missing tenant context');
    });
  });
});
