import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  signal,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { LanguageService } from '../../../core/services/language.service';
import { InputComponent } from '../../../shared/components/input/input.component';
import { SelectComponent } from '../../../shared/components/select/select.component';
import { ToggleComponent } from '../../../shared/components/toggle/toggle.component';
import { PrimaryButtonComponent } from '../../../shared/components/primary-button/primary-button.component';
import { OutlineButtonComponent } from '../../../shared/components/outline-button/outline-button.component';
import { LogoUploadComponent } from '../../../shared/components/logo-upload/logo-upload.component';
import { AuthBrandingComponent } from '../../../shared/components/auth-branding/auth-branding.component';
import { COUNTRIES } from '../../../core/data/countries';
import {
  isTaxIdIncomplete,
  taxIdTypeForCountry,
  taxIdTypeOptions,
} from '../../../core/data/tax-id-types';

/** An ID number needs a country and an ID type — the API rejects it otherwise. */
function taxIdCompleteValidator(
  group: AbstractControl
): ValidationErrors | null {
  const { country, taxIdType, taxId } = group.value;
  return isTaxIdIncomplete(country, taxIdType, taxId)
    ? { taxIdIncomplete: true }
    : null;
}

@Component({
  selector: 'app-clinic-setup',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputComponent,
    SelectComponent,
    ToggleComponent,
    PrimaryButtonComponent,
    OutlineButtonComponent,
    LogoUploadComponent,
    AuthBrandingComponent,
  ],
  templateUrl: './clinic-setup.component.html',
  styleUrls: ['./clinic-setup.component.scss'],
})
export class ClinicSetupComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private onboardingService = inject(OnboardingService);
  private languageService = inject(LanguageService);
  private destroyRef = inject(DestroyRef);

  clinicForm!: FormGroup;

  /** Clinic contact email from Platform token — read-only, not in the form */
  prefillClinicEmail = signal('');

  /** Logo file held in memory — uploaded as part of onSubmit, not on file select */
  pendingLogoFile = signal<File | null>(null);
  uploading = signal(false);

  /** Local data URL for preview — set via FileReader to avoid blob URL lifetime issues */
  logoPreviewUrl = signal<string | null>(null);

  /** ISO 3166-1 alpha-2 country options for the dropdown.
   *  The label is an i18n key; app-select translates it internally. */
  readonly countryOptions = COUNTRIES;

  /** Country picked in the form — the ID type options depend on it */
  private readonly country = signal('');

  /** ID types of the picked country, plus 'OTHER' and a way to clear it */
  readonly taxIdTypeOptions = computed(() => [
    { label: 'CLINIC_SETUP.TAX_ID_TYPE_NONE', value: '' },
    ...taxIdTypeOptions(this.country()),
  ]);

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
    // Details the lab already entered for this clinic (lab-created clients)
    const onRecord = state.prefillClinic;

    // Restore pending logo file and preview after back navigation
    if (saved?.pendingLogoFile) {
      this.pendingLogoFile.set(saved.pendingLogoFile);
      const reader = new FileReader();
      reader.onload = (e) =>
        this.logoPreviewUrl.set(e.target?.result as string);
      reader.readAsDataURL(saved.pendingLogoFile);
    }

    this.clinicForm = this.fb.group({
      name: [
        saved?.name ?? prefillName,
        [Validators.required, Validators.minLength(2)],
      ],
      primaryContactName: [
        saved?.primaryContactName ?? onRecord?.primaryContactName ?? '',
      ],
      address: [
        saved?.address ?? onRecord?.address ?? '',
        [Validators.required],
      ],
      city: [saved?.city ?? onRecord?.city ?? '', [Validators.required]],
      telephone: [
        saved?.telephone ?? onRecord?.phone ?? '',
        [Validators.required],
      ],
      notificationMethod: [
        saved?.notificationMethod ?? 'email',
        [Validators.required],
      ],
      country: [
        saved?.country ??
          onRecord?.country ??
          (this.languageService.currentLang() === 'es' ? 'CO' : ''),
      ],
      legalName: [saved?.legalName ?? onRecord?.legalName ?? ''],
      taxIdType: [saved?.taxIdType ?? onRecord?.taxIdType ?? ''],
      taxId: [saved?.taxId ?? onRecord?.taxId ?? ''],
    });
    this.clinicForm.addValidators(taxIdCompleteValidator);
    this.clinicForm.updateValueAndValidity();

    const countryControl = this.clinicForm.controls['country'];
    this.country.set(countryControl.value ?? '');
    countryControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((country: string) => {
        this.country.set(country ?? '');
        // An ID type of the previous country doesn't apply to the new one.
        const taxIdType = this.clinicForm.controls['taxIdType'];
        const kept = taxIdTypeForCountry(taxIdType.value, country);
        if (kept !== taxIdType.value) taxIdType.setValue(kept);
      });
  }

  onLogoSelected(file: File): void {
    this.pendingLogoFile.set(file);
    const reader = new FileReader();
    reader.onload = (e) => this.logoPreviewUrl.set(e.target?.result as string);
    reader.readAsDataURL(file);
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
