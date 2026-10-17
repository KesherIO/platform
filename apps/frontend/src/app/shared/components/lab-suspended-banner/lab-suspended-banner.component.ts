import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TenantService } from '../../../core/services/tenant.service';

/**
 * Shown on every page while the clinic's lab has suspended services:
 * history stays available, new orders and AI analysis through that lab don't.
 */
@Component({
  selector: 'app-lab-suspended-banner',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './lab-suspended-banner.component.html',
  styleUrl: './lab-suspended-banner.component.scss',
})
export class LabSuspendedBannerComponent {
  readonly tenant = inject(TenantService);
}
