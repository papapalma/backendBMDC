import { TraineeService } from '@/services/traineeService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { TenantContext } from '@/middleware/tenantContext';

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('@/utils/fileUpload', () => ({
  deleteImageWithThumbnail: jest.fn(),
  ensureThumbnailForImagePath: jest.fn(async () => '/uploads/images/defaults/blank-thumbnail.webp'),
}));

function makeQueryChain(resolvedValue: any) {
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    is: jest.fn(() => chain),
    in: jest.fn(() => chain),
    or: jest.fn(() => chain),
    order: jest.fn(() => chain),
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(resolvedValue).then(onFulfilled, onRejected),
  };
  return chain;
}

describe('TraineeService.getAllTrainees (batched remarks & RBAC/tenant isolation)', () => {
  const service = new TraineeService();
  const mockFrom = supabaseAdmin.from as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('batches latest_remark in 1 tenant-scoped query for local_admin', async () => {
    const traineesChain = makeQueryChain({
      data: [
        {
          id: 't1',
          first_name: 'Alice',
          last_name: 'Cruz',
          email: 'alice@example.com',
          enrollments: [{ id: 'e1', program_id: 'p1', status: 'enrolled', program: { id: 'p1', name: 'Welding' } }],
        },
        {
          id: 't2',
          first_name: 'Bob',
          last_name: 'Reyes',
          email: 'bob@example.com',
          enrollments: [],
        },
      ],
      error: null,
    });

    const remarksChain = makeQueryChain({
      data: [
        { trainee_id: 't1', remark: 'Newest remark', created_at: '2026-11-22T10:00:00Z' },
        { trainee_id: 't1', remark: 'Older remark', created_at: '2026-11-20T10:00:00Z' },
      ],
      error: null,
    });

    mockFrom.mockImplementation((table: string) =>
      table === 'trainees' ? traineesChain : remarksChain
    );

    const context: TenantContext = {
      tenantId: 'tenant-1',
      userId: 'admin-1',
      role: 'local_admin',
      isSuperAdmin: false,
    };

    const result = await service.getAllTrainees(context);

    expect(mockFrom).toHaveBeenCalledWith('trainees');
    expect(mockFrom).toHaveBeenCalledWith('trainee_remarks');
    expect(remarksChain.eq).toHaveBeenCalledWith('tenant_id', 'tenant-1');
    expect(result[0].latest_remark).toBe('Newest remark');
    expect(result[1].latest_remark).toBe('');
  });

  it('does NOT query or attach trainee_remarks for staff_training_coordinator', async () => {
    const traineesChain = makeQueryChain({
      data: [{ id: 't1', first_name: 'Alice', last_name: 'Cruz', email: 'alice@example.com', enrollments: [] }],
      error: null,
    });

    mockFrom.mockReturnValue(traineesChain);

    const context: TenantContext = {
      tenantId: 'tenant-1',
      userId: 'staff-1',
      role: 'staff_training_coordinator',
      isSuperAdmin: false,
    };

    const result = await service.getAllTrainees(context);

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('trainees');
    expect(result[0].latest_remark).toBeUndefined();
  });

  it('orders newly re-enrolled existing trainees ahead of older trainees without bumping dropped enrollments', async () => {
    const traineesChain = makeQueryChain({
      data: [
        {
          id: 't-new',
          first_name: 'New',
          last_name: 'Trainee',
          email: 'new@example.com',
          created_at: '2026-11-26T10:00:00Z',
          enrollments: [{ id: 'e-new', program_id: 'p1', status: 'enrolled', created_at: '2026-11-26T10:00:01Z' }],
        },
        {
          id: 't-dropped',
          first_name: 'Dropped',
          last_name: 'Trainee',
          email: 'dropped@example.com',
          created_at: '2026-10-01T10:00:00Z',
          enrollments: [{ id: 'e-drop', program_id: 'p1', status: 'dropped', created_at: '2026-11-28T10:00:00Z' }],
        },
        {
          id: 't-reenrolled',
          first_name: 'Reenrolled',
          last_name: 'Trainee',
          email: 'reenrolled@example.com',
          created_at: '2026-09-15T10:00:00Z',
          enrollments: [
            { id: 'e-old', program_id: 'p0', status: 'dropped', created_at: '2026-09-15T10:00:01Z' },
            { id: 'e-recent', program_id: 'p1', status: 'enrolled', created_at: '2026-11-27T10:00:00Z', enrollment_date: '2026-11-27' },
          ],
        },
      ],
      error: null,
    });

    mockFrom.mockReturnValue(traineesChain);

    const context: TenantContext = {
      tenantId: 'tenant-1',
      userId: 'staff-1',
      role: 'staff_training_coordinator',
      isSuperAdmin: false,
    };

    const result = await service.getAllTrainees(context);

    expect(result.map((t) => t.id)).toEqual(['t-reenrolled', 't-new', 't-dropped']);
  });
});
