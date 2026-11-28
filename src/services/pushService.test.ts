const mockFrom = jest.fn();
const mockSendNotification = jest.fn();
const mockSetVapidDetails = jest.fn();

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: (...args: any[]) => mockSetVapidDetails(...args),
    sendNotification: (...args: any[]) => mockSendNotification(...args),
  },
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

import {
  parseStoredSubscription,
  sendPushNotificationToUser,
  sendPushNotificationToTargets,
} from './pushService';

function makeQueryChain(result: any) {
  const chain: any = {
    select: jest.fn(() => chain),
    update: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    or: jest.fn(() => chain),
    in: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => result),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

describe('pushService (JSONB schema + lazy VAPID + dual user_id/trainee_id delivery)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const traineeId = '33333333-3333-4333-8333-333333333333';
  const userId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFrom.mockReset();
    process.env.VAPID_PUBLIC_KEY = 'test-public-vapid-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-vapid-key';
  });

  it('parses valid JSONB subscription payloads and rejects malformed entries', () => {
    expect(parseStoredSubscription(null)).toBeNull();
    expect(parseStoredSubscription({ endpoint: 'https://push.example/1' })).toBeNull();
    expect(
      parseStoredSubscription({
        endpoint: 'https://push.example/1',
        keys: { auth: 'auth-tok', p256dh: 'p256-key' },
      })
    ).toEqual({
      endpoint: 'https://push.example/1',
      keys: { auth: 'auth-tok', p256dh: 'p256-key' },
      deviceIdentifier: null,
      userAgent: null,
      isActive: true,
      lastUsedAt: null,
    });
  });

  it('lazily initializes VAPID, delivers to JSONB subscriptions matched by trainee_id/user_id, and updates lastUsedAt', async () => {
    const fetchChain = makeQueryChain({
      data: [
        {
          id: 'sub-1',
          tenant_id: tenantId,
          user_id: userId,
          trainee_id: traineeId,
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
            keys: { auth: 'auth-1', p256dh: 'p256-1' },
            isActive: true,
          },
        },
      ],
      error: null,
    });
    const updateChain = makeQueryChain({ data: null, error: null });

    mockFrom.mockReturnValueOnce(fetchChain).mockReturnValueOnce(updateChain);
    mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });

    const res = await sendPushNotificationToUser(traineeId, tenantId, {
      title: 'Morning Attendance Reminder',
      body: 'Submit your attendance now',
      url: '/trainee/attendance',
    });

    expect(mockSetVapidDetails).toHaveBeenCalledTimes(1);
    expect(fetchChain.or).toHaveBeenCalledWith(`user_id.eq.${traineeId},trainee_id.eq.${traineeId}`);
    expect(mockSendNotification).toHaveBeenCalledWith(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { auth: 'auth-1', p256dh: 'p256-1' },
      },
      expect.stringContaining('Morning Attendance Reminder')
    );
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: expect.objectContaining({ isActive: true, lastUsedAt: expect.any(String) }),
      })
    );
    expect(res).toMatchObject({ sent: 1, failed: 0, removed: 0 });
  });

  it('marks expired 410 Gone subscriptions inactive in JSONB during batched delivery', async () => {
    const byUserChain = makeQueryChain({
      data: [
        {
          id: 'sub-gone',
          tenant_id: tenantId,
          user_id: userId,
          trainee_id: traineeId,
          subscription: {
            endpoint: 'https://push.example/expired',
            keys: { auth: 'a', p256dh: 'p' },
            isActive: true,
          },
        },
      ],
      error: null,
    });
    const byTraineeChain = makeQueryChain({ data: [], error: null });
    const deactivateChain = makeQueryChain({ data: null, error: null });

    mockFrom
      .mockReturnValueOnce(byUserChain)
      .mockReturnValueOnce(byTraineeChain)
      .mockReturnValueOnce(deactivateChain);
    mockSendNotification.mockRejectedValueOnce({ statusCode: 410, message: 'Gone' });

    const res = await sendPushNotificationToTargets(
      tenantId,
      { userIds: [userId], traineeIds: [traineeId] },
      { title: 'Afternoon Reminder', body: 'Check in', url: '/trainee/attendance' }
    );

    expect(res).toMatchObject({ sent: 0, failed: 0, removed: 1 });
    expect(deactivateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: expect.objectContaining({ isActive: false }),
      })
    );
  });
});
