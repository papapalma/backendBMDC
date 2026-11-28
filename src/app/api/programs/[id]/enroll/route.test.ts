import { NextRequest } from 'next/server';

const mockFrom = jest.fn();
const mockRequireTenantContext = jest.fn();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

jest.mock('@/middleware/tenantContext', () => ({
  requireTenantContext: (...args: any[]) => mockRequireTenantContext(...args),
}));

jest.mock('@/middleware/errorHandler', () => ({
  withErrorHandler: (handler: Function) => handler,
}));

import { POST } from './route';

function makeChain(result: any) {
  const chain: any = {
    select: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    update: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    in: jest.fn(() => chain),
    is: jest.fn(() => chain),
    single: jest.fn(async () => result),
    maybeSingle: jest.fn(async () => result),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

describe('POST /api/programs/[id]/enroll', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const traineeId = '33333333-3333-4333-8333-333333333333';
  const programId = '44444444-4444-4444-8444-444444444444';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReset();
    mockRequireTenantContext.mockReturnValue({
      context: {
        tenantId,
        userId,
        role: 'trainee',
        isSuperAdmin: false,
      },
    });
  });

  it('resolves trainees.id from JWT userId (ignoring spoofed/user body ID) and inserts valid normalized enrollment columns', async () => {
    const accountLinkChain = makeChain({ data: { trainee_id: traineeId }, error: null });
    const traineeChain = makeChain({
      data: { id: traineeId, tenant_id: tenantId, status: 'active' },
      error: null,
    });
    const programChain = makeChain({
      data: {
        id: programId,
        status: 'upcoming',
        enrollment_limit: 25,
        max_trainees: 25,
        tenant_id: tenantId,
      },
      error: null,
    });
    const existingEnrollChain = makeChain({ data: null, error: null });
    const countChain = makeChain({ count: 5, error: null });
    const insertChain = makeChain({
      data: {
        id: '55555555-5555-4555-8555-555555555555',
        program_id: programId,
        trainee_id: traineeId,
        status: 'enrolled',
        enrollment_date: '2026-11-27',
      },
      error: null,
    });

    mockFrom
      .mockReturnValueOnce(accountLinkChain)
      .mockReturnValueOnce(traineeChain)
      .mockReturnValueOnce(programChain)
      .mockReturnValueOnce(existingEnrollChain)
      .mockReturnValueOnce(countChain)
      .mockReturnValueOnce(insertChain);

    const req = new NextRequest(`http://localhost:3003/api/programs/${programId}/enroll`, {
      method: 'POST',
      body: JSON.stringify({ trainee_id: userId }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: programId }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.trainee_id).toBe(traineeId);
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: tenantId,
        program_id: programId,
        trainee_id: traineeId,
        status: 'enrolled',
        source: 'social_share',
        enrollment_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    );
    expect(insertChain.insert.mock.calls[0][0]).not.toHaveProperty('enrollment_source');
  });

  it('rejects duplicate active enrollment with 409', async () => {
    mockFrom
      .mockReturnValueOnce(makeChain({ data: { trainee_id: traineeId }, error: null }))
      .mockReturnValueOnce(makeChain({ data: { id: traineeId, tenant_id: tenantId, status: 'active' }, error: null }))
      .mockReturnValueOnce(
        makeChain({
          data: { id: programId, status: 'active', enrollment_limit: 25, max_trainees: 25, tenant_id: tenantId },
          error: null,
        })
      )
      .mockReturnValueOnce(makeChain({ data: { id: 'enr-1', status: 'enrolled' }, error: null }));

    const req = new NextRequest(`http://localhost:3003/api/programs/${programId}/enroll`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: programId }) });
    expect(res.status).toBe(409);
  });

  it('rejects enrollment when program is at full capacity with 403', async () => {
    mockFrom
      .mockReturnValueOnce(makeChain({ data: { trainee_id: traineeId }, error: null }))
      .mockReturnValueOnce(makeChain({ data: { id: traineeId, tenant_id: tenantId, status: 'active' }, error: null }))
      .mockReturnValueOnce(
        makeChain({
          data: { id: programId, status: 'active', enrollment_limit: 10, max_trainees: 10, tenant_id: tenantId },
          error: null,
        })
      )
      .mockReturnValueOnce(makeChain({ data: null, error: null }))
      .mockReturnValueOnce(makeChain({ count: 10, error: null }));

    const req = new NextRequest(`http://localhost:3003/api/programs/${programId}/enroll`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: programId }) });
    expect(res.status).toBe(403);
  });

  it('re-enrolls a trainee whose previous enrollment was dropped using source=social_share', async () => {
    const updateChain = makeChain({
      data: {
        id: 'enr-dropped-1',
        program_id: programId,
        trainee_id: traineeId,
        status: 'enrolled',
        enrollment_date: '2026-11-27',
      },
      error: null,
    });

    mockFrom
      .mockReturnValueOnce(makeChain({ data: { trainee_id: traineeId }, error: null }))
      .mockReturnValueOnce(makeChain({ data: { id: traineeId, tenant_id: tenantId, status: 'active' }, error: null }))
      .mockReturnValueOnce(
        makeChain({
          data: { id: programId, status: 'active', enrollment_limit: 25, max_trainees: 25, tenant_id: tenantId },
          error: null,
        })
      )
      .mockReturnValueOnce(makeChain({ data: { id: 'enr-dropped-1', status: 'dropped' }, error: null }))
      .mockReturnValueOnce(updateChain);

    const req = new NextRequest(`http://localhost:3003/api/programs/${programId}/enroll`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: programId }) });
    expect(res.status).toBe(200);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'enrolled',
        source: 'social_share',
      })
    );
  });
});
