import { Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { BottomNavComponent } from '../../../shared/components/bottom-nav/bottom-nav.component';
import { ClinicSettingsComponent } from '../clinic/clinic-settings.component';
import { StaffSettingsComponent } from '../staff/staff-settings.component';
import { ProfileSettingsComponent } from '../profile/profile-settings.component';
import { ContactLabSettingsComponent } from '../contact-lab/contact-lab-settings.component';

type SettingsTab = 'clinic' | 'staff' | 'profile' | 'contact-lab';

@Component({
  selector: 'app-settings-shell',
  standalone: true,
  imports: [
    TranslatePipe,
    BottomNavComponent,
    ClinicSettingsComponent,
    StaffSettingsComponent,
    ProfileSettingsComponent,
    ContactLabSettingsComponent,
  ],
  templateUrl: './settings-shell.component.html',
  styleUrl: './settings-shell.component.scss',
})
export class SettingsShellComponent {
  private readonly auth = inject(AuthService);
  private readonly location = inject(Location);

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

  readonly activeTab = signal<SettingsTab>('clinic');

  readonly tabs = computed<Array<{ key: SettingsTab; labelKey: string }>>(
    () => [
      { key: 'clinic', labelKey: 'SETTINGS.TAB_CLINIC' },
      ...(this.isAdmin()
        ? [{ key: 'staff' as const, labelKey: 'SETTINGS.TAB_STAFF' }]
        : []),
      { key: 'profile', labelKey: 'SETTINGS.TAB_PROFILE' },
      { key: 'contact-lab' as const, labelKey: 'SETTINGS.TAB_CONTACT_LAB' },
    ]
  );

  goBack(): void {
    this.location.back();
  }
}
