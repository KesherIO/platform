import { Component, computed, inject, signal } from '@angular/core';
import { take, switchMap } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { resolveLogoUrl } from '../../../core/services/onboarding.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { OutlineButtonComponent } from '../../../shared/components/outline-button/outline-button.component';

@Component({
  selector: 'app-clinic-settings',
  standalone: true,
  imports: [TranslatePipe, ButtonComponent, OutlineButtonComponent],
  templateUrl: './clinic-settings.component.html',
  styleUrl: './clinic-settings.component.scss',
})
export class ClinicSettingsComponent {
  private readonly auth = inject(AuthService);
  private readonly settingsService = inject(SettingsService);

  readonly isAdmin = computed(() => {
    const me = this.auth.me();
    if (!me) return false;
    const activeTenantId = me.activeTenantId ?? me.tenants[0]?.id;
    return me.memberships.some(
      (m) =>
        m.tenant.id === activeTenantId &&
        (m.role === 'ADMIN' || m.role === 'OWNER')
    );
  });

  readonly clinicName = computed(() => this.auth.me()?.tenants[0]?.name ?? '');
  readonly clinicEmail = computed(
    () => this.auth.me()?.tenants[0]?.email ?? ''
  );
  readonly clinicPhone = computed(
    () => this.auth.me()?.tenants[0]?.phone ?? ''
  );
  readonly clinicAddress = computed(
    () => this.auth.me()?.tenants[0]?.address ?? ''
  );
  readonly clinicLogoUrl = computed(() =>
    resolveLogoUrl(this.auth.me()?.tenants[0]?.logoUrl)
  );

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly editName = signal('');
  readonly editPhone = signal('');
  readonly editAddress = signal('');
  private readonly logoFile = signal<File | null>(null);
  readonly logoPreview = signal<string | null>(null);

  startEditing(): void {
    this.editName.set(this.clinicName());
    this.editPhone.set(this.clinicPhone());
    this.editAddress.set(this.clinicAddress());
    this.logoFile.set(null);
    this.logoPreview.set(null);
    this.editing.set(true);
  }

  cancelEditing(): void {
    this.editing.set(false);
  }

  onLogoFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.logoFile.set(file);
    this.logoPreview.set(URL.createObjectURL(file));
  }

  save(): void {
    this.saving.set(true);
    this.settingsService
      .updateClinic(
        {
          name: this.editName(),
          phone: this.editPhone(),
          address: this.editAddress(),
        },
        this.logoFile() ?? undefined
      )
      .pipe(
        take(1),
        switchMap(() => this.auth.loadMe())
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editing.set(false);
        },
        error: () => this.saving.set(false),
      });
  }
}
