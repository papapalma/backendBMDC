import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockInsertSingle = jest.fn<any>();
const mockVerifySingle = jest.fn<any>();
const mockUpdateEq = jest.fn<any>();
const mockSendEmail = jest.fn<any>();
const mockSendWhatsApp = jest.fn<any>();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => {
      if (table === 'email_verifications') {
        return {
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: mockInsertSingle,
            })),
          })),
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  single: mockVerifySingle,
                })),
              })),
            })),
          })),
          update: jest.fn(() => ({
            eq: mockUpdateEq,
          })),
        };
      }
      return {};
    }),
  },
}));

jest.mock('@/services/emailService', () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
}));

jest.mock('@/services/whatsappService', () => ({
  sendWhatsApp: (...args: any[]) => mockSendWhatsApp(...args),
}));

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { VerificationService } from '@/services/verificationService';

describe('VerificationService', () => {
  let service: VerificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VerificationService();
    mockInsertSingle.mockResolvedValue({
      data: { id: 'verif-1', email: 'trainee@gmail.com', code: '123456' },
      error: null,
    });
    mockUpdateEq.mockResolvedValue({ error: null });
  });

  it('throws when sendEmail returns { success: false } instead of reporting silent success', async () => {
    mockSendEmail.mockResolvedValue({
      success: false,
      error: 'SMTP authentication failed',
      deliveryStatus: 'failed',
      attempts: 3,
      usedFallbackConfig: true,
    });

    await expect(
      service.sendVerificationCode({
        email: '  Trainee@Gmail.com  ',
        method: 'email',
        firstName: 'Juan',
        registrationContext: true,
        tenantId: 'tenant-123',
      })
    ).rejects.toThrow('SMTP authentication failed');

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-123',
        recipientEmail: 'trainee@gmail.com',
        templateName: 'email_verification',
      })
    );
  });

  it('succeeds and forwards tenantId when sendEmail returns { success: true }', async () => {
    mockSendEmail.mockResolvedValue({
      success: true,
      messageId: 'msg-1',
      deliveryStatus: 'sent',
      attempts: 1,
      usedFallbackConfig: false,
    });

    const result = await service.sendVerificationCode({
      email: 'Trainee@Gmail.com',
      method: 'email',
      firstName: 'Maria',
      registrationContext: true,
      tenantId: 'tenant-abc',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('email');
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-abc',
        recipientEmail: 'trainee@gmail.com',
      })
    );
  });

  it('verifies a valid unexpired OTP with trimmed case-insensitive email', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    mockVerifySingle.mockResolvedValue({
      data: {
        id: 'verif-1',
        email: 'trainee@gmail.com',
        code: '654321',
        expires_at: future,
        attempt_count: 0,
      },
      error: null,
    });

    const result = await service.verifyCode({
      email: '  Trainee@Gmail.com ',
      code: '654321',
    });

    expect(result.success).toBe(true);
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'verif-1');
  });
});
