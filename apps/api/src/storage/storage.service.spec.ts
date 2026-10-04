import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

const upload = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: { from: () => ({ upload }) },
  }),
}));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const WEBP = Buffer.from('RIFF0000WEBPVP8 ');

const dataUrl = (mime: string, buf: Buffer) =>
  `data:${mime};base64,${buf.toString('base64')}`;

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    upload.mockReset().mockResolvedValue({ error: null });
    const config = {
      getOrThrow: (key: string) =>
        key === 'SUPABASE_URL' ? 'https://project.supabase.co' : 'service-key',
    } as unknown as ConfigService;
    service = new StorageService(config);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  describe('snapshotReleaseImage', () => {
    it('decodes a PNG data URL and stores it under the release', async () => {
      const path = await service.snapshotReleaseImage(
        'rel-1',
        'signer-sig',
        dataUrl('image/png', PNG)
      );

      expect(path).toBe('rel-1/signer-sig.png');
      expect(upload).toHaveBeenCalledWith('rel-1/signer-sig.png', PNG, {
        contentType: 'image/png',
        upsert: false,
      });
    });

    it('uses the real image type, not the data URL label', async () => {
      const path = await service.snapshotReleaseImage(
        'rel-1',
        'analyst-sig',
        dataUrl('image/png', JPEG)
      );

      expect(path).toBe('rel-1/analyst-sig.jpg');
      expect(upload).toHaveBeenCalledWith(
        'rel-1/analyst-sig.jpg',
        JPEG,
        expect.objectContaining({ contentType: 'image/jpeg' })
      );
    });

    it('returns null for formats pdfkit cannot embed', async () => {
      const path = await service.snapshotReleaseImage(
        'rel-1',
        'signer-sig',
        dataUrl('image/webp', WEBP)
      );

      expect(path).toBeNull();
      expect(upload).not.toHaveBeenCalled();
    });

    it('refuses to fetch URLs outside the Supabase project', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');

      const path = await service.snapshotReleaseImage(
        'rel-1',
        'logo',
        'https://evil.example.com/logo.png'
      );

      expect(path).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('returns null when there is no image', async () => {
      expect(
        await service.snapshotReleaseImage('rel-1', 'logo', null)
      ).toBeNull();
    });
  });

  describe('snapshotReleaseImages', () => {
    it('never throws — a failed upload leaves that path null', async () => {
      upload
        .mockResolvedValueOnce({ error: { message: 'bucket missing' } })
        .mockResolvedValue({ error: null });

      const result = await service.snapshotReleaseImages('rel-1', {
        logoUrl: dataUrl('image/png', PNG),
        signerSignatureUrl: dataUrl('image/png', PNG),
        analystSignatureUrl: null,
      });

      expect(result).toEqual({
        logoStoragePath: null,
        signerSignatureStoragePath: 'rel-1/signer-sig.png',
        analystSignatureStoragePath: null,
      });
    });
  });
});
