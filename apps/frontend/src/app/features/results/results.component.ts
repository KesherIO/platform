import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { take } from 'rxjs';
import { CaseModel, CaseStatus } from '@vet-ai/shared-types';
import { CasesService } from '../cases/shared/services/cases.service';
import { AuthService } from '../../core/services/auth.service';
import { BottomNavComponent } from '../../shared/components/bottom-nav/bottom-nav.component';

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [TranslatePipe, BottomNavComponent],
  templateUrl: './results.component.html',
  styleUrl: './results.component.scss',
})
export class ResultsComponent implements OnInit {
  private casesService = inject(CasesService);
  private authService = inject(AuthService);
  private router = inject(Router);

  loading = signal(true);
  error = signal<string | null>(null);
  allCases = signal<CaseModel[]>([]);

  completedCases = computed(() =>
    this.allCases()
      .filter((c) => c.status === CaseStatus.COMPLETED)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
  );

  clinicName = computed(() => {
    const me = this.authService.me();
    return me?.tenants?.[0]?.name ?? '';
  });

  ngOnInit(): void {
    this.casesService
      .listCases()
      .pipe(take(1))
      .subscribe({
        next: (cases) => {
          this.allCases.set(cases);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('AUTH.ERROR_GENERIC');
          this.loading.set(false);
        },
      });
  }

  viewReport(c: CaseModel): void {
    this.router.navigate(['/cases', c.id, 'report']);
  }

  formatDate(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}
