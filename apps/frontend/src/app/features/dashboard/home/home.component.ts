import { Component, inject, computed } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PrimaryButtonComponent } from '../../../shared/components/primary-button/primary-button.component';
import { SecondaryButtonComponent } from '../../../shared/components/secondary-button/secondary-button.component';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TranslatePipe, PrimaryButtonComponent, SecondaryButtonComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  private readonly auth = inject(AuthService);

  readonly greeting = computed(() => {
    const me = this.auth.me();
    return me?.user.firstName ?? me?.user.email ?? '';
  });

  // TODO: Replace with real data from CasesService / OrdersService
  readonly metrics = [
    { value: 8,  labelKey: 'DASHBOARD.HOME.OPEN_CASES',       icon: '🩺' },
    { value: 3,  labelKey: 'DASHBOARD.HOME.ORDERS_TODAY',     icon: '📋' },
    { value: 5,  labelKey: 'DASHBOARD.HOME.RESULTS_PENDING',  icon: '⏳' },
    { value: 12, labelKey: 'DASHBOARD.HOME.COMPLETED',        icon: '✅' },
  ];
}
