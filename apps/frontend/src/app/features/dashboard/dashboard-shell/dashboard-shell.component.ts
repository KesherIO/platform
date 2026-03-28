import { Component, inject, signal, computed } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { resolveLogoUrl } from '../../../core/services/onboarding.service';
import { PwaInstallBannerComponent } from '../../../shared/components/pwa-install-banner/pwa-install-banner.component';

@Component({
  selector: 'app-dashboard-shell',
  standalone: true,
  imports: [RouterModule, TranslatePipe, PwaInstallBannerComponent],
  templateUrl: './dashboard-shell.component.html',
  styleUrl: './dashboard-shell.component.scss',
})
export class DashboardShellComponent {
  private readonly auth = inject(AuthService);

  readonly sidebarOpen = signal(true);

  readonly clinicName = computed(() => {
    const me = this.auth.me();
    return me?.tenants[0]?.name ?? '';
  });

  readonly logoUrl = computed(() => {
    const me = this.auth.me();
    return resolveLogoUrl(me?.tenants[0]?.logoUrl);
  });

  readonly userDisplayName = computed(() => {
    const me = this.auth.me();
    if (!me) return '';
    const { firstName, lastName } = me.user;
    return firstName ? `${firstName} ${lastName ?? ''}`.trim() : me.user.email;
  });

  readonly navItems = [
    { labelKey: 'NAV.HOME',          icon: 'home',     path: '/dashboard/home' },
    { labelKey: 'NAV.PATIENTS',      icon: 'patients', path: '/patients' },
    { labelKey: 'NAV.APPOINTMENTS',  icon: 'calendar', path: '/appointments' },
    { labelKey: 'NAV.CASES',         icon: 'cases',    path: '/cases' },
    { labelKey: 'NAV.SETTINGS',      icon: 'settings', path: '/settings' },
  ];

  toggleSidebar() {
    this.sidebarOpen.update(v => !v);
  }

  signOut() {
    this.auth.signOut().subscribe();
  }

  /** Returns a simple Unicode icon for nav items. Replace with a proper icon library if needed. */
  getIcon(name: string): string {
    const icons: Record<string, string> = {
      home:      '🏠',
      patients:  '🐾',
      calendar:  '📅',
      cases:     '🩺',
      settings:  '⚙️',
    };
    return icons[name] ?? '•';
  }
}