import { Component, inject, computed, signal, DestroyRef } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../core/services/auth.service';
import { TenantService } from '../../../core/services/tenant.service';
import { resolveLogoUrl } from '../../../core/services/onboarding.service';
import { BottomNavComponent } from '../bottom-nav/bottom-nav.component';
import { PwaInstallBannerComponent } from '../pwa-install-banner/pwa-install-banner.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterModule,
    TranslatePipe,
    BottomNavComponent,
    PwaInstallBannerComponent,
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  readonly tenant = inject(TenantService);

  readonly clinicName = computed(() => {
    const membership = this.tenant.activeMembership();
    return membership?.tenant.name ?? '';
  });

  readonly logoUrl = computed(() => {
    const membership = this.tenant.activeMembership();
    return resolveLogoUrl(membership?.tenant.logoUrl);
  });

  readonly otherClinics = computed(() => {
    const activeId = this.tenant.activeTenantId();
    return this.tenant
      .clinics()
      .filter((m) => m.tenant.id !== activeId)
      .map((m) => ({
        id: m.tenant.id,
        name: m.tenant.name,
        logoUrl: resolveLogoUrl(m.tenant.logoUrl),
        role: m.role,
      }));
  });

  readonly userDisplayName = computed(() => {
    const me = this.auth.me();
    if (!me) return '';
    const { firstName, lastName } = me.user;
    return firstName ? `${firstName} ${lastName ?? ''}`.trim() : me.user.email;
  });

  readonly userInitial = computed(
    () => this.userDisplayName().charAt(0).toUpperCase() || '?'
  );

  readonly userEmail = computed(() => this.auth.me()?.user.email ?? '');

  readonly menuOpen = signal(false);
  readonly clinicSwitcherOpen = signal(false);

  switchClinic(tenantId: string): void {
    this.clinicSwitcherOpen.set(false);
    this.tenant.selectClinic(tenantId);
  }

  signOut() {
    this.menuOpen.set(false);
    this.auth.signOut().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
}
