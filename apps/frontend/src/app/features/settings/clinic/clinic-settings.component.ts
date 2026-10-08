import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take, switchMap } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { TenantService } from '../../../core/services/tenant.service';
import { SettingsService } from '../../../core/services/settings.service';
import { resolveLogoUrl } from '../../../core/services/onboarding.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { OutlineButtonComponent } from '../../../shared/components/outline-button/outline-button.component';
import { COUNTRIES } from '../../../core/data/countries';

@Component({
  selector: 'app-clinic-settings',
  standalone: true,
  imports: [TranslatePipe, ButtonComponent, OutlineButtonComponent],
  templateUrl: './clinic-settings.component.html',
  styleUrl: './clinic-settings.component.scss',
})
export class ClinicSettingsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantService);
  private readonly settingsService = inject(SettingsService);

  readonly isAdmin = computed(() => {
    const membership = this.tenant.activeMembership();
    if (!membership) return false;
    return membership.role === 'ADMIN' || membership.role === 'OWNER';
  });

  readonly clinicName = computed(
    () => this.tenant.activeMembership()?.tenant.name ?? ''
  );
  readonly clinicEmail = computed(
    () => this.tenant.activeMembership()?.tenant.email ?? ''
  );
  readonly clinicPhone = computed(
    () => this.tenant.activeMembership()?.tenant.phone ?? ''
  );
  readonly clinicAddress = computed(
    () => this.tenant.activeMembership()?.tenant.address ?? ''
  );
  readonly clinicContactName = computed(
    () => this.tenant.activeMembership()?.tenant.primaryContactName ?? ''
  );
  readonly clinicCity = computed(
    () => this.tenant.activeMembership()?.tenant.city ?? ''
  );
  readonly clinicCountry = computed(
    () => this.tenant.activeMembership()?.tenant.country ?? ''
  );
  /** i18n key for the clinic's country, or null when unknown/not set */
  readonly clinicCountryLabel = computed(
    () => COUNTRIES.find((c) => c.value === this.clinicCountry())?.label ?? null
  );
  readonly countryOptions = COUNTRIES;
  readonly clinicLogoUrl = computed(() =>
    resolveLogoUrl(this.tenant.activeMembership()?.tenant.logoUrl)
  );

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly editName = signal('');
  readonly editPhone = signal('');
  readonly editAddress = signal('');
  readonly editContactName = signal('');
  readonly editCity = signal('');
  readonly editCountry = signal('');
  private readonly logoFile = signal<File | null>(null);
  readonly logoPreview = signal<string | null>(null);

  /**
   * The clinic profile is shared with the lab portal, which can edit it too —
   * reload it whenever this screen opens instead of relying on login-time data.
   */
  ngOnInit(): void {
    this.auth
      .loadMe()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: (err: HttpErrorResponse) =>
          console.error('[ClinicSettings] refresh failed', err.status),
      });
  }

  startEditing(): void {
    this.editName.set(this.clinicName());
    this.editPhone.set(this.clinicPhone());
    this.editAddress.set(this.clinicAddress());
    this.editContactName.set(this.clinicContactName());
    this.editCity.set(this.clinicCity());
    this.editCountry.set(this.clinicCountry());
    this.logoFile.set(null);
    this.logoPreview.set(null);
    this.saveError.set(null);
    this.editing.set(true);
  }

  cancelEditing(): void {
    this.editing.set(false);
  }

  onLogoFileChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.logoFile.set(file);
    const reader = new FileReader();
    reader.onload = (e) => this.logoPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  save(): void {
    this.saving.set(true);
    this.saveError.set(null);
    this.settingsService
      .updateClinic(
        {
          name: this.editName(),
          phone: this.editPhone(),
          address: this.editAddress(),
          primaryContactName: this.editContactName(),
          city: this.editCity(),
          country: this.editCountry(),
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
        error: (err: HttpErrorResponse) => {
          console.error('[ClinicSettings] save failed', err.status, err.error);
          this.saveError.set(`${err.status}: ${err.message}`);
          this.saving.set(false);
        },
      });
  }
}
