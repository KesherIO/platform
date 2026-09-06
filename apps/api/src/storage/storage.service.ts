import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
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

@Injectable()
export class StorageService {
  private readonly supabase: SupabaseClient;

  constructor(config: ConfigService) {
    this.supabase = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
