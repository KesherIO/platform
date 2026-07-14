import { Component, OnInit, signal, inject, DestroyRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  FormBuilder,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { InputComponent } from '../../../shared/components/input/input.component';
import { PrimaryButtonComponent } from '../../../shared/components/primary-button/primary-button.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const pw = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return pw && confirm && pw !== confirm ? { passwordMismatch: true } : null;
}

@Component({
  selector: 'app-staff-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputComponent,
    PrimaryButtonComponent,
  ],
  templateUrl: './staff-profile.component.html',
})
export class StaffProfileComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly onboardingService = inject(OnboardingService);
  private readonly destroyRef = inject(DestroyRef);
  readonly view = signal<'loading' | 'new-user' | 'existing-user' | 'error'>(
    'loading'
  );
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly tenantName = signal('');
  readonly inviteEmail = signal('');

  /** True when the invite is a generic link (no email pre-assigned). */
  readonly emailEditable = signal(false);

  private inviteToken = '';
  private inviteRole: 'admin' | 'staff' = 'staff';

  /** Form shown to users who don't have an account yet. */
  readonly newUserForm = this.fb.group(
    {
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(10)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordsMatch }
  );

  get passwordMismatch(): boolean {
    return (
      this.newUserForm.hasError('passwordMismatch') &&
      !!this.newUserForm.get('confirmPassword')?.dirty
    );
  }

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');

    if (!token) {
      this.view.set('error');
      return;
    }

    this.inviteToken = token;

    this.onboardingService
      .verifyMagicLink(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.tenantName.set(result.tenantName);
          this.inviteEmail.set(result.email);
          this.inviteRole = result.role;

          if (result.email) {
            // Email-specific invite: pre-fill and lock the email field.
            this.newUserForm.get('email')?.setValue(result.email);
            this.newUserForm.get('email')?.disable();
            this.emailEditable.set(false);
          } else {
            // Generic invite: user must enter their own email.
            this.emailEditable.set(true);
          }

          this.view.set(result.userExists ? 'existing-user' : 'new-user');
        },
        error: () => this.view.set('error'),
      });
  }

  /** New user — create account and redirect to login. */
  createAccount(): void {
    if (this.newUserForm.invalid) return;

    this.loading.set(true);
    this.error.set(null);

    const { firstName, lastName, email, password } =
      this.newUserForm.getRawValue();
    const fullName = `${firstName} ${lastName}`.trim();
    const resolvedEmail = this.inviteEmail() || email!;

    this.onboardingService
      .completeStaffOnboarding({
        token: this.inviteToken,
        fullName,
        email: resolvedEmail,
        password: password!,
        role: this.inviteRole,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.router.navigate(['/auth/login']);
        },
        error: (err: { message?: string }) => {
          this.loading.set(false);
          this.error.set(err?.message ?? 'AUTH.ERROR_GENERIC');
        },
      });
  }

  /** Existing user — create membership only and redirect to login. */
  joinClinic(): void {
    this.loading.set(true);
    this.error.set(null);

    this.onboardingService
      .completeStaffOnboarding({
        token: this.inviteToken,
        email: this.inviteEmail(),
        role: this.inviteRole,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.router.navigate(['/auth/login']);
        },
        error: (err: { message?: string }) => {
          this.loading.set(false);
          this.error.set(err?.message ?? 'AUTH.ERROR_GENERIC');
        },
      });
  }
}
