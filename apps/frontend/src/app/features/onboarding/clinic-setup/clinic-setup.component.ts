import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { LanguageService } from '../../../core/services/language.service';
import { BrandingFooterComponent } from '../../../shared/components/branding-footer/branding-footer.component';
import { InputComponent } from '../../../shared/components/input/input.component';
import { SelectComponent } from '../../../shared/components/select/select.component';
import { ToggleComponent } from '../../../shared/components/toggle/toggle.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { LogoUploadComponent } from '../../../shared/components/logo-upload/logo-upload.component';
import { COUNTRIES } from '../../../core/data/countries';

@Component({
  selector: 'app-clinic-setup',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    BrandingFooterComponent,
    InputComponent,
    SelectComponent,
    ToggleComponent,
    ButtonComponent,
    LogoUploadComponent,
  ],
  templateUrl: './clinic-setup.component.html',
  styleUrls: ['./clinic-setup.component.scss'],
})
export class ClinicSetupComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private onboardingService = inject(OnboardingService);
  private languageService = inject(LanguageService);

  clinicForm!: FormGroup;

  /** Clinic contact email from Biomet token — read-only, not in the form */
  prefillClinicEmail = signal('');

  /** Logo file held in memory — uploaded as part of onSubmit, not on file select */
  pendingLogoFile = signal<File | null>(null);
  uploading = signal(false);

  /** Local object URL for preview — derived from pendingLogoFile, no upload needed */
  logoPreviewUrl = computed(() => {
    const file = this.pendingLogoFile();
    return file ? URL.createObjectURL(file) : null;
  });

  /** ISO 3166-1 alpha-2 country options for the dropdown.
   *  The label is an i18n key; app-select translates it internally. */
  readonly countryOptions = COUNTRIES;

  notificationOptions = [
    { label: 'CLINIC_SETUP.NOTIFICATION_EMAIL', value: 'email' },
    { label: 'CLINIC_SETUP.NOTIFICATION_SMS', value: 'sms' },
  ];

  ngOnInit(): void {
    const state = this.onboardingService.getOnboardingState()();
    // Prefill clinic name from token verify response (editable by user)
    const prefillName = state.prefillClinicName ?? '';
    // Clinic email is read-only — shown in the template, not part of the form
    this.prefillClinicEmail.set(state.prefillClinicEmail ?? '');
    // Restore previously entered data if user navigates back
    const saved = state.clinic;

    // Restore pending logo file so preview shows after back navigation
    if (saved?.pendingLogoFile) {
      this.pendingLogoFile.set(saved.pendingLogoFile);
    }

    this.clinicForm = this.fb.group({
      name:               [saved?.name ?? prefillName, [Validators.required, Validators.minLength(2)]],
      address:            [saved?.address ?? '', [Validators.required]],
      city:               [saved?.city ?? '', [Validators.required]],
      telephone:          [saved?.telephone ?? '', [Validators.required]],
      notificationMethod: [saved?.notificationMethod ?? 'email', [Validators.required]],
      country:            [saved?.country ?? (this.languageService.currentLang() === 'es' ? 'CO' : '')],
    });
  }

  onLogoSelected(file: File): void {
    // Hold the file in memory — no upload yet, no storage garbage on abandonment
    this.pendingLogoFile.set(file);
  }

  onBack(): void {
    // Persist current form values and pending logo so data is not lost on return
    this.onboardingService.storeClinicSetupDraft({
      ...this.clinicForm.value,
      pendingLogoFile: this.pendingLogoFile() ?? undefined,
    });
    this.router.navigate(['/onboarding/welcome']);
  }

  onSubmit(): void {
    if (this.clinicForm.invalid) return;

    // Store clinic data locally (including the pending file reference).
    // The actual upload happens in admin-profile when POST /onboarding/complete is called.
    this.onboardingService.storeClinicSetup({
      ...this.clinicForm.value,
      pendingLogoFile: this.pendingLogoFile() ?? undefined,
    });
    this.router.navigate(['/onboarding/admin-profile']);
  }
}