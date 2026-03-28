import {
  Component,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { DEFAULT_LOGO_URL } from '../../../core/services/onboarding.service';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

@Component({
  selector: 'app-logo-upload',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './logo-upload.component.html',
  styleUrl: './logo-upload.component.scss',
})
export class LogoUploadComponent {
  /** Current logo URL (from a previous upload or the tenant branding). */
  currentLogoUrl = input<string | null | undefined>(null);

  /** Emitted with the selected File when the user picks a valid image. */
  fileSelected = output<File>();

  /** Emitted with a user-facing error key when validation fails. */
  uploadError = output<string>();

  uploading = input(false);

  /** Preview URL for the locally selected file (before it is uploaded). */
  previewUrl = signal<string | null>(null);

  validationError = signal<string | null>(null);

  /** Resolved display URL: local preview > server logo > default icon */
  displayUrl = computed(() =>
    this.previewUrl() ?? this.currentLogoUrl() ?? DEFAULT_LOGO_URL,
  );

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    this.validationError.set(null);

    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      const error = 'CLINIC_SETUP.LOGO_TYPE_ERROR';
      this.validationError.set(error);
      this.uploadError.emit(error);
      return;
    }

    if (file.size > MAX_SIZE_BYTES) {
      const error = 'CLINIC_SETUP.LOGO_SIZE_ERROR';
      this.validationError.set(error);
      this.uploadError.emit(error);
      return;
    }

    // Set local preview immediately
    const reader = new FileReader();
    reader.onload = (e) => this.previewUrl.set(e.target?.result as string);
    reader.readAsDataURL(file);

    this.fileSelected.emit(file);
  }
}