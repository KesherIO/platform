import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { BrandingFooterComponent } from '../../../shared/components/branding-footer/branding-footer.component';
import { InputComponent } from '../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../shared/components/toggle/toggle.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';

@Component({
  selector: 'app-clinic-setup',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslatePipe,
    BrandingFooterComponent,
    InputComponent,
    ToggleComponent,
    ButtonComponent,
  ],
  templateUrl: './clinic-setup.component.html',
})
export class ClinicSetupComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private onboardingService = inject(OnboardingService);

  clinicForm!: FormGroup;
  loading = signal(false);

  notificationOptions = [
    { label: 'CLINIC_SETUP.NOTIFICATION_EMAIL', value: 'email' },
    { label: 'CLINIC_SETUP.NOTIFICATION_SMS', value: 'sms' },
  ];

  ngOnInit(): void {
    this.clinicForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      address: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      telephone: ['', [Validators.required]],
      notificationMethod: ['email', [Validators.required]],
    });
  }

  onSubmit(): void {
    if (this.clinicForm.valid) {
      this.loading.set(true);

      const clinicData = this.clinicForm.value;
      const state = this.onboardingService.getOnboardingState()();

      this.onboardingService
        .saveClinicSetup({
          ...clinicData,
          tenantId: state.tenantId,
        })
        .subscribe({
          next: () => {
            this.loading.set(false);
            this.router.navigate(['/onboarding/admin-profile']);
          },
          error: (error) => {
            console.error('Error saving clinic setup:', error);
            this.loading.set(false);
            // TODO: Show error message
          },
        });
    }
  }
}
