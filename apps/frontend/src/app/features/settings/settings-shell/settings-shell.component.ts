import { Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { TenantService } from '../../../core/services/tenant.service';
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
    ClinicSettingsComponent,
    StaffSettingsComponent,
    ProfileSettingsComponent,
    ContactLabSettingsComponent,
  ],
  templateUrl: './settings-shell.component.html',
  styleUrl: './settings-shell.component.scss',
})
export class SettingsShellComponent {
  private readonly tenant = inject(TenantService);
  private readonly location = inject(Location);

  readonly isAdmin = computed(() => {
    const membership = this.tenant.activeMembership();
    if (!membership) return false;
    return membership.role === 'ADMIN' || membership.role === 'OWNER';
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
