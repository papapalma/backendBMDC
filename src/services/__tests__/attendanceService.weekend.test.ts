import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockFrom = jest.fn();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

import { attendanceService } from '../attendanceService';

function createBuilder(result: { data: any; error: any }) {
  const calls: Array<[string, any[]]> = [];
  const builder: any = {
    calls,
    select: jest.fn((...args: any[]) => {
      calls.push(['select', args]);
      return builder;
    }),
    eq: jest.fn((...args: any[]) => {
      calls.push(['eq', args]);
      return builder;
    }),
    in: jest.fn((...args: any[]) => {
      calls.push(['in', args]);
      return builder;
    }),
    gte: jest.fn((...args: any[]) => {
      calls.push(['gte', args]);
      return builder;
    }),
    lte: jest.fn((...args: any[]) => {
      calls.push(['lte', args]);
      return builder;
    }),
    order: jest.fn((...args: any[]) => {
      calls.push(['order', args]);
      return builder;
    }),
    limit: jest.fn((...args: any[]) => {
      calls.push(['limit', args]);
      return builder;
    }),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

describe('attendanceService weekend record visibility & date ordering regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves Saturday attendance records and scheduled Saturday sessions in getMonthlyCalendar', async () => {
    // 2026-11-28 is Saturday; 2026-11-22 is Sunday (no session); 2026-11-21 is Saturday (scheduled, no record)
    const enrollmentBuilder = createBuilder({
      data: [{ program_id: 'prog-1' }],
      error: null,
    });
    const attendanceBuilder = createBuilder({
      data: [
        {
          id: 'att-sat-28',
          status: 'late',
          morning_status: 'late',
          afternoon_status: 'late',
          selfie_morning_path: '/uploads/t1/images/attendance/am.jpg',
          selfie_afternoon_path: '/uploads/t1/images/attendance/pm.jpg',
          updated_at: '2026-11-28T05:19:00.000Z',
          session: { session_date: '2026-11-28', program_id: 'prog-1' },
        },
      ],
      error: null,
    });
    const sessionsBuilder = createBuilder({
      data: [
        { id: 'sess-21', session_date: '2026-11-21', program_id: 'prog-1' },
        { id: 'sess-28', session_date: '2026-11-28', program_id: 'prog-1' },
      ],
      error: null,
    });
    const exceptionsBuilder = createBuilder({ data: [], error: null });

    mockFrom
      .mockReturnValueOnce(enrollmentBuilder)
      .mockReturnValueOnce(attendanceBuilder)
      .mockReturnValueOnce(sessionsBuilder)
      .mockReturnValueOnce(exceptionsBuilder);

    const calendar = await attendanceService.getMonthlyCalendar('trainee-1', 2026, 11, 'tenant-1');

    const sat28 = calendar.find((d) => d.date === '2026-11-28');
    expect(sat28?.status).toBe('late');
    expect(sat28?.record?.id).toBe('att-sat-28');
    expect(sat28?.record?.selfie_afternoon_path).toBe('/uploads/t1/images/attendance/pm.jpg');

    const sat21 = calendar.find((d) => d.date === '2026-11-21');
    expect(sat21?.status).toBe('pending');

    const sun22 = calendar.find((d) => d.date === '2026-11-22');
    expect(sun22?.status).toBe('weekend');
  });

  it('orders getAttendanceByTrainee by updated_at desc and uses inner join on dateFilter', async () => {
    const attBuilder = createBuilder({
      data: [
        {
          id: 'att-latest',
          selfie_afternoon_path: '/uploads/t1/images/attendance/pm.jpg',
          session: { id: 's1', session_date: '2026-11-28' },
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValueOnce(attBuilder);

    const rows = await attendanceService.getAttendanceByTrainee(
      'trainee-1',
      'tenant-1',
      '2026-11-28'
    );

    expect(rows).toHaveLength(1);
    expect(attBuilder.select).toHaveBeenCalledWith(expect.stringContaining('program_sessions!inner'));
    expect(attBuilder.order).toHaveBeenNthCalledWith(1, 'updated_at', { ascending: false });
  });
});
