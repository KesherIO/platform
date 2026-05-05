import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { take } from 'rxjs';
import {
  CaseModel,
  ResultReportModel,
  ResultReportAnalyteModel,
} from '@vet-ai/shared-types';
import { CasesService } from '../shared/services/cases.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-report',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './report.component.html',
  styleUrl: './report.component.scss',
})
export class ReportComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private casesService = inject(CasesService);
  private authService = inject(AuthService);

  loading = signal(true);
  error = signal<string | null>(null);
  case = signal<CaseModel | null>(null);
  report = signal<ResultReportModel | null>(null);

  caseId = computed(() => this.route.snapshot.paramMap.get('id') ?? '');

  clinicName = computed(() => {
    const me = this.authService.me();
    return me?.tenants?.[0]?.name ?? '';
  });

  clinicLogoUrl = computed(() => {
    const me = this.authService.me();
    return me?.tenants?.[0]?.logoUrl ?? null;
  });

  clinicPhone = computed(() => {
    const me = this.authService.me();
    return me?.tenants?.[0]?.phone ?? null;
  });

  clinicAddress = computed(() => {
    const me = this.authService.me();
    return me?.tenants?.[0]?.address ?? null;
  });

  sections = computed(() => {
    const analytes = this.report()?.analytes ?? [];
    const map = new Map<string, ResultReportAnalyteModel[]>();
    for (const a of analytes) {
      const key = a.sectionName ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return Array.from(map.entries()).map(([name, rows]) => ({ name, rows }));
  });

  releasedDate = computed(() => {
    const d = this.report()?.releasedAt;
    if (!d) return null;
    return new Date(d).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  });

  sampleDate = computed(() => {
    const d = this.case()?.orderSentAt;
    if (!d) return null;
    return new Date(d).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  });

  ngOnInit(): void {
    this.casesService
      .getCase(this.caseId())
      .pipe(take(1))
      .subscribe({
        next: (c) => {
          this.case.set(c);
          const orderId = c.order?.orderId;
          if (!orderId) {
            this.error.set('REPORT.ERROR_NO_ORDER');
            this.loading.set(false);
            return;
          }
          this.casesService
            .getReportByOrderId(orderId)
            .pipe(take(1))
            .subscribe({
              next: (r) => {
                this.report.set(r);
                this.loading.set(false);
              },
              error: () => {
                this.error.set('REPORT.ERROR_NOT_FOUND');
                this.loading.set(false);
              },
            });
        },
        error: () => {
          this.error.set('AUTH.ERROR_GENERIC');
          this.loading.set(false);
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/cases', this.caseId(), 'order']);
  }

  formatValue(a: ResultReportAnalyteModel): string {
    if (a.isHeader) return '';
    if (a.valueType === 'NUMERIC')
      return a.numericValue != null ? String(a.numericValue) : '—';
    if (a.valueType === 'POSITIVE_NEGATIVE')
      return a.booleanValue ? 'Positivo' : 'Negativo';
    if (a.valueType === 'SELECT') return a.selectValue ?? '—';
    return a.textValue ?? '—';
  }
}
