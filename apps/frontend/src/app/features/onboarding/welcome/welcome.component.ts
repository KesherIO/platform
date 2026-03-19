import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { LanguageService } from '../../../core/services/language.service';
import { LanguageToggleComponent } from '../../../shared/components/language-toggle/language-toggle.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe,
    LanguageToggleComponent,
    ButtonComponent,
  ],
  templateUrl: './welcome.component.html',
})
export class WelcomeComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private onboardingService = inject(OnboardingService);
  languageService = inject(LanguageService);

  tenantName = signal('LabX');
  loading = signal(false);

  ngOnInit(): void {
    const tenantId = this.route.snapshot.queryParamMap.get('tenantId');

    if (tenantId) {
      this.loading.set(true);
      this.onboardingService.initializeOnboarding(tenantId).subscribe({
        next: (branding) => {
          this.tenantName.set(branding.tenantName);
          this.loading.set(false);
        },
        error: (error) => {
          console.error('Error initializing onboarding:', error);
          this.loading.set(false);
          // TODO: Show error message
        },
      });
    }
  }

  onContinue(): void {
    this.router.navigate(['/onboarding/clinic-setup']);
  }

  onLanguageChange(language: 'en' | 'es'): void {
    this.languageService.setLanguage(language);
  }
}
