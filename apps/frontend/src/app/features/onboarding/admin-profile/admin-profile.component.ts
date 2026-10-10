import { Component, OnInit, signal, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { AuthService } from '../../../core/services/auth.service';
import { TenantService } from '../../../core/services/tenant.service';
import { InputComponent } from '../../../shared/components/input/input.component';
import { PrimaryButtonComponent } from '../../../shared/components/primary-button/primary-button.component';
import { OutlineButtonComponent } from '../../../shared/components/outline-button/outline-button.component';
import { AuthBrandingComponent } from '../../../shared/components/auth-branding/auth-branding.component';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return password && confirm && password !== confirm
    ? { passwordMismatch: true }
    : null;
}

type ClinicDetailField =
  | 'clinicName'
  | 'clinicEmail'
  | 'clinicAddress'
  | 'clinicCity'
  | 'clinicPhone'
  | 'country'
  | 'primaryContactName';

/**
 * A clinic field is sent only when it differs from the value already on
 * record, so every detail the lab entered (name, email, phone, address, city,
 * country, contact) is kept unless the admin changes it. Sending '' tells the
 * API to clear an optional field. With nothing on record (platform
 * invitations) every non-empty field is sent, as before.
 */
function changed<K extends ClinicDetailField>(
  key: K,
  value: string | undefined,
  onRecord: string | null | undefined
): Partial<Record<K, string>> {
  const current = (value ?? '').trim();
  if (current === (onRecord ?? '').trim()) return {};
  return { [key]: current } as Partial<Record<K, string>>;
}

@Component({
  selector: 'app-admin-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputComponent,
    PrimaryButtonComponent,
    OutlineButtonComponent,
    AuthBrandingComponent,
  ],
  templateUrl: './admin-profile.component.html',
})
export class AdminProfileComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private onboardingService = inject(OnboardingService);
  private authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  profileForm!: FormGroup;
  loading = signal(false);
  /** true after POST /onboarding/complete succeeds — shows the success screen */
  completed = signal(false);
  error = signal<string | null>(null);
  /** non-null when account was created but logo upload failed */
  logoUploadWarning = signal<string | null>(null);
  /** When the admin is also a vet and needs credential submission */
  vetProfileRequired = signal(false);

  /**
   * true when the admin email already has an account: the API only lets the
   * owner join this clinic, so they must sign in with their current password.
   */
  signInRequired = signal(false);
  signingIn = signal(false);
  signInError = signal<string | null>(null);
  resetSent = signal(false);
  signInPassword = this.fb.nonNullable.control('', Validators.required);

  private clinicEmail = '';
  private clinicPhone = '';

  ngOnInit(): void {
    const state = this.onboardingService.getOnboardingState()();
    const saved = state.adminProfileDraft;

    this.clinicEmail = state.clinic?.email ?? '';
    this.clinicPhone = state.clinic?.telephone ?? '';

    this.profileForm = this.fb.group(
      {
        isVet: [saved?.isVet ?? false],
        useClinicData: [false],
        firstName: [
          saved?.firstName ?? '',
          [Validators.required, Validators.minLength(2)],
        ],
        lastName: [
          saved?.lastName ?? '',
          [Validators.required, Validators.minLength(2)],
        ],
        email: [saved?.email ?? '', [Validators.required, Validators.email]],
        telephone: [saved?.telephone ?? ''],
        password: ['', [Validators.required, Validators.minLength(10)]],
        confirmPassword: ['', [Validators.required]],
      },
      { validators: passwordsMatch }
    );

    this.profileForm
      .get('useClinicData')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((use: boolean) => {
        if (use) {
          this.profileForm.patchValue({
            email: this.clinicEmail,
            telephone: this.clinicPhone,
          });
        }
      });
  }

  onBack(): void {
    // Save current form values (excluding passwords) so they're restored if user returns
    const { firstName, lastName, email, telephone, isVet } =
      this.profileForm.value;
    this.onboardingService.storeAdminProfileDraft({
      firstName,
      lastName,
      email,
      telephone,
      isVet,
    });
    this.router.navigate(['/onboarding/clinic-setup']);
  }

  get passwordMismatch(): boolean {
    return (
      this.profileForm.hasError('passwordMismatch') &&
      !!this.profileForm.get('confirmPassword')?.dirty
    );
  }

  onSave(): void {
    if (this.profileForm.invalid) return;

    const state = this.onboardingService.getOnboardingState()();
    const token = state.onboardingToken;
    const clinic = state.clinic;

    if (!token) {
      this.error.set(
        'No onboarding token found. Please use the link from your invitation email.'
      );
      return;
    }

    if (!clinic) {
      this.error.set(
        'Clinic setup data is missing. Please go back and complete the clinic setup step.'
      );
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    const {
      firstName,
      lastName,
      email: adminEmail,
      telephone,
      password,
      isVet,
    } = this.profileForm.value;

    const onRecord = state.prefillClinic;
    const payload = {
      token,
      adminFirstName: firstName,
      adminLastName: lastName,
      adminEmail,
      password,
      ...(telephone ? { adminPhone: telephone } : {}),
      ...changed('clinicName', clinic.name, onRecord?.name),
      ...changed('clinicEmail', clinic.email, onRecord?.email),
      ...changed('clinicAddress', clinic.address, onRecord?.address),
      ...changed('clinicCity', clinic.city, onRecord?.city),
      ...changed('clinicPhone', clinic.telephone, onRecord?.phone),
      notificationMethod: clinic.notificationMethod,
      ...changed('country', clinic.country, onRecord?.country),
      ...changed(
        'primaryContactName',
        clinic.primaryContactName,
        onRecord?.primaryContactName
      ),
      ...(isVet ? { isVet: true } : {}),
    };

    this.onboardingService
      .completeAdminOnboarding(payload, clinic.pendingLogoFile)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          if (res.logoUploadFailed) {
            this.logoUploadWarning.set(
              res.message ?? 'ADMIN_PROFILE.LOGO_UPLOAD_FAILED'
            );
          }
          TenantService.savePreference(res.userId, res.tenantId);
          if (
            res.membershipStatus === 'PROFILE_REQUIRED' ||
            res.membershipStatus === 'VERIFICATION_PENDING'
          ) {
            this.vetProfileRequired.set(true);
          }
          this.completed.set(true);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          if (
            err instanceof HttpErrorResponse &&
            err.status === 409 &&
            err.error?.code === 'SIGN_IN_REQUIRED'
          ) {
            this.signInRequired.set(true);
            return;
          }
          this.error.set(
            (err as { message?: string })?.message ?? 'AUTH.ERROR_GENERIC'
          );
        },
      });
  }

  /** Signs in as the existing account, then submits the same form again. */
  onSignInAndContinue(): void {
    if (this.signInPassword.invalid) return;

    this.signingIn.set(true);
    this.signInError.set(null);
    this.authService
      .signInForOnboarding(
        this.profileForm.value.email,
        this.signInPassword.value
      )
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.signingIn.set(false);
          this.signInRequired.set(false);
          this.signInPassword.reset();
          this.onSave();
        },
        error: () => {
          this.signingIn.set(false);
          this.signInError.set('ADMIN_PROFILE.SIGN_IN_FAILED');
        },
      });
  }

  onForgotPassword(): void {
    this.authService
      .resetPassword(this.profileForm.value.email)
      .pipe(take(1))
      .subscribe({
        next: () => this.resetSent.set(true),
        error: () => this.signInError.set('AUTH.ERROR_GENERIC'),
      });
  }

  onUseDifferentEmail(): void {
    this.signInRequired.set(false);
    this.signInError.set(null);
    this.resetSent.set(false);
    this.signInPassword.reset();
  }

  onGoToSignIn(): void {
    // Sign out any stale Supabase session before going to login,
    // so the noAuthGuard doesn't try to verify an invalid token.
    if (this.authService.isLoggedIn()) {
      this.authService
        .signOut()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          complete: () => this.router.navigate(['/auth/login']),
        });
    } else {
      this.router.navigate(['/auth/login']);
    }
  }
}
