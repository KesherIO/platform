import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { BrandingFooterComponent } from '../../../shared/components/branding-footer/branding-footer.component';
import { InputComponent } from '../../../shared/components/input/input.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { Clipboard } from '@angular/cdk/clipboard';

@Component({
  selector: 'app-admin-profile',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslatePipe,
    BrandingFooterComponent,
    InputComponent,
    ButtonComponent,
  ],
  templateUrl: './admin-profile.component.html',
})
export class AdminProfileComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private onboardingService = inject(OnboardingService);
  private clipboard = inject(Clipboard);

  profileForm!: FormGroup;
  loading = signal(false);
  profileSaved = signal(false);
  showInviteSection = signal(false);
  generatingLink = signal(false);
  magicLink = signal('');
  copied = signal(false);
  tenantName = signal('LabX');

  ngOnInit(): void {
    this.profileForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      telephone: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
    });

    // In production, fetch from branding service
    this.tenantName.set('LabX');
  }

  onSave(): void {
    if (this.profileForm.valid) {
      this.loading.set(true);

      const profileData = {
        ...this.profileForm.value,
        role: 'admin' as const,
      };

      this.onboardingService.saveAdminProfile(profileData).subscribe({
        next: () => {
          this.loading.set(false);
          this.profileSaved.set(true);
          this.showInviteSection.set(true);
        },
        error: (error) => {
          console.error('Error saving admin profile:', error);
          this.loading.set(false);
          // TODO: Show error message
        },
      });
    }
  }

  onCreateMagicLink(): void {
    this.generatingLink.set(true);

    this.onboardingService.generateMagicLink().subscribe({
      next: (invite) => {
        const baseUrl = window.location.origin;
        const link = `${baseUrl}/onboarding/staff?token=${invite.token}&tenantId=${invite.tenantId}`;
        this.magicLink.set(link);
        this.generatingLink.set(false);
      },
      error: (error) => {
        console.error('Error generating magic link:', error);
        this.generatingLink.set(false);
        // TODO: Show error message
      },
    });
  }

  copyToClipboard(): void {
    const success = this.clipboard.copy(this.magicLink());
    if (success) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  onEnterApp(): void {
    this.onboardingService.completeOnboarding().subscribe({
      next: () => {
        this.router.navigate(['/cases']);
      },
      error: (error) => {
        console.error('Error completing onboarding:', error);
        // TODO: Show error message
      },
    });
  }
}
