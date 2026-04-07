import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { Location } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { StaffSettingsComponent } from '../staff/staff-settings.component';
import { AuthService } from '../../../core/services/auth.service';
import { OutlineButtonComponent } from '../../../shared/components/outline-button/outline-button.component';

type SettingsTab = 'clinic' | 'staff' | 'profile';

@Component({
  selector: 'app-settings-shell',
  standalone: true,
  imports: [TranslatePipe, StaffSettingsComponent, OutlineButtonComponent],
  templateUrl: './settings-shell.component.html',
  styleUrl: './settings-shell.component.scss',
})
export class SettingsShellComponent {
  private readonly auth = inject(AuthService);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);

  readonly isAdmin = computed(() => {
    const me = this.auth.me();
    if (!me) return false;
    const activeTenantId = me.activeTenantId ?? me.tenants[0]?.id;
    return me.memberships.some(
      (m) =>
        m.tenant.id === activeTenantId &&
        (m.role === 'ADMIN' || m.role === 'OWNER')
    );
  });

  readonly userDisplayName = computed(() => {
    const me = this.auth.me();
    if (!me) return '';
    const { firstName, lastName } = me.user;
    return firstName ? `${firstName} ${lastName ?? ''}`.trim() : me.user.email;
  });

  readonly userEmail = computed(() => this.auth.me()?.user.email ?? '');

  readonly signingOut = signal(false);

  readonly activeTab = signal<SettingsTab>('clinic');

  readonly tabs = computed<Array<{ key: SettingsTab; labelKey: string }>>(
    () => [
      { key: 'clinic', labelKey: 'SETTINGS.TAB_CLINIC' },
      ...(this.isAdmin()
        ? [{ key: 'staff' as const, labelKey: 'SETTINGS.TAB_STAFF' }]
        : []),
      { key: 'profile', labelKey: 'SETTINGS.TAB_PROFILE' },
    ]
  );

  goBack(): void {
    this.location.back();
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
}
