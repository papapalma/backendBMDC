import { promises as fs } from 'fs';
import { deleteFile, deleteImageWithThumbnail } from '@/utils/fileUpload';

describe('fileUpload.deleteFile — shared seed-* asset guard', () => {
  const TENANT_ID = '194876de-a68c-4d33-8f80-c0978e5d44b3';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preserves shared seed-* files without calling fs.unlink', async () => {
    const accessSpy = jest.spyOn(fs, 'access').mockResolvedValue(undefined);
    const unlinkSpy = jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

    const ok = await deleteFile(`/uploads/${TENANT_ID}/images/trainees/seed-trainee-male-1.jpg`);

    expect(ok).toBe(true);
    expect(accessSpy).not.toHaveBeenCalled();
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it('preserves both shared seed-* master image and thumbnail in deleteImageWithThumbnail', async () => {
    const unlinkSpy = jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

    const ok = await deleteImageWithThumbnail(
      `/uploads/${TENANT_ID}/images/trainees/seed-trainee-female-2.jpg`
    );

    expect(ok).toBe(true);
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it('still deletes normal user-uploaded image and thumbnail', async () => {
    jest.spyOn(fs, 'access').mockResolvedValue(undefined);
    const unlinkSpy = jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

    const ok = await deleteImageWithThumbnail(
      `/uploads/${TENANT_ID}/images/trainees/trainee_custom_1795000000_abcd.jpg`
    );

    expect(ok).toBe(true);
    expect(unlinkSpy).toHaveBeenCalledTimes(2);
  });
});
