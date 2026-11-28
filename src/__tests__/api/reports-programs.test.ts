import { NextRequest } from 'next/server';
import { GET } from '@/app/api/reports/programs/route';
import { requireTenantContext } from '@/middleware/tenantContext';
import { supabaseAdmin } from '@/lib/supabase-admin';

jest.mock('@/middleware/tenantContext');
jest.mock('@/lib/supabase-admin');
jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));

describe('GET /api/reports/programs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('chunks large trainee ID lists so 500+ enrollments do not overflow PostgREST URL limits', async () => {
    (requireTenantContext as jest.Mock).mockReturnValue({
      context: {
        tenantId: 'tenant-1',
        userId: 'staff-1',
        role: 'staff_training_coordinator',
        isSuperAdmin: false,
      },
    });

    const enrollments = Array.from({ length: 350 }, (_, idx) => ({
      program_id: 'prog-1',
      trainee_id: `trainee-${idx + 1}`,
      status: idx < 50 ? 'completed' : 'enrolled',
      enrollment_date: '2026-10-15',
    }));

    const traineeChunkSizes: number[] = [];

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'programs') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              is: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'prog-1',
                      name: 'SMAW NC II',
                      status: 'active',
                      max_trainees: 400,
                      enrollment_limit: 400,
                      start_date: '2026-10-01',
                      end_date: '2026-11-26',
                      created_at: '2026-09-28T00:00:00Z',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'enrollments') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                range: jest.fn().mockResolvedValue({
                  data: enrollments,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'trainees') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockImplementation((_col: string, ids: string[]) => {
              traineeChunkSizes.push(ids.length);
              return Promise.resolve({
                data: ids.map((id) => ({
                  id,
                  first_name: 'Trainee',
                  last_name: id,
                  email: `${id}@bmdc.site`,
                })),
                error: null,
              });
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const req = { url: 'http://localhost:3003/api/reports/programs' } as NextRequest;
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(traineeChunkSizes).toEqual([150, 150, 50]);
    expect(body.data.totalPrograms).toBe(1);
    expect(body.data.programStats).toHaveLength(1);
    expect(body.data.programStats[0].enrolledCount).toBe(350);
    expect(body.data.programStats[0].completedCount).toBe(50);
    expect(body.data.programStats[0].students).toHaveLength(350);
  });

  it('denies trainee role with 403', async () => {
    (requireTenantContext as jest.Mock).mockReturnValue({
      context: {
        tenantId: 'tenant-1',
        userId: 'trainee-1',
        role: 'trainee',
        isSuperAdmin: false,
      },
    });

    const req = { url: 'http://localhost:3003/api/reports/programs' } as NextRequest;
    const response = await GET(req);
    expect(response.status).toBe(403);
  });
});
