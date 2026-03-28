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

@Injectable()
export class StorageService {
  private readonly supabase: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    this.supabase = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      // Use the service-role key for server-side storage operations (bypasses RLS)
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
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
    file: Express.Multer.File,
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
        `Storage upload failed: ${error.message}`,
      );
    }

    const { data } = this.supabase.storage
      .from(LOGO_BUCKET)
      .getPublicUrl(path);

    return data.publicUrl;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private validateLogoFile(file: Express.Multer.File): void {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type "${file.mimetype}". Allowed types: PNG, JPEG, WebP.`,
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 2 MB.`,
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