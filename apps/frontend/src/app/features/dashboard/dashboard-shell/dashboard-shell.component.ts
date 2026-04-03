import { Component, inject, computed, signal } from '@angular/core';
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

  readonly userEmail = computed(() => this.auth.me()?.user.email ?? '');

  readonly menuOpen = signal(false);

  readonly navItems = [
    { labelKey: 'NAV.DASHBOARD', icon: 'home',     path: '/dashboard/home', exact: true  },
    { labelKey: 'NAV.CASES',     icon: 'cases',    path: '/cases',          exact: false },
    { labelKey: 'NAV.ORDERS',    icon: 'orders',   path: '/orders',         exact: false },
    { labelKey: 'NAV.RESULTS',   icon: 'results',  path: '/results',        exact: false },
    { labelKey: 'NAV.SETTINGS',  icon: 'settings', path: '/dashboard/settings', exact: false },
  ];

  signOut() {
    this.menuOpen.set(false);
    this.auth.signOut().subscribe();
  }

  getIcon(name: string): string {
    const icons: Record<string, string> = {
      home:     '🏠',
      cases:    '🩺',
      orders:   '📋',
      results:  '📊',
      settings: '⚙️',
    };
    return icons[name] ?? '•';
  }
}
