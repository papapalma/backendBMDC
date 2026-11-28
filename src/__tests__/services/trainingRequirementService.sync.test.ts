import { promises as fs } from 'fs';
import { uploadRequirementFile } from '@/services/trainingRequirementService';
import { supabaseAdmin } from '@/lib/supabase-admin';

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/lib/supabase-admin');
jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('trainingRequirementService enrollment_requirements sync', () => {
  const tenantId = '194876de-a68c-4d33-8f80-c0978e5d44b3';
  const traineeId = 'trainee-111';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('syncs pending enrollment_requirements rows to submitted when a requirement file is uploaded', async () => {
    const updateCalls: Array<{ payload: any; id: string }> = [];

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'training_requirement_files') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: 'file-1',
                  requirement_type: 'valid_id_copy',
                  file_path: `/uploads/${tenantId}/documents/trainees/${traineeId}/valid_id_copy.pdf`,
                  file_name: 'id.pdf',
                  file_size_bytes: 5,
                  uploaded_at: '2026-11-27T08:00:00.000Z',
                  uploaded_by: 'user-1',
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'requirement_definitions') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'req-def-1' }, error: null }),
        };
      }

      if (table === 'enrollments') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockImplementation(function (this: any) {
            return {
              eq: jest.fn().mockResolvedValue({
                data: [{ id: 'enroll-1' }, { id: 'enroll-2' }],
                error: null,
              }),
            };
          }),
        };
      }

      if (table === 'enrollment_requirements') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({
            data: [
              { id: 'er-1', enrollment_id: 'enroll-1', submission_status: 'pending' },
              { id: 'er-2', enrollment_id: 'enroll-2', submission_status: 'verified' },
            ],
            error: null,
          }),
          update: jest.fn().mockImplementation((payload: any) => ({
            eq: jest.fn().mockImplementation((_col: string, id: string) => ({
              eq: jest.fn().mockImplementation(() => {
                updateCalls.push({ payload, id });
                return Promise.resolve({ error: null });
              }),
            })),
          })),
        };
      }

      return { select: jest.fn().mockReturnThis() };
    });

    const result = await uploadRequirementFile({
      tenantId,
      traineeId,
      requirementType: 'valid_id_copy',
      file: Buffer.from('hello'),
      fileName: 'id.pdf',
      mimeType: 'application/pdf',
      userId: 'user-1',
    });

    expect(fs.writeFile).toHaveBeenCalled();
    expect(result.id).toBe('file-1');
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]).toEqual({
      id: 'er-1',
      payload: expect.objectContaining({
        submission_status: 'submitted',
        submitted_at: '2026-11-27T08:00:00.000Z',
        document_url: expect.stringContaining(`/uploads/${tenantId}/documents/trainees/${traineeId}/valid_id_copy_`),
      }),
    });
    // Preserves already-verified status while updating document_url
    expect(updateCalls[1]).toEqual({
      id: 'er-2',
      payload: expect.objectContaining({
        submission_status: 'verified',
      }),
    });
  });
});
