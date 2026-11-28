import { NextRequest, NextResponse } from 'next/server';
import { GET } from '@/app/api/users/route';
import { requireRoleAsync } from '@/middleware/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

jest.mock('@/middleware/auth');
jest.mock('@/lib/supabase-admin');
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));

describe('GET /api/users', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads 1,250+ tenant users via users_tenants!inner pagination without calling .in()', async () => {
    (requireRoleAsync as jest.Mock).mockResolvedValue({
      user: {
        id: 'admin-1',
        tenantId: 'tenant-bmdc',
        role: 'local_admin',
      },
    });

    const inSpy = jest.fn();
    const selectSpy = jest.fn();
    const eqSpy = jest.fn();
    const notSpy = jest.fn();
    const isSpy = jest.fn();
    const orderSpy = jest.fn();
    const rangeSpy = jest.fn();

    // 1,000 rows on page 1, 251 rows on page 2 (including 1 duplicate id across pages -> 1,250 unique)
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      id: `user-${i + 1}`,
      email: `user${i + 1}@bmdc.site`,
      username: `user_${i + 1}`,
      role: i < 3 ? 'staff_training_coordinator' : 'trainee',
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
      users_tenants: [{ tenant_id: 'tenant-bmdc' }],
    }));

    const page2 = [
      // Duplicate of user-1 to confirm deduplication
      {
        id: 'user-1',
        email: 'user1@bmdc.site',
        username: 'user_1',
        role: 'staff_training_coordinator',
        created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-01T00:00:00Z',
        users_tenants: [{ tenant_id: 'tenant-bmdc' }],
      },
      ...Array.from({ length: 250 }, (_, i) => ({
        id: `user-${1001 + i}`,
        email: `user${1001 + i}@bmdc.site`,
        username: `user_${1001 + i}`,
        role: 'trainee',
        created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-01T00:00:00Z',
        users_tenants: [{ tenant_id: 'tenant-bmdc' }],
      })),
    ];

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      expect(table).toBe('users');
      const query: any = {
        select: (...args: any[]) => {
          selectSpy(...args);
          return query;
        },
        eq: (...args: any[]) => {
          eqSpy(...args);
          return query;
        },
        not: (...args: any[]) => {
          notSpy(...args);
          return query;
        },
        is: (...args: any[]) => {
          isSpy(...args);
          return query;
        },
        order: (...args: any[]) => {
          orderSpy(...args);
          return query;
        },
        or: jest.fn().mockImplementation(() => query),
        in: (...args: any[]) => {
          inSpy(...args);
          return query;
        },
        range: (from: number, to: number) => {
          rangeSpy(from, to);
          if (from === 0) return Promise.resolve({ data: page1, error: null });
          if (from === 1000) return Promise.resolve({ data: page2, error: null });
          return Promise.resolve({ data: [], error: null });
        },
      };
      return query;
    });

    const req = { url: 'http://localhost:3003/api/users' } as NextRequest;
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining('users_tenants!inner(tenant_id)'));
    expect(eqSpy).toHaveBeenCalledWith('users_tenants.tenant_id', 'tenant-bmdc');
    expect(notSpy).toHaveBeenCalledWith('role', 'eq', 'super_admin');
    expect(isSpy).toHaveBeenCalledWith('deleted_at', null);
    expect(orderSpy).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(inSpy).not.toHaveBeenCalled();
    expect(rangeSpy).toHaveBeenNthCalledWith(1, 0, 999);
    expect(rangeSpy).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(body.data).toHaveLength(1250);
    expect(body.data[0]).not.toHaveProperty('users_tenants');
    expect(body.data[0].id).toBe('user-1');
  });

  it('forwards optional search and role query parameters', async () => {
    (requireRoleAsync as jest.Mock).mockResolvedValue({
      user: {
        id: 'admin-1',
        tenantId: 'tenant-bmdc',
        role: 'local_admin',
      },
    });

    const orSpy = jest.fn();
    const eqSpy = jest.fn();

    (supabaseAdmin.from as jest.Mock).mockImplementation(() => {
      const query: any = {
        select: () => query,
        eq: (...args: any[]) => {
          eqSpy(...args);
          return query;
        },
        not: () => query,
        is: () => query,
        order: () => query,
        or: (...args: any[]) => {
          orSpy(...args);
          return query;
        },
        range: () =>
          Promise.resolve({
            data: [
              {
                id: 'staff-1',
                email: 'demo.training@bmdc.site',
                username: 'demo_training_staff',
                role: 'staff_training_coordinator',
                created_at: '2026-11-26T00:00:00Z',
                updated_at: '2026-11-26T00:00:00Z',
                users_tenants: [{ tenant_id: 'tenant-bmdc' }],
              },
            ],
            error: null,
          }),
      };
      return query;
    });

    const req = {
      url: 'http://localhost:3003/api/users?search=demo&role=staff_training_coordinator',
    } as NextRequest;
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(orSpy).toHaveBeenCalledWith('email.ilike.%demo%,username.ilike.%demo%');
    expect(eqSpy).toHaveBeenCalledWith('role', 'staff_training_coordinator');
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual({
      id: 'staff-1',
      email: 'demo.training@bmdc.site',
      username: 'demo_training_staff',
      role: 'staff_training_coordinator',
      created_at: '2026-11-26T00:00:00Z',
      updated_at: '2026-11-26T00:00:00Z',
    });
  });

  it('returns 403 when caller is not local_admin', async () => {
    (requireRoleAsync as jest.Mock).mockResolvedValue({
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const req = { url: 'http://localhost:3003/api/users' } as NextRequest;
    const response = await GET(req);

    expect(response.status).toBe(403);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});
