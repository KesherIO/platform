import { Component, inject, computed } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  private readonly auth = inject(AuthService);

  readonly greeting = computed(() => {
    const me = this.auth.me();
    return me?.user.firstName ?? me?.user.email ?? '';
  });

  readonly placeholderCards = [
    { icon: '🐾', labelKey: 'NAV.PATIENTS' },
    { icon: '📅', labelKey: 'NAV.APPOINTMENTS' },
    { icon: '🩺', labelKey: 'NAV.CASES' },
  ];
}