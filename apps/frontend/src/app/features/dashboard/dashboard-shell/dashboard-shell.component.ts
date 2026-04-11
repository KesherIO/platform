import { Component, inject, computed, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { resolveLogoUrl } from '../../../core/services/onboarding.service';
import { BottomNavComponent } from '../../../shared/components/bottom-nav/bottom-nav.component';
import { PwaInstallBannerComponent } from '../../../shared/components/pwa-install-banner/pwa-install-banner.component';

@Component({
  selector: 'app-dashboard-shell',
  standalone: true,
  imports: [
    RouterModule,
    TranslatePipe,
    BottomNavComponent,
    PwaInstallBannerComponent,
  ],
  templateUrl: './dashboard-shell.component.html',
  styleUrl: './dashboard-shell.component.scss',
})
export class DashboardShellComponent {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

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

  signOut() {
    this.menuOpen.set(false);
    this.auth.signOut().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }
}
