import { ProgramService } from '@/services/programService';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { Program } from '@/types';

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock('@/utils/fileUpload', () => ({
  deleteImageWithThumbnail: jest.fn(),
  ensureThumbnailForImagePath: jest.fn(async () => '/uploads/images/defaults/blank-thumbnail.webp'),
}));

function makeProgram(overrides: Partial<Program>): Program {
  return {
    id: 'prog-1',
    name: 'Test Program',
    description: 'Desc',
    duration_weeks: 4,
    start_date: '2026-01-01',
    end_date: '2026-02-01',
    status: 'active',
    max_trainees: 30,
    type_of_funding: 'TESDA',
    tenant_id: 'tenant-a',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ProgramService.enrichProgramWithEnrollment (batched & RBAC-safe)', () => {
  const service = new ProgramService();
  const mockFrom = supabaseAdmin.from as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('batches enrollment counts into 1 query and isolates by tenant_id without leaking total_registrations', async () => {
    const eqMock = jest.fn().mockResolvedValue({
      data: [
        { program_id: 'prog-1', tenant_id: 'tenant-a' },
        { program_id: 'prog-1', tenant_id: 'tenant-a' },
        // Cross-tenant row for same program id must NOT be counted for tenant-a
        { program_id: 'prog-1', tenant_id: 'tenant-b' },
        { program_id: 'prog-2', tenant_id: 'tenant-a' },
      ],
      error: null,
    });
    const inMock = jest.fn().mockReturnValue({ eq: eqMock });
    const selectMock = jest.fn().mockReturnValue({ in: inMock });
    mockFrom.mockReturnValue({ select: selectMock });

    const result = (await service.enrichProgramWithEnrollment([
      makeProgram({ id: 'prog-1', tenant_id: 'tenant-a' }),
      makeProgram({ id: 'prog-2', tenant_id: 'tenant-a' }),
    ])) as Program[];

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('enrollments');
    expect(result[0].current_enrollment).toBe(2);
    expect(result[1].current_enrollment).toBe(1);
    expect(result[0].total_registrations).toBeUndefined();
    expect(result[1].total_registrations).toBeUndefined();
  });

  it('batches deduplicated tenant-scoped registration counts only when includeRegistrationCounts is true', async () => {
    const enrollmentsRes = {
      data: [{ program_id: 'prog-1', tenant_id: 'tenant-a' }],
      error: null,
    };
    const registrationsRes = {
      data: [
        // Same trainee twice -> counts once
        { program_id: 'prog-1', trainee_id: 't1', trainee: { id: 't1', tenant_id: 'tenant-a', registration_status: 'pending' } },
        { program_id: 'prog-1', trainee_id: 't1', trainee: { id: 't1', tenant_id: 'tenant-a', registration_status: 'pending' } },
        { program_id: 'prog-1', trainee_id: 't2', trainee: { id: 't2', tenant_id: 'tenant-a', registration_status: 'approved' } },
        // Cross-tenant trainee -> excluded from tenant-a count
        { program_id: 'prog-1', trainee_id: 't3', trainee: { id: 't3', tenant_id: 'tenant-b', registration_status: 'pending' } },
      ],
      error: null,
    };

    let callIndex = 0;
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockImplementation(() => {
        callIndex += 1;
        if (callIndex === 1) {
          return { in: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue(enrollmentsRes) }) };
        }
        return { in: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue(registrationsRes) }) };
      }),
    }));

    const result = (await service.enrichProgramWithEnrollment(
      [makeProgram({ id: 'prog-1', tenant_id: 'tenant-a' })],
      { includeRegistrationCounts: true }
    )) as Program[];

    expect(mockFrom).toHaveBeenCalledTimes(2);
    expect(result[0].current_enrollment).toBe(1);
    expect(result[0].total_registrations).toBe(2);
  });
});
