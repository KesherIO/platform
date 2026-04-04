import { Component, OnInit, signal, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { OnboardingService } from '../../../core/services/onboarding.service';
import { LanguageService } from '../../../core/services/language.service';
import { LanguageToggleComponent } from '../../../shared/components/language-toggle/language-toggle.component';
import { PrimaryButtonComponent } from '../../../shared/components/primary-button/primary-button.component';

type TokenErrorReason = 'expired' | 'used' | 'not_found' | 'no_token' | 'network';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [
    TranslatePipe,
    LanguageToggleComponent,
    PrimaryButtonComponent,
  ],
  templateUrl: './welcome.component.html',
})
export class WelcomeComponent implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private onboardingService = inject(OnboardingService);
  private readonly destroyRef = inject(DestroyRef);
  languageService = inject(LanguageService);

  /** true while the verify API call is in flight */
  loading = signal(true);

  /** null = token valid and flow started; non-null = show error screen */
  errorReason = signal<TokenErrorReason | null>(null);

  /** Clinic name returned from the verify response — shown on the welcome screen */
  clinicName = signal('');

  ngOnInit(): void {
    const state = this.onboardingService.getOnboardingState()();

    // If we're returning via the back button, the token is already verified and
    // stored in state — skip the API call and show the welcome screen directly.
    if (state.onboardingToken && state.prefillClinicName) {
      this.clinicName.set(state.prefillClinicName);
      this.loading.set(false);
      return;
    }

    const token = this.route.snapshot.queryParamMap.get('token');

    if (!token) {
      this.loading.set(false);
      this.errorReason.set('no_token');
      return;
    }

    this.onboardingService.verifyOnboardingToken(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.loading.set(false);
          if (response.valid) {
            this.clinicName.set(response.clinicName);
            // State (onboardingToken, prefillClinicName, prefillAdminEmail) already
            // stored in OnboardingService via the tap() inside verifyOnboardingToken().
          } else {
            this.errorReason.set(response.reason);
          }
        },
        error: () => {
          this.loading.set(false);
          this.errorReason.set('network');
        },
      });
  }

  onContinue(): void {
    this.router.navigate(['/onboarding/clinic-setup']);
  }

  onLanguageChange(language: 'en' | 'es'): void {
    this.languageService.setLanguage(language);
  }

  /** Maps an error reason to the right i18n title key */
  get errorTitleKey(): string {
    switch (this.errorReason()) {
      case 'expired':   return 'WELCOME.EXPIRED_TITLE';
      case 'used':      return 'WELCOME.USED_TITLE';
      case 'not_found': return 'WELCOME.NOT_FOUND_TITLE';
      case 'no_token':  return 'WELCOME.NO_TOKEN_TITLE';
      default:          return 'WELCOME.INVALID_TITLE';
    }
  }

  /** Maps an error reason to the right i18n body key */
  get errorBodyKey(): string {
    switch (this.errorReason()) {
      case 'expired':   return 'WELCOME.EXPIRED_BODY';
      case 'used':      return 'WELCOME.USED_BODY';
      case 'not_found': return 'WELCOME.NOT_FOUND_BODY';
      case 'no_token':  return 'WELCOME.NO_TOKEN_BODY';
      default:          return 'WELCOME.INVALID_BODY';
    }
  }
}