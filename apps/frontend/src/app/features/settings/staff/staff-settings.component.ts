import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { StaffMember } from '@vet-ai/shared-types';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService, InviteErrorType, StaffErrorType, MagicLinkResult } from '../../../core/services/settings.service';
import { SecondaryButtonComponent } from '../../../shared/components/secondary-button/secondary-button.component';
import { OutlineButtonComponent } from '../../../shared/components/outline-button/outline-button.component';

@Component({
  selector: 'app-staff-settings',
  standalone: true,
  imports: [TranslatePipe, SecondaryButtonComponent, OutlineButtonComponent],
  templateUrl: './staff-settings.component.html',
  styleUrl: './staff-settings.component.scss',
})
export class StaffSettingsComponent implements OnInit {
  private readonly settingsService = inject(SettingsService);
  private readonly auth = inject(AuthService);

  readonly clinicName = computed(() => this.auth.me()?.tenants[0]?.name ?? '');
  readonly currentUserId = computed(() => this.auth.me()?.user.id ?? '');

  readonly generating    = signal(false);
  readonly magicLinkResult = signal<MagicLinkResult | null>(null);
  readonly inviteError   = signal<InviteErrorType | null>(null);
  readonly copied        = signal(false);

  readonly staffList    = signal<StaffMember[]>([]);
  readonly loadingStaff = signal(true);

  /** userId currently being removed (shows spinner / disables button) */
  readonly removing = signal<string | null>(null);
  /** userId currently having its role updated */
  readonly updatingRole = signal<string | null>(null);
  /** Last-admin error: 'remove' | 'role' | null */
  readonly lastAdminError = signal<'remove' | 'role' | null>(null);

  ngOnInit(): void {
    this.loadStaff();
  }

  createMagicLink(): void {
    this.generating.set(true);
    this.magicLinkResult.set(null);
    this.inviteError.set(null);
    this.settingsService.generateMagicLink().subscribe({
      next: (result) => {
        this.magicLinkResult.set(result);
        this.generating.set(false);
      },
      error: (err: { type: InviteErrorType }) => {
        this.inviteError.set(err?.type ?? 'unknown');
        this.generating.set(false);
      },
    });
  }

  copyLink(): void {
    const url = this.magicLinkResult()?.url;
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  closeModal(): void {
    this.magicLinkResult.set(null);
    this.copied.set(false);
  }

  removeStaff(userId: string): void {
    this.removing.set(userId);
    this.lastAdminError.set(null);
    this.settingsService.removeStaff(userId).subscribe({
      next: () => {
        this.staffList.update((list) => list.filter((m) => m.id !== userId));
        this.removing.set(null);
      },
      error: (err: { type: StaffErrorType }) => {
        this.removing.set(null);
        if (err?.type === 'last_admin') this.lastAdminError.set('remove');
      },
    });
  }

  updateRole(userId: string, currentRole: string): void {
    const newRole = currentRole === 'Admin' ? 'staff' : 'admin';
    this.updatingRole.set(userId);
    this.lastAdminError.set(null);
    this.settingsService.updateRole(userId, newRole).subscribe({
      next: () => {
        this.staffList.update((list) =>
          list.map((m) =>
            m.id === userId
              ? { ...m, role: newRole === 'admin' ? 'Admin' : 'Staff' }
              : m,
          ),
        );
        this.updatingRole.set(null);
      },
      error: (err: { type: StaffErrorType }) => {
        this.updatingRole.set(null);
        if (err?.type === 'last_admin') this.lastAdminError.set('role');
      },
    });
  }

  /** Returns the i18n key for a member's role badge. */
  roleKey(role: string): string {
    return `SETTINGS.STAFF.ROLE_${role.toUpperCase()}`;
  }

  /** Returns the i18n key for the role-toggle button label. */
  roleToggleKey(role: string): string {
    return role === 'Admin' ? 'SETTINGS.STAFF.MAKE_STAFF' : 'SETTINGS.STAFF.MAKE_ADMIN';
  }

  /** Returns the i18n key for a member's status. */
  statusKey(status: string): string {
    return `SETTINGS.STAFF.STATUS_${status.toUpperCase()}`;
  }

  /** Returns Tailwind classes for the status badge. */
  statusClass(status: string): string {
    return status === 'Active'
      ? 'bg-green-100 text-green-700'
      : 'bg-orange-100 text-orange-700';
  }

  private loadStaff(): void {
    this.settingsService.getStaffMembers().subscribe({
      next: (list) => {
        this.staffList.set(list);
        this.loadingStaff.set(false);
      },
      error: () => this.loadingStaff.set(false),
    });
  }
}
