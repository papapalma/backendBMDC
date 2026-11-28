const mockFrom = jest.fn();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

import { sessionService, type CreateSessionData } from './sessionService';

function makeSelectChain(result: { data: any; error: any }) {
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn(async () => result),
  };
  return chain;
}

function makeInsertChain(result: { data: any; error: any }) {
  const chain: any = {
    insert: jest.fn(() => chain),
    select: jest.fn(async () => result),
  };
  return chain;
}

describe('SessionService.bulkCreateSessions', () => {
  const programId = '44444444-4444-4444-8444-444444444444';
  const tenantId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReset();
  });

  it('skips dates already scheduled under a different title or time and inserts only missing dates', async () => {
    const existingChain = makeSelectChain({
      data: [{ session_date: '2026-11-26' }, { session_date: '2026-11-27' }],
      error: null,
    });
    const insertedRows = [
      { id: 'sess-1', program_id: programId, session_date: '2026-12-01', title: 'Session', tenant_id: tenantId },
    ];
    const insertChain = makeInsertChain({ data: insertedRows, error: null });

    mockFrom.mockReturnValueOnce(existingChain).mockReturnValueOnce(insertChain);

    const payload: CreateSessionData[] = [
      { program_id: programId, title: 'Session', session_date: '2026-11-26', start_time: '08:00', end_time: '17:00' },
      { program_id: programId, title: 'Wizard Session', session_date: '2026-11-27', start_time: '09:00', end_time: '16:00' },
      { program_id: programId, title: 'Session', session_date: '2026-12-01', start_time: '08:00', end_time: '17:00' },
      // Duplicate date inside the incoming payload itself
      { program_id: programId, title: 'Another Title', session_date: '2026-12-01', start_time: '13:00', end_time: '17:00' },
    ];

    const result = await sessionService.bulkCreateSessions(payload, tenantId);

    expect(result).toEqual(insertedRows);
    expect(insertChain.insert).toHaveBeenCalledTimes(1);
    expect(insertChain.insert).toHaveBeenCalledWith([
      {
        program_id: programId,
        title: 'Session',
        session_date: '2026-12-01',
        start_time: '08:00',
        end_time: '17:00',
        tenant_id: tenantId,
      },
    ]);
  });

  it('returns empty array without calling insert when all incoming dates already exist', async () => {
    const existingChain = makeSelectChain({
      data: [{ session_date: '2026-11-27' }],
      error: null,
    });
    mockFrom.mockReturnValueOnce(existingChain);

    const result = await sessionService.bulkCreateSessions(
      [{ program_id: programId, title: 'Session', session_date: '2026-11-27', start_time: '08:00', end_time: '17:00' }],
      tenantId
    );

    expect(result).toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('returns empty array immediately when given an empty list', async () => {
    const result = await sessionService.bulkCreateSessions([], tenantId);
    expect(result).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
