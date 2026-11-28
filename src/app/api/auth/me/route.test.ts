import { NextRequest, NextResponse } from 'next/server';
import { GET, PATCH, OPTIONS } from './route';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireAuthAsync } from '@/middleware/auth';

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('@/middleware/auth', () => ({
  requireAuthAsync: jest.fn(),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@/middleware/cors', () => ({
  handleOptionsRequest: jest.fn(() => new NextResponse(null, { status: 200 })),
  addCorsHeaders: jest.fn((res) => res),
}));

describe('/api/auth/me per-user language preference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles OPTIONS preflight', async () => {
    const req = { headers: new Headers() } as unknown as NextRequest;
    const res = await OPTIONS(req);
    expect(res.status).toBe(200);
  });

  it('GET returns user with preferred_language when set to fil', async () => {
    (requireAuthAsync as jest.Mock).mockResolvedValue({
      user: { userId: 'user-b', email: 'b@bmdc.edu', role: 'trainee' },
    });

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'user-b',
          username: 'Maria',
          email: 'b@bmdc.edu',
          role: 'trainee',
          preferred_language: 'fil',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        error: null,
      }),
    };
    (supabaseAdmin.from as jest.Mock).mockReturnValue(chain);

    const req = { headers: new Headers() } as unknown as NextRequest;
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.preferred_language).toBe('fil');
  });

  it('GET falls back gracefully to en when preferred_language column is not yet migrated (42703)', async () => {
    (requireAuthAsync as jest.Mock).mockResolvedValue({
      user: { userId: 'user-a', email: 'a@bmdc.edu', role: 'local_admin' },
    });

    const singleMock = jest
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: '42703', message: 'column users.preferred_language does not exist' },
      })
      .mockResolvedValueOnce({
        data: {
          id: 'user-a',
          username: 'AdminA',
          email: 'a@bmdc.edu',
          role: 'local_admin',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        error: null,
      });

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: singleMock,
    };
    (supabaseAdmin.from as jest.Mock).mockReturnValue(chain);

    const req = { headers: new Headers() } as unknown as NextRequest;
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.preferred_language).toBe('en');
    expect(singleMock).toHaveBeenCalledTimes(2);
  });

  it('PATCH updates only the authenticated user preferred_language', async () => {
    (requireAuthAsync as jest.Mock).mockResolvedValue({
      user: { userId: 'user-c', email: 'c@bmdc.edu', role: 'trainee' },
    });

    const eqMock = jest.fn().mockReturnThis();
    const updateMock = jest.fn().mockReturnThis();
    const chain = {
      update: updateMock,
      eq: eqMock,
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: 'user-c', preferred_language: 'fil' },
        error: null,
      }),
    };
    (supabaseAdmin.from as jest.Mock).mockReturnValue(chain);

    const req = {
      headers: new Headers(),
      json: async () => ({ preferred_language: 'fil' }),
    } as unknown as NextRequest;

    const res = await PATCH(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({ preferred_language: 'fil' });
    expect(eqMock).toHaveBeenCalledWith('id', 'user-c');
    expect(json.data).toEqual({
      id: 'user-c',
      preferred_language: 'fil',
      persisted: true,
    });
  });

  it('PATCH rejects unsupported language codes with 400', async () => {
    (requireAuthAsync as jest.Mock).mockResolvedValue({
      user: { userId: 'user-c', email: 'c@bmdc.edu', role: 'trainee' },
    });

    const req = {
      headers: new Headers(),
      json: async () => ({ preferred_language: 'es' }),
    } as unknown as NextRequest;

    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it('PATCH returns persisted:false gracefully when column is missing (42703)', async () => {
    (requireAuthAsync as jest.Mock).mockResolvedValue({
      user: { userId: 'user-d', email: 'd@bmdc.edu', role: 'staff_inventory_manager' },
    });

    const chain = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { code: '42703', message: 'column "preferred_language" does not exist' },
      }),
    };
    (supabaseAdmin.from as jest.Mock).mockReturnValue(chain);

    const req = {
      headers: new Headers(),
      json: async () => ({ preferred_language: 'fil' }),
    } as unknown as NextRequest;

    const res = await PATCH(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      id: 'user-d',
      preferred_language: 'fil',
      persisted: false,
    });
  });
});
