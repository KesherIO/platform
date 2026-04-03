import { Component, OnInit, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
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
import { BrandingFooterComponent } from '../../../shared/components/branding-footer/branding-footer.component';
import { InputComponent } from '../../../shared/components/input/input.component';
import { PrimaryButtonComponent } from '../../../shared/components/primary-button/primary-button.component';
import { OutlineButtonComponent } from '../../../shared/components/outline-button/outline-button.component';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm  = group.get('confirmPassword')?.value;
  return password && confirm && password !== confirm
    ? { passwordMismatch: true }
    : null;
}

@Component({
  selector: 'app-admin-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    BrandingFooterComponent,
    InputComponent,
    PrimaryButtonComponent,
    OutlineButtonComponent,
  ],
  templateUrl: './admin-profile.component.html',
})
export class AdminProfileComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private onboardingService = inject(OnboardingService);
  private authService = inject(AuthService);

  profileForm!: FormGroup;
  loading = signal(false);
  /** true after POST /onboarding/complete succeeds — shows the success screen */
  completed = signal(false);
  error = signal<string | null>(null);
  /** non-null when account was created but logo upload failed */
  logoUploadWarning = signal<string | null>(null);

  ngOnInit(): void {
    // Restore previously entered data if user navigates back from a later step
    const saved = this.onboardingService.getOnboardingState()().adminProfileDraft;

    this.profileForm = this.fb.group(
      {
        firstName:       [saved?.firstName ?? '', [Validators.required, Validators.minLength(2)]],
        lastName:        [saved?.lastName ?? '', [Validators.required, Validators.minLength(2)]],
        email:           [saved?.email ?? '', [Validators.required, Validators.email]],
        telephone:       [saved?.telephone ?? ''],
        password:        ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', [Validators.required]],
      },
      { validators: passwordsMatch },
    );
  }

  onBack(): void {
    // Save current form values (excluding passwords) so they're restored if user returns
    const { firstName, lastName, email, telephone } = this.profileForm.value;
    this.onboardingService.storeAdminProfileDraft({ firstName, lastName, email, telephone });
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
      this.error.set('No onboarding token found. Please use the link from your invitation email.');
      return;
    }

    if (!clinic) {
      this.error.set('Clinic setup data is missing. Please go back and complete the clinic setup step.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    const { firstName, lastName, email: adminEmail, telephone, password } = this.profileForm.value;

    const payload = {
      token,
      adminFirstName: firstName,
      adminLastName: lastName,
      adminEmail,
      password,
      ...(telephone ? { adminPhone: telephone } : {}),
      clinicName: clinic.name,
      clinicAddress: clinic.address,
      clinicCity: clinic.city,
      clinicEmail: clinic.email,
      clinicPhone: clinic.telephone,
      notificationMethod: clinic.notificationMethod,
      ...(clinic.country ? { country: clinic.country } : {}),
    };

    this.onboardingService.completeAdminOnboarding(payload, clinic.pendingLogoFile).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res.logoUploadFailed) {
          this.logoUploadWarning.set(res.message ?? 'ADMIN_PROFILE.LOGO_UPLOAD_FAILED');
        }
        this.completed.set(true);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set((err as { message?: string })?.message ?? 'AUTH.ERROR_GENERIC');
      },
    });
  }

  onGoToSignIn(): void {
    // Sign out any stale Supabase session before going to login,
    // so the noAuthGuard doesn't try to verify an invalid token.
    if (this.authService.isLoggedIn()) {
      this.authService.signOut().subscribe({
        complete: () => this.router.navigate(['/auth/login']),
      });
    } else {
      this.router.navigate(['/auth/login']);
    }
  }
}