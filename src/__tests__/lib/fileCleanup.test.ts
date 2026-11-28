import path from 'path';
import { promises as fs } from 'fs';

const mockFrom = jest.fn();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { findOrphanedFiles } from '@/lib/fileCleanup';

describe('fileCleanup — attendance, requirements, announcements & messages tracking', () => {
  const TENANT_ID = '194876de-a68c-4d33-8f80-c0978e5d44b3';
  const uploadRoot = path.join(process.cwd(), 'public', 'uploads', TENANT_ID);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('treats files referenced in attendance selfies, requirement files, announcements, and messages as referenced (not orphaned)', async () => {
    const selfieAm = `/uploads/${TENANT_ID}/images/attendance/seed-attendance-male-1-am.jpg`;
    const selfiePm = `/uploads/${TENANT_ID}/images/attendance/seed-attendance-male-1-pm.jpg`;
    const reqFile = `/uploads/${TENANT_ID}/documents/trainees/seed-requirement-sample.pdf`;
    const docUrl = `/uploads/${TENANT_ID}/documents/trainees/seed-id-picture-sample.jpg`;
    const annMedia = `/uploads/${TENANT_ID}/images/cms/banner.jpg`;
    const msgAttachment = `/uploads/${TENANT_ID}/messenger/attach.jpg`;
    const genuineOrphan = `/uploads/${TENANT_ID}/images/attendance/unreferenced-old.jpg`;

    // Mock filesystem tree under tenant upload root
    jest.spyOn(fs, 'readdir').mockImplementation(async (dirPath: any) => {
      const normalized = String(dirPath).replace(/\\/g, '/');
      if (normalized === uploadRoot.replace(/\\/g, '/')) {
        return [
          { name: 'images', isDirectory: () => true, isFile: () => false },
          { name: 'documents', isDirectory: () => true, isFile: () => false },
          { name: 'messenger', isDirectory: () => true, isFile: () => false },
        ] as any;
      }
      if (normalized.endsWith('/images')) {
        return [
          { name: 'attendance', isDirectory: () => true, isFile: () => false },
          { name: 'cms', isDirectory: () => true, isFile: () => false },
        ] as any;
      }
      if (normalized.endsWith('/images/attendance')) {
        return [
          { name: 'seed-attendance-male-1-am.jpg', isDirectory: () => false, isFile: () => true },
          { name: 'seed-attendance-male-1-pm.jpg', isDirectory: () => false, isFile: () => true },
          { name: 'unreferenced-old.jpg', isDirectory: () => false, isFile: () => true },
        ] as any;
      }
      if (normalized.endsWith('/images/cms')) {
        return [
          { name: 'banner.jpg', isDirectory: () => false, isFile: () => true },
        ] as any;
      }
      if (normalized.endsWith('/documents')) {
        return [
          { name: 'trainees', isDirectory: () => true, isFile: () => false },
        ] as any;
      }
      if (normalized.endsWith('/documents/trainees')) {
        return [
          { name: 'seed-requirement-sample.pdf', isDirectory: () => false, isFile: () => true },
          { name: 'seed-id-picture-sample.jpg', isDirectory: () => false, isFile: () => true },
        ] as any;
      }
      if (normalized.endsWith('/messenger')) {
        return [
          { name: 'attach.jpg', isDirectory: () => false, isFile: () => true },
        ] as any;
      }
      return [] as any;
    });

    // Make all files older than 48 hours so unreferenced files qualify as orphans
    jest.spyOn(fs, 'stat').mockResolvedValue({
      mtimeMs: Date.now() - 48 * 60 * 60 * 1000,
    } as any);

    const eqCalls: Array<{ table: string; col: string; val: string }> = [];
    const tableFixtures: Record<string, Record<string, any[]>> = {
      attendance: {
        selfie_morning_path: [{ selfie_morning_path: selfieAm }],
        selfie_afternoon_path: [{ selfie_afternoon_path: selfiePm }],
      },
      training_requirement_files: {
        file_path: [{ file_path: reqFile }],
      },
      enrollment_requirements: {
        document_url: [{ document_url: docUrl }],
      },
      announcements: {
        media_url: [{ media_url: annMedia }],
      },
      messages: {
        attachment_url: [{ attachment_url: msgAttachment }],
      },
    };

    mockFrom.mockImplementation((table: string) => ({
      select: (selectExpr: string) => {
        const colName = selectExpr.split(',')[0].trim();
        const builder: any = {
          not: () => builder,
          eq: (filterCol: string, filterVal: string) => {
            eqCalls.push({ table, col: filterCol, val: filterVal });
            return builder;
          },
          range: async () => ({
            data: tableFixtures[table]?.[colName] ?? [],
            error: null,
          }),
        };
        return builder;
      },
    }));

    const report = await findOrphanedFiles({
      tenantId: TENANT_ID,
      dryRun: true,
      minAgeHours: 24,
    });

    expect(report.totalScanned).toBe(7);
    expect(report.referencedFiles).toBe(6);
    expect(report.orphanedFiles).toBe(1);
    expect(report.orphanedPaths).toEqual([genuineOrphan]);

    // Verify messages uses conversation.tenant_id join instead of non-existent messages.tenant_id
    expect(eqCalls).toContainEqual({
      table: 'messages',
      col: 'conversation.tenant_id',
      val: TENANT_ID,
    });
    expect(eqCalls).toContainEqual({
      table: 'attendance',
      col: 'tenant_id',
      val: TENANT_ID,
    });
  });
});
