import { Component, inject, computed, signal } from '@angular/core';
import { take } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { CasesService } from '../../cases/shared/services/cases.service';
import { CaseModel, CaseStatus } from '@vet-ai/shared-types';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  private readonly auth = inject(AuthService);
  private readonly casesService = inject(CasesService);

  private readonly cases = signal<CaseModel[]>([]);

  readonly greeting = computed(() => {
    const me = this.auth.me();
    return me?.user.firstName ?? me?.user.email ?? '';
  });

  private readonly openCount = computed(
    () => this.cases().filter((c) => c.status === CaseStatus.OPEN).length
  );

  private readonly needsAttentionCount = computed(
    () => this.cases().filter((c) => c.status === CaseStatus.TRIAGED).length
  );

  private readonly resultsPendingCount = computed(
    () => this.cases().filter((c) => c.status === CaseStatus.ORDERED).length
  );

  private readonly completedCount = computed(
    () => this.cases().filter((c) => c.status === CaseStatus.COMPLETED).length
  );

  readonly metrics = computed(() => [
    {
      value: this.openCount(),
      labelKey: 'DASHBOARD.HOME.OPEN_CASES',
      color: '#29B8BE',
      rgb: '41,184,190',
      iconPath:
        'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    },
    {
      value: this.needsAttentionCount(),
      labelKey: 'DASHBOARD.HOME.NEEDS_ATTENTION',
      color: '#F59E0B',
      rgb: '245,158,11',
      iconPath:
        'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    },
    {
      value: this.resultsPendingCount(),
      labelKey: 'DASHBOARD.HOME.RESULTS_PENDING',
      color: '#A65AF4',
      rgb: '166,90,244',
      iconPath: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    {
      value: this.completedCount(),
      labelKey: 'DASHBOARD.HOME.COMPLETED',
      color: '#1ECC83',
      rgb: '30,204,131',
      iconPath: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    },
  ]);

  constructor() {
    this.casesService
      .listCases()
      .pipe(take(1))
      .subscribe((cases) => this.cases.set(cases));
  }
}
