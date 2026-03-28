import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { switchMap } from 'rxjs';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { AuthService } from '../../../core/services/auth.service';
import { InputComponent } from '../../../shared/components/input/input.component';
import { SelectComponent } from '../../../shared/components/select/select.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm  = group.get('confirmPassword')?.value;
  return password && confirm && password !== confirm
    ? { passwordMismatch: true }
    : null;
}

@Component({
  selector: 'app-staff-profile',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslatePipe,
    InputComponent,
    SelectComponent,
    ButtonComponent,
  ],
  templateUrl: './staff-profile.component.html',
})
export class StaffProfileComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private onboardingService = inject(OnboardingService);
  private auth = inject(AuthService);

  staffForm!: FormGroup;
  loading = signal(false);
  tenantName = signal('LabX');
  error = signal<string | null>(null);

  roleOptions = [
    { label: 'STAFF_PROFILE.ROLE_VET',   value: 'vet' },
    { label: 'STAFF_PROFILE.ROLE_TECH',  value: 'tech' },
    { label: 'STAFF_PROFILE.ROLE_ADMIN', value: 'admin' },
  ];

  ngOnInit(): void {
    const token    = this.route.snapshot.queryParamMap.get('token');
    const tenantId = this.route.snapshot.queryParamMap.get('tenantId');

    if (token && tenantId) {
      this.onboardingService.verifyMagicLink(token).subscribe({
        next: (result) => {
          this.onboardingService.initializeOnboarding(result.tenantId, token).subscribe({
            next: (branding) => this.tenantName.set(branding.tenantName),
          });
        },
        error: (err) => {
          console.error('Invalid or expired magic link:', err);
          this.router.navigate(['/']);
        },
      });
    }

    this.staffForm = this.fb.group(
      {
        fullName:        ['', [Validators.required, Validators.minLength(2)]],
        telephone:       ['', [Validators.required]],
        email:           ['', [Validators.required, Validators.email]],
        role:            ['', [Validators.required]],
        password:        ['', [Validators.required, Validators.minLength(6)]],
        confirmPassword: ['', [Validators.required]],
      },
      { validators: passwordsMatch },
    );
  }

  get passwordMismatch(): boolean {
    return (
      this.staffForm.hasError('passwordMismatch') &&
      !!this.staffForm.get('confirmPassword')?.dirty
    );
  }

  onSubmit(): void {
    if (this.staffForm.invalid) return;

    this.loading.set(true);
    this.error.set(null);

    const { email, password, fullName, telephone, role } = this.staffForm.value;

    // Create the Supabase auth account first, then save the staff profile.
    this.auth.signUp(email, password).pipe(
      switchMap(() =>
        this.onboardingService.saveStaffProfile({ fullName, telephone, email, role }),
      ),
      switchMap(() => this.onboardingService.completeOnboarding()),
    ).subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigate(['/dashboard']);
      },
      error: (err: { message?: string }) => {
        this.loading.set(false);
        this.error.set(err?.message ?? 'AUTH.ERROR_GENERIC');
      },
    });
  }
}