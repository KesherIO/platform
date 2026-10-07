import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** Allowed MIME types for clinic logo uploads */
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** 2 MB max file size */
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

/** Supabase Storage bucket for clinic logos */
const LOGO_BUCKET = 'clinic-logos';

/** Private Supabase Storage bucket for vet credential documents */
const VET_CREDENTIALS_BUCKET = 'vet-credentials';

/** Private bucket for generated lab report PDFs */
const PDF_BUCKET = 'lab-reports';

/** Private bucket for release-specific image assets (logos, signatures) */
const RELEASE_ASSETS_BUCKET = 'release-assets';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly supabase: SupabaseClient;
  private readonly supabaseUrl: string;

  constructor(config: ConfigService) {
    this.supabaseUrl = config.getOrThrow<string>('SUPABASE_URL');
    this.supabase = createClient(
      this.supabaseUrl,
      // Use the service-role key for server-side storage operations (bypasses RLS)
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY')
    );
  }

  /**
   * Upload a clinic logo to Supabase Storage.
   *
   * Storage path: {tenantId}/logo.{ext}  (bucket: clinic-logos)
   * Returns the public URL — store this directly in Tenant.logoUrl.
   *
   * Validation:
   *   - Allowed types: PNG, JPEG, WebP
   *   - Max size: 2 MB
   */
  async uploadClinicLogo(
    tenantId: string,
    file: Express.Multer.File
  ): Promise<string> {
    this.validateLogoFile(file);

    const ext = this.extFromMime(file.mimetype);
    const path = `${tenantId}/logo.${ext}`;

    const { error } = await this.supabase.storage
      .from(LOGO_BUCKET)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: true, // overwrite if a logo was uploaded before for this tenant
      });

    if (error) {
      throw new InternalServerErrorException(
        `Storage upload failed: ${error.message}`
      );
    }

    const { data } = this.supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);

    // Append a timestamp so the browser doesn't serve a stale cached version
    // after the logo is replaced (same path = same URL = browser cache hit).
    return `${data.publicUrl}?t=${Date.now()}`;
  }

  /**
   * Upload a file to the private vet-credentials bucket.
   * `upsert: false` ensures we never silently overwrite an existing document —
   * paths include the credentialId so they are already unique.
   */
  async uploadPrivate(
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<void> {
    const { error } = await this.supabase.storage
      .from(VET_CREDENTIALS_BUCKET)
      .upload(key, buffer, { contentType, upsert: false });

    if (error) {
      throw new InternalServerErrorException(
        `Storage upload failed: ${error.message}`
      );
    }
  }

  /**
   * Generate a short-lived signed URL for a private vet-credentials document.
   * @param key    Storage path (e.g. vet-credentials/{userId}/{credentialId}.pdf)
   * @param expiresIn  TTL in seconds (typically 3600)
   */
  async getSignedUrl(key: string, expiresIn: number): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(VET_CREDENTIALS_BUCKET)
      .createSignedUrl(key, expiresIn);

    if (error || !data?.signedUrl) {
      throw new InternalServerErrorException(
        `Failed to generate signed URL: ${error?.message ?? 'unknown error'}`
      );
    }

    return data.signedUrl;
  }

  /**
   * Upload a PDF to the private lab-reports bucket.
   * `upsert: false` — path includes releaseId so it is unique; never overwrites.
   */
  async uploadPdf(path: string, buffer: Buffer): Promise<void> {
    const { error } = await this.supabase.storage
      .from(PDF_BUCKET)
      .upload(path, buffer, { contentType: 'application/pdf', upsert: false });
    if (error) {
      throw new InternalServerErrorException(
        `PDF upload failed: ${error.message}`
      );
    }
  }

  /**
   * Download an object from any private bucket into a Buffer.
   */
  async downloadObject(bucket: string, path: string): Promise<Buffer> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .download(path);
    if (error || !data) {
      throw new InternalServerErrorException(
        `Failed to download ${bucket}/${path}: ${error?.message ?? 'no data'}`
      );
    }
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Return true if the object at path exists in the given bucket.
   */
  async headObject(bucket: string, path: string): Promise<boolean> {
    const { error } = await this.supabase.storage.from(bucket).download(path);
    return !error;
  }

  /**
   * Upload a release image asset (logo / signature) to the release-assets bucket.
   * Bucket must be private and created in Supabase before use.
   */
  async uploadReleaseAsset(
    path: string,
    buffer: Buffer,
    contentType: string
  ): Promise<void> {
    const { error } = await this.supabase.storage
      .from(RELEASE_ASSETS_BUCKET)
      .upload(path, buffer, { contentType, upsert: false });
    if (error) {
      throw new InternalServerErrorException(
        `Release asset upload failed: ${error.message}`
      );
    }
  }

  /**
   * Copy a logo or signature into the release-assets bucket so the PDF never
   * depends on the live image. Accepts `data:` URLs (how lab signer signatures
   * are stored) and Supabase-hosted URLs (clinic logos).
   *
   * Returns the stored path, or null when there is no image or it is not a
   * PNG/JPEG (the only formats pdfkit can embed). Upload errors are thrown.
   */
  async snapshotReleaseImage(
    releaseId: string,
    name: string,
    url: string | null
  ): Promise<string | null> {
    if (!url) return null;
    const buffer = await this.loadImage(url);
    if (!buffer) return null;

    const type = this.detectPdfImageType(buffer);
    if (!type) return null;

    const path = `${releaseId}/${name}.${type === 'jpeg' ? 'jpg' : 'png'}`;
    await this.uploadReleaseAsset(path, buffer, `image/${type}`);
    return path;
  }

  /**
   * Snapshot every image a release PDF uses. Never throws: a missing or
   * unusable image leaves its path null — the PDF then omits the logo, or
   * draws an empty signature line for manual signing — so releasing is never
   * blocked by an image problem.
   */
  async snapshotReleaseImages(
    releaseId: string,
    urls: {
      logoUrl: string | null;
      signerSignatureUrl: string | null;
      analystSignatureUrl: string | null;
    }
  ): Promise<{
    logoStoragePath: string | null;
    signerSignatureStoragePath: string | null;
    analystSignatureStoragePath: string | null;
  }> {
    const snapshot = async (name: string, url: string | null) => {
      try {
        const path = await this.snapshotReleaseImage(releaseId, name, url);
        if (url && !path) {
          this.logger.warn(
            `Release ${releaseId}: ${name} is not a usable PNG/JPEG image — omitted from PDF`
          );
        }
        return path;
      } catch (err) {
        this.logger.warn(
          `Release ${releaseId}: failed to store ${name}: ${
            err instanceof Error ? err.message : err
          }`
        );
        return null;
      }
    };

    const [
      logoStoragePath,
      signerSignatureStoragePath,
      analystSignatureStoragePath,
    ] = await Promise.all([
      snapshot('logo', urls.logoUrl),
      snapshot('signer-sig', urls.signerSignatureUrl),
      snapshot('analyst-sig', urls.analystSignatureUrl),
    ]);
    return {
      logoStoragePath,
      signerSignatureStoragePath,
      analystSignatureStoragePath,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Decode a base64 `data:` URL, or fetch a URL hosted on our Supabase project.
   * Any other host is refused to prevent arbitrary external fetches.
   */
  private async loadImage(url: string): Promise<Buffer | null> {
    if (url.startsWith('data:')) {
      const match = /^data:[^;,]*;base64,(.+)$/s.exec(url);
      return match ? Buffer.from(match[1], 'base64') : null;
    }
    if (!url.startsWith(this.supabaseUrl)) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** Identify PNG/JPEG by magic bytes — file extensions and MIME labels lie. */
  private detectPdfImageType(buffer: Buffer): 'png' | 'jpeg' | null {
    if (
      buffer.length > 8 &&
      buffer[0] === 0x89 &&
      buffer.toString('ascii', 1, 4) === 'PNG'
    ) {
      return 'png';
    }
    if (
      buffer.length > 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'jpeg';
    }
    return null;
  }

  private validateLogoFile(file: Express.Multer.File): void {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type "${file.mimetype}". Allowed types: PNG, JPEG, WebP.`
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `File too large (${(file.size / 1024 / 1024).toFixed(
          1
        )} MB). Maximum allowed size is 2 MB.`
      );
    }
  }

  private extFromMime(mime: string): string {
    const map: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    };
    return map[mime] ?? 'png';
  }
}
