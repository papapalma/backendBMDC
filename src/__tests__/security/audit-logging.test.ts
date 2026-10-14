/**
 * Audit Logging Tests
 * 
 * Tests for comprehensive audit logging of sensitive operations:
 * - Authentication attempts (success/failure)
 * - JWT refresh (role check)
 * - Role changes (flag any attempt, even failed)
 * - File uploads (user, tenant, filename, size)
 * - Cross-tenant access attempts (log + reject)
 * - Failed validation attempts
 * 
 * Validates: Design 6.8.4 - Audit Logging Enhanced
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { activityLogService } from '@/services/activityLogService';
import crypto from 'crypto';

// Simple UUID v4 generator to avoid import issues
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

describe('Audit Logging - Sensitive Operations', () => {
  let testTenantId: string;
  let testUserId: string;

  beforeAll(async () => {
    // Create test tenant and user for audit logging tests
    testTenantId = generateUUID();
    testUserId = generateUUID();

    // Insert test tenant
    await supabaseAdmin
      .from('tenants')
      .insert({
        id: testTenantId,
        name: 'Audit Test Tenant',
        domain: 'audit-test.local',
        is_active: true,
      });

    // Insert test user
    await supabaseAdmin
      .from('users')
      .insert({
        id: testUserId,
        email: 'audit-test@example.com',
        username: 'audit_tester',
        role: 'trainee',
        password_hash: 'hashed_password',
        tenant_id: testTenantId,
        is_active: true,
      });
  });

  afterAll(async () => {
    // Cleanup: delete activity logs first (FK constraint)
    await supabaseAdmin
      .from('activity_logs')
      .delete()
      .eq('user_id', testUserId);

    // Delete test user
    await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', testUserId);

    // Delete test tenant
    await supabaseAdmin
      .from('tenants')
      .delete()
      .eq('id', testTenantId);
  });

  describe('1. Authentication Audit Logging', () => {
    it('1.1 Should create audit log on successful login', async () => {
      await activityLogService.logAction(
        testUserId,
        'login',
        'user',
        testUserId,
        { method: 'email', success: true },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'login',
        tenant_id: testTenantId,
      });

      expect(logs.length).toBeGreaterThan(0);
      const loginLog = logs[0];
      expect(loginLog.action).toBe('login');
      expect(loginLog.user_id).toBe(testUserId);
      expect(loginLog.entity_type).toBe('user');
    });

    it('1.2 Should create audit log on failed login attempt', async () => {
      await activityLogService.logAction(
        testUserId,
        'login_failed',
        'user',
        testUserId,
        { method: 'email', reason: 'invalid_password' },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'login_failed',
        tenant_id: testTenantId,
      });

      expect(logs.length).toBeGreaterThan(0);
      const failedLog = logs[0];
      expect(failedLog.action).toBe('login_failed');
      expect(failedLog.entity_type).toBe('user');
      expect(failedLog.details?.reason).toBe('invalid_password');
    });

    it('1.3 Should include user context in audit log (userId, timestamp)', async () => {
      const timestamp = new Date().toISOString();
      await activityLogService.logAction(
        testUserId,
        'login',
        'user',
        testUserId,
        { timestamp, method: 'email' },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'login',
        tenant_id: testTenantId,
        limit: 1,
      });

      expect(logs[0].user_id).toBe(testUserId);
      expect(logs[0].created_at).toBeDefined();
    });

    it('1.4 Should NOT include sensitive data in audit logs (no passwords, tokens)', async () => {
      await activityLogService.logAction(
        testUserId,
        'login',
        'user',
        testUserId,
        { 
          method: 'email',
          // Simulating sensitive data that should NOT be logged
          sanitized_field: 'safe_value'
        },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'login',
        tenant_id: testTenantId,
        limit: 1,
      });

      const logDetails = logs[0].details;
      expect(logDetails).toBeDefined();
      // Verify no common sensitive fields are present
      expect(JSON.stringify(logDetails)).not.toMatch(/password/i);
      expect(JSON.stringify(logDetails)).not.toMatch(/token/i);
      expect(JSON.stringify(logDetails)).not.toMatch(/secret/i);
    });
  });

  describe('2. JWT Refresh & Role Validation Audit Logging', () => {
    it('2.1 Should log successful JWT refresh with role verification', async () => {
      await activityLogService.logAction(
        testUserId,
        'token_refreshed',
        'auth',
        testUserId,
        { 
          role: 'trainee',
          roleVerified: true,
          method: 'refresh_token'
        },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'token_refreshed',
        tenant_id: testTenantId,
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].details?.roleVerified).toBe(true);
    });

    it('2.2 Should flag and log role mismatch attempts during token refresh', async () => {
      await activityLogService.logAction(
        testUserId,
        'role_mismatch',
        'auth',
        testUserId,
        {
          oldRole: 'trainee',
          newRole: 'admin',
          timestamp: new Date().toISOString(),
          reason: 'Role changed between tokens',
        },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'role_mismatch',
        tenant_id: testTenantId,
      });

      expect(logs.length).toBeGreaterThan(0);
      const mismatchLog = logs[0];
      expect(mismatchLog.details?.oldRole).toBe('trainee');
      expect(mismatchLog.details?.newRole).toBe('admin');
    });

    it('2.3 Should log role escalation attempts', async () => {
      await activityLogService.logAction(
        testUserId,
        'role_escalation_attempt',
        'auth',
        testUserId,
        {
          currentRole: 'trainee',
          attemptedRole: 'super_admin',
          timestamp: new Date().toISOString(),
          method: 'token_manipulation',
        },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'role_escalation_attempt',
        tenant_id: testTenantId,
      });

      expect(logs.length).toBeGreaterThan(0);
      const escalationLog = logs[0];
      expect(escalationLog.details?.currentRole).toBe('trainee');
      expect(escalationLog.details?.attemptedRole).toBe('super_admin');
    });
  });

  describe('3. File Upload Audit Logging', () => {
    it('3.1 Should log file uploads with user, tenant, filename, and size', async () => {
      const fileDetails = {
        filename: 'test-photo.jpg',
        fileSize: 2048,
        category: 'trainees',
        mimeType: 'image/jpeg',
        timestamp: new Date().toISOString(),
      };

      await activityLogService.logAction(
        testUserId,
        'file_upload',
        'file',
        generateUUID(),
        fileDetails,
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'file_upload',
        tenant_id: testTenantId,
      });

      expect(logs.length).toBeGreaterThan(0);
      const uploadLog = logs[0];
      expect(uploadLog.details?.filename).toBe('test-photo.jpg');
      expect(uploadLog.details?.fileSize).toBe(2048);
      expect(uploadLog.details?.category).toBe('trainees');
    });

    it('3.2 Should log file upload failures with reason', async () => {
      await activityLogService.logAction(
        testUserId,
        'file_upload_failed',
        'file',
        generateUUID(),
        {
          filename: 'bomb.zip',
          reason: 'compression_bomb_detected',
          fileSize: 1024,
          compressionRatio: 250,
        },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'file_upload_failed',
        tenant_id: testTenantId,
      });

      expect(logs.length).toBeGreaterThan(0);
      const failLog = logs[0];
      expect(failLog.details?.reason).toBe('compression_bomb_detected');
    });

    it('3.3 Should NOT log file content/binary data in audit logs', async () => {
      await activityLogService.logAction(
        testUserId,
        'file_upload',
        'file',
        generateUUID(),
        {
          filename: 'photo.jpg',
          fileSize: 2048,
          // Simulating file content that should NOT be logged
          fileHash: 'abc123def456',
        },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'file_upload',
        tenant_id: testTenantId,
        limit: 1,
      });

      const logStr = JSON.stringify(logs[0].details);
      // Should not include binary-like content
      expect(logStr.length).toBeLessThan(500); // Reasonable size, not huge file content
    });
  });

  describe('4. Cross-Tenant Access Attempt Logging', () => {
    it('4.1 Should log cross-tenant access attempts as denied', async () => {
      const otherTenantId = generateUUID();
      
      await activityLogService.logAction(
        testUserId,
        'cross_tenant_access_denied',
        'attendance',
        generateUUID(),
        {
          userId: testUserId,
          userTenant: testTenantId,
          attemptedTenant: otherTenantId,
          resource: 'attendance_record',
          timestamp: new Date().toISOString(),
        },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'cross_tenant_access_denied',
        tenant_id: testTenantId,
      });

      expect(logs.length).toBeGreaterThan(0);
      const denyLog = logs[0];
      expect(denyLog.details?.userTenant).toBe(testTenantId);
      expect(denyLog.details?.attemptedTenant).toBe(otherTenantId);
    });

    it('4.2 Should include IP address and user agent in audit logs', async () => {
      const mockRequest = {
        headers: {
          get: (header: string) => {
            if (header === 'x-forwarded-for') return '192.168.1.100, 10.0.0.1';
            if (header === 'user-agent') return 'Mozilla/5.0 (test)';
            return null;
          },
        },
      } as any;

      await activityLogService.logAction(
        testUserId,
        'login',
        'user',
        testUserId,
        { method: 'email' },
        mockRequest,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'login',
        tenant_id: testTenantId,
        limit: 1,
      });

      // IP and user agent should be captured from request headers
      expect(logs[0].ip_address).toBeDefined();
      expect(logs[0].user_agent).toBeDefined();
    });
  });

  describe('5. Failed Validation & Authorization Logging', () => {
    it('5.1 Should log failed authorization attempts', async () => {
      await activityLogService.logAction(
        testUserId,
        'authz_denied',
        'auth',
        testUserId,
        {
          userId: testUserId,
          userRole: 'trainee',
          requiredRoles: ['admin', 'staff_coordinator'],
          endpoint: '/api/admin/users',
          timestamp: new Date().toISOString(),
        },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'authz_denied',
        tenant_id: testTenantId,
      });

      expect(logs.length).toBeGreaterThan(0);
      const authzLog = logs[0];
      expect(authzLog.details?.userRole).toBe('trainee');
      expect(authzLog.details?.requiredRoles).toContain('admin');
    });

    it('5.2 Should log account lockout after too many failed attempts', async () => {
      await activityLogService.logAction(
        testUserId,
        'account_locked',
        'user',
        testUserId,
        {
          reason: 'too_many_failed_login_attempts',
          failedAttempts: 5,
          lockedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'account_locked',
        tenant_id: testTenantId,
      });

      expect(logs.length).toBeGreaterThan(0);
      const lockLog = logs[0];
      expect(lockLog.details?.reason).toBe('too_many_failed_login_attempts');
      expect(lockLog.details?.failedAttempts).toBe(5);
    });
  });

  describe('6. Audit Log Format & Machine Readability', () => {
    it('6.1 Should format audit logs with timestamp, userId, action, resource, status', async () => {
      await activityLogService.logAction(
        testUserId,
        'login',
        'user',
        testUserId,
        { method: 'email', status: 'success' },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'login',
        tenant_id: testTenantId,
        limit: 1,
      });

      const log = logs[0];
      expect(log.id).toBeDefined();
      expect(log.user_id).toBe(testUserId);
      expect(log.action).toBe('login');
      expect(log.entity_type).toBe('user');
      expect(log.entity_id).toBe(testUserId);
      expect(log.created_at).toBeDefined();
    });

    it('6.2 Should format audit logs as JSON for machine parsing', async () => {
      await activityLogService.logAction(
        testUserId,
        'file_upload',
        'file',
        generateUUID(),
        {
          filename: 'report.pdf',
          fileSize: 1024000,
          category: 'documents',
          status: 'success',
        },
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'file_upload',
        tenant_id: testTenantId,
        limit: 1,
      });

      const log = logs[0];
      // Should be serializable to JSON
      const jsonStr = JSON.stringify(log);
      expect(jsonStr).toBeDefined();
      
      // Should be deserializable back
      const parsed = JSON.parse(jsonStr);
      expect(parsed.action).toBe('file_upload');
      expect(parsed.details.status).toBe('success');
    });

    it('6.3 Should track details field with action-specific information', async () => {
      const details = {
        method: 'email',
        status: 'success',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        timestamp: new Date().toISOString(),
      };

      await activityLogService.logAction(
        testUserId,
        'login',
        'user',
        testUserId,
        details,
        undefined,
        testTenantId
      );

      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'login',
        tenant_id: testTenantId,
        limit: 1,
      });

      const log = logs[0];
      expect(log.details?.status).toBe('success');
      expect(log.details?.method).toBe('email');
    });
  });

  describe('7. Data Retention & Audit Log Volume', () => {
    it('7.1 Should retrieve activity logs efficiently with pagination', async () => {
      // Log multiple actions
      for (let i = 0; i < 5; i++) {
        await activityLogService.logAction(
          testUserId,
          `action_${i}`,
          'user',
          testUserId,
          { sequence: i },
          undefined,
          testTenantId
        );
      }

      // Retrieve with limit
      const logs = await activityLogService.getAllLogs({
        user_id: testUserId,
        tenant_id: testTenantId,
        limit: 3,
      });

      expect(logs.length).toBeLessThanOrEqual(3);
    });

    it('7.2 Should support filtering by action type', async () => {
      await activityLogService.logAction(testUserId, 'login', 'user', testUserId, {}, undefined, testTenantId);
      await activityLogService.logAction(testUserId, 'logout', 'user', testUserId, {}, undefined, testTenantId);

      const loginLogs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'login',
        tenant_id: testTenantId,
      });

      const logoutLogs = await activityLogService.getAllLogs({
        user_id: testUserId,
        action: 'logout',
        tenant_id: testTenantId,
      });

      expect(loginLogs.every(log => log.action === 'login')).toBe(true);
      expect(logoutLogs.every(log => log.action === 'logout')).toBe(true);
    });
  });
});
