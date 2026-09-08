import { Component, inject, computed } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TenantService } from '../../../core/services/tenant.service';
import { resolveLogoUrl } from '../../../core/services/onboarding.service';

@Component({
  selector: 'app-select-clinic',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './select-clinic.component.html',
  styleUrl: './select-clinic.component.scss',
})
export class SelectClinicComponent {
  private readonly tenantService = inject(TenantService);

  readonly clinics = computed(() =>
    this.tenantService.clinics().map((m) => ({
      id: m.tenant.id,
      name: m.tenant.name,
      logoUrl: resolveLogoUrl(m.tenant.logoUrl),
      roleKey: this.roleTranslationKey(m.role),
    }))
  );

  selectClinic(tenantId: string): void {
    this.tenantService.selectClinic(tenantId);
  }

  private roleTranslationKey(role: string): string {
    const map: Record<string, string> = {
      ADMIN: 'SELECT_CLINIC.ROLE_ADMIN',
      OWNER: 'SELECT_CLINIC.ROLE_OWNER',
      VET: 'SELECT_CLINIC.ROLE_VET',
      TECHNICIAN: 'SELECT_CLINIC.ROLE_TECHNICIAN',
      RECEPTIONIST: 'SELECT_CLINIC.ROLE_RECEPTIONIST',
    };
    return map[role] ?? role;
  }
}
