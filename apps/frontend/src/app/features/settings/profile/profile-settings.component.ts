import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { OutlineButtonComponent } from '../../../shared/components/outline-button/outline-button.component';
import { LanguageToggleComponent } from '../../../shared/components/language-toggle/language-toggle.component';

@Component({
  selector: 'app-profile-settings',
  standalone: true,
  imports: [
    TranslatePipe,
    ButtonComponent,
    OutlineButtonComponent,
    LanguageToggleComponent,
  ],
  templateUrl: './profile-settings.component.html',
  styleUrl: './profile-settings.component.scss',
})
export class ProfileSettingsComponent {
  private readonly auth = inject(AuthService);
  private readonly langService = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);

  readonly userDisplayName = computed(() => {
    const me = this.auth.me();
    if (!me) return '';
    const { firstName, lastName } = me.user;
    return firstName ? `${firstName} ${lastName ?? ''}`.trim() : me.user.email;
  });

  readonly userEmail = computed(() => this.auth.me()?.user.email ?? '');
  readonly userPhone = computed(() => this.auth.me()?.user.phone ?? '');
  readonly currentLang = computed(() => this.langService.currentLang());

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly signingOut = signal(false);
  readonly editFirstName = signal('');
  readonly editLastName = signal('');
  readonly editPhone = signal('');

  startEditing(): void {
    const me = this.auth.me();
    this.editFirstName.set(me?.user.firstName ?? '');
    this.editLastName.set(me?.user.lastName ?? '');
    this.editPhone.set(me?.user.phone ?? '');
    this.editing.set(true);
  }

  cancelEditing(): void {
    this.editing.set(false);
  }

  save(): void {
    this.saving.set(true);
    this.auth
      .updateProfile({
        firstName: this.editFirstName(),
        lastName: this.editLastName(),
        phone: this.editPhone(),
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editing.set(false);
        },
        error: () => this.saving.set(false),
      });
  }

  signOut(): void {
    this.signingOut.set(true);
    this.auth
      .signOut()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => this.signingOut.set(false),
      });
  }

  setLanguage(lang: 'en' | 'es'): void {
    this.langService.setLanguage(lang);
  }
}
