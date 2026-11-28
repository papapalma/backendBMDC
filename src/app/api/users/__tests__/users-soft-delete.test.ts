import { NextRequest } from 'next/server';

const mockFrom = jest.fn();
const mockRequireRoleAsync = jest.fn();
const mockRequireTenantContext = jest.fn();
const mockRevokeAllRefreshTokensForUser = jest.fn();
const mockLogAction = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

jest.mock('@/middleware/auth', () => ({
  requireRoleAsync: (...args: any[]) => mockRequireRoleAsync(...args),
}));

jest.mock('@/middleware/tenantContext', () => ({
  requireTenantContext: (...args: any[]) => mockRequireTenantContext(...args),
}));

jest.mock('@/lib/auth/jwt', () => ({
  extractTokenFromHeader: (header?: string | null) =>
    header?.startsWith('Bearer ') ? header.slice(7) : null,
  extractTokenFromCookie: () => null,
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
}));

jest.mock('@/services/authRecoveryService', () => ({
  authRecoveryService: {
    revokeAllRefreshTokensForUser: (...args: any[]) =>
      mockRevokeAllRefreshTokensForUser(...args),
  },
}));

jest.mock('@/services/activityLogService', () => ({
  activityLogService: {
    logAction: (...args: any[]) => mockLogAction(...args),
  },
}));

jest.mock('@/services/traineeService', () => ({
  traineeService: { restoreTrainee: jest.fn() },
}));

jest.mock('@/services/traineeStatusService', () => ({
  traineeStatusService: { restoreTraineeStatus: jest.fn() },
}));

import { DELETE as deleteUserRoute } from '@/app/api/users/[id]/route';
import { PATCH as restoreArchiveRoute } from '@/app/api/archive/route';
import { DELETE as purgeArchiveRoute } from '@/app/api/archive/[id]/route';
import { withErrorHandler } from '@/middleware/errorHandler';
import { queryArchivedItems } from '@/utils/archiveQuery';
import {
  isUserSoftDeleted,
  markUserSoftDeleted,
  clearUserSoftDeleted,
  resetUserSoftDeleteCache,
} from '@/lib/userSoftDelete';

function makeChain(result: any) {
  const chain: any = {
    select: jest.fn(() => chain),
    update: jest.fn(() => chain),
    delete: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    neq: jest.fn(() => chain),
    ilike: jest.fn(() => chain),
    is: jest.fn(() => chain),
    not: jest.fn(() => chain),
    or: jest.fn(() => chain),
    order: jest.fn(() => chain),
    range: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    single: jest.fn(async () => result),
    maybeSingle: jest.fn(async () => result),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

describe('User Soft-Delete, Instant Session Cutoff & Archive Integration', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const adminId = '22222222-2222-2222-2222-222222222222';
  const targetUserId = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    jest.clearAllMocks();
    resetUserSoftDeleteCache();
    mockVerifyToken.mockReturnValue(null);
    mockRequireRoleAsync.mockResolvedValue({
      user: {
        userId: adminId,
        email: 'local.admin@bmdc.site',
        role: 'local_admin',
        tenantId,
      },
    });
    mockRequireTenantContext.mockReturnValue({
      context: {
        userId: adminId,
        role: 'local_admin',
        tenantId,
        isSuperAdmin: false,
      },
    });
  });

  describe('DELETE /api/users/[id] (soft-delete)', () => {
    it('blocks self-deletion with 403', async () => {
      const req = new NextRequest(`http://localhost:3003/api/users/${adminId}`, {
        method: 'DELETE',
      });
      const res = await deleteUserRoute(req, { params: Promise.resolve({ id: adminId }) });
      expect(res.status).toBe(403);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('returns 503 and never hard-deletes if migration 017 has not been applied yet', async () => {
      const tenantChain = makeChain({ data: { user_id: targetUserId }, error: null });
      const missingColChain = makeChain({
        data: null,
        error: { code: '42703', message: 'column users.deleted_at does not exist' },
      });

      mockFrom
        .mockReturnValueOnce(tenantChain)
        .mockReturnValueOnce(missingColChain);

      const req = new NextRequest(`http://localhost:3003/api/users/${targetUserId}`, {
        method: 'DELETE',
      });
      const res = await deleteUserRoute(req, { params: Promise.resolve({ id: targetUserId }) });

      expect(res.status).toBe(503);
      expect(missingColChain.delete).not.toHaveBeenCalled();
    });

    it('soft-deletes user, preserves users_tenants, revokes refresh tokens, and marks cache inactive', async () => {
      const tenantChain = makeChain({ data: { user_id: targetUserId }, error: null });
      const fetchUserChain = makeChain({
        data: {
          id: targetUserId,
          email: 'staff@bmdc.site',
          username: 'staff_user',
          role: 'staff_training_coordinator',
          deleted_at: null,
        },
        error: null,
      });
      const updateUserChain = makeChain({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(tenantChain)
        .mockReturnValueOnce(fetchUserChain)
        .mockReturnValueOnce(updateUserChain);

      const req = new NextRequest(`http://localhost:3003/api/users/${targetUserId}`, {
        method: 'DELETE',
      });
      const res = await deleteUserRoute(req, { params: Promise.resolve({ id: targetUserId }) });

      expect(res.status).toBe(204);
      expect(updateUserChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ deleted_at: expect.any(String) })
      );
      expect(updateUserChain.delete).not.toHaveBeenCalled();
      expect(mockRevokeAllRefreshTokensForUser).toHaveBeenCalledWith(targetUserId);
      expect(mockLogAction).toHaveBeenCalledWith(
        adminId,
        'delete',
        'user',
        targetUserId,
        expect.objectContaining({ softDelete: true, targetEmail: 'staff@bmdc.site' }),
        req,
        tenantId
      );
      await expect(isUserSoftDeleted(targetUserId)).resolves.toBe(true);
    });

    it('returns 403 when attempting to archive main admin or super_admin', async () => {
      mockFrom
        .mockReturnValueOnce(makeChain({ data: { user_id: targetUserId }, error: null }))
        .mockReturnValueOnce(
          makeChain({
            data: {
              id: targetUserId,
              email: 'admin@bmdc.edu.ph',
              username: 'admin',
              role: 'local_admin',
              deleted_at: null,
            },
            error: null,
          })
        );

      const req = new NextRequest(`http://localhost:3003/api/users/${targetUserId}`, {
        method: 'DELETE',
      });
      const res = await deleteUserRoute(req, { params: Promise.resolve({ id: targetUserId }) });
      expect(res.status).toBe(403);
    });
  });

  describe('withErrorHandler instant active-JWT cutoff', () => {
    it('immediately returns 401 before invoking handler when token belongs to a soft-deleted user', async () => {
      markUserSoftDeleted(targetUserId);
      mockVerifyToken.mockReturnValue({
        userId: targetUserId,
        email: 'staff@bmdc.site',
        role: 'staff_training_coordinator',
        tenantId,
      });

      const innerHandler = jest.fn(async () => new Response('ok', { status: 200 }));
      const wrapped = withErrorHandler(innerHandler);

      const req = new NextRequest('http://localhost:3003/api/trainees', {
        headers: { authorization: 'Bearer valid-jwt-token' },
      });
      const res = await wrapped(req);

      expect(res.status).toBe(401);
      expect(innerHandler).not.toHaveBeenCalled();

      // After restore, cache is cleared and DB reports deleted_at = null -> request proceeds
      clearUserSoftDeleted(targetUserId);
      mockFrom.mockReturnValueOnce(makeChain({ data: { deleted_at: null }, error: null }));

      const resAfterRestore = await wrapped(req);
      expect(resAfterRestore.status).toBe(200);
      expect(innerHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Archive query, restore, and purge for users', () => {
    it('queryArchivedItems selects explicit safe user columns via users_tenants join without password_hash', async () => {
      const chain = makeChain({
        data: [
          {
            id: targetUserId,
            email: 'archived@bmdc.site',
            username: 'archived_user',
            role: 'staff_training_coordinator',
            deleted_at: '2026-10-01T00:00:00.000Z',
            users_tenants: [{ tenant_id: tenantId }],
          },
        ],
        error: null,
        count: 1,
      });
      const fakeClient: any = { from: jest.fn(() => chain) };

      const result = await queryArchivedItems(fakeClient, 'users', tenantId, {
        search: 'archived',
        page: 1,
        limit: 10,
      });

      expect(fakeClient.from).toHaveBeenCalledWith('users');
      const selectArg = chain.select.mock.calls[0][0] as string;
      expect(selectArg).toContain('users_tenants!inner(tenant_id)');
      expect(selectArg).not.toContain('password_hash');
      expect(selectArg).not.toBe('*');
      expect(chain.eq).toHaveBeenCalledWith('users_tenants.tenant_id', tenantId);
      expect(chain.or).toHaveBeenCalledWith('username.ilike.%archived%,email.ilike.%archived%');
      expect(result.data[0]).not.toHaveProperty('users_tenants');
      expect(result.data[0].username).toBe('archived_user');
    });

    it('PATCH /api/archive rejects restore when an active user already claimed the email or username', async () => {
      mockFrom
        .mockReturnValueOnce(makeChain({ data: { user_id: targetUserId }, error: null }))
        .mockReturnValueOnce(
          makeChain({
            data: {
              id: targetUserId,
              email: 'reused@bmdc.site',
              username: 'reused_name',
              role: 'staff_inventory_manager',
              deleted_at: '2026-11-01T00:00:00.000Z',
            },
            error: null,
          })
        )
        .mockReturnValueOnce(makeChain({ data: { id: 'another-active-user' }, error: null }))
        .mockReturnValueOnce(makeChain({ data: null, error: null }));

      const req = new NextRequest('http://localhost:3003/api/archive', {
        method: 'PATCH',
        body: JSON.stringify({ entityType: 'user', ids: [targetUserId] }),
      });

      const res = await restoreArchiveRoute(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.restoredCount).toBe(0);
      expect(body.data.failedCount).toBe(1);
      expect(body.data.failed[0].error).toMatch(/already in use/i);
    });

    it('PATCH /api/archive restores an archived user and clears soft-delete cache', async () => {
      markUserSoftDeleted(targetUserId);

      const updateChain = makeChain({ data: null, error: null });
      mockFrom
        .mockReturnValueOnce(makeChain({ data: { user_id: targetUserId }, error: null }))
        .mockReturnValueOnce(
          makeChain({
            data: {
              id: targetUserId,
              email: 'free@bmdc.site',
              username: 'free_user',
              role: 'staff_training_coordinator',
              deleted_at: '2026-11-01T00:00:00.000Z',
            },
            error: null,
          })
        )
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        .mockReturnValueOnce(makeChain({ data: null, error: null }))
        .mockReturnValueOnce(updateChain);

      const req = new NextRequest('http://localhost:3003/api/archive', {
        method: 'PATCH',
        body: JSON.stringify({ entityType: 'user', ids: [targetUserId] }),
      });

      const res = await restoreArchiveRoute(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.restored).toEqual([targetUserId]);
      expect(updateChain.update).toHaveBeenCalledWith({ deleted_at: null });
      // Next lookup should query DB rather than returning cached true
      mockFrom.mockReturnValueOnce(makeChain({ data: { deleted_at: null }, error: null }));
      await expect(isUserSoftDeleted(targetUserId)).resolves.toBe(false);
    });

    it('DELETE /api/archive/[id]?entityType=user unlinks tenant only when user belongs to multiple tenants', async () => {
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      const unlinkChain = makeChain({ data: null, error: null });

      mockFrom
        .mockReturnValueOnce(makeChain({ data: { user_id: targetUserId }, error: null }))
        .mockReturnValueOnce(
          makeChain({
            data: {
              id: targetUserId,
              email: 'multi@bmdc.site',
              role: 'staff_inventory_manager',
              deleted_at: fortyDaysAgo,
            },
            error: null,
          })
        )
        .mockReturnValueOnce(
          makeChain({
            data: [{ tenant_id: tenantId }, { tenant_id: 'other-tenant-id' }],
            error: null,
          })
        )
        .mockReturnValueOnce(unlinkChain);

      const req = new NextRequest(
        `http://localhost:3003/api/archive/${targetUserId}?entityType=user`,
        { method: 'DELETE' }
      );
      const res = await purgeArchiveRoute(req, { params: Promise.resolve({ id: targetUserId }) });

      expect(res.status).toBe(200);
      expect(mockFrom).toHaveBeenLastCalledWith('users_tenants');
      expect(unlinkChain.delete).toHaveBeenCalled();
      expect(unlinkChain.eq).toHaveBeenCalledWith('tenant_id', tenantId);
    });
  });
});
