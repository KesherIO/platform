import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { InputComponent } from '../../../shared/components/input/input.component';
import { SelectComponent } from '../../../shared/components/select/select.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';

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

  staffForm!: FormGroup;
  loading = signal(false);
  tenantName = signal('LabX');

  roleOptions = [
    { label: 'STAFF_PROFILE.ROLE_VET', value: 'vet' },
    { label: 'STAFF_PROFILE.ROLE_TECH', value: 'tech' },
    { label: 'STAFF_PROFILE.ROLE_ADMIN', value: 'admin' },
  ];

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    const tenantId = this.route.snapshot.queryParamMap.get('tenantId');

    if (token && tenantId) {
      this.onboardingService.verifyMagicLink(token).subscribe({
        next: (result) => {
          this.onboardingService.initializeOnboarding(result.tenantId, token).subscribe({
            next: (branding) => {
              this.tenantName.set(branding.tenantName);
            },
          });
        },
        error: (error) => {
          console.error('Invalid or expired magic link:', error);
          // TODO: Show error message and redirect
          this.router.navigate(['/']);
        },
      });
    }

    this.staffForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      telephone: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      role: ['', [Validators.required]],
    });
  }

  onSubmit(): void {
    if (this.staffForm.valid) {
      this.loading.set(true);

      const profileData = this.staffForm.value;

      this.onboardingService.saveStaffProfile(profileData).subscribe({
        next: () => {
          this.loading.set(false);
          this.onboardingService.completeOnboarding().subscribe({
            next: () => {
              this.router.navigate(['/cases']);
            },
          });
        },
        error: (error) => {
          console.error('Error saving staff profile:', error);
          this.loading.set(false);
          // TODO: Show error message
        },
      });
    }
  }
}
