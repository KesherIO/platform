import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { take } from 'rxjs';
import {
  CaseModel,
  CaseStatus,
  ResultReportAnalyteModel,
  AiInterpretationModel,
  ClinicReleasedResultsModel,
  ClinicReleaseStatus,
  ReleasedTestResult,
} from '@vet-ai/shared-types';
import { CasesService } from '../shared/services/cases.service';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';

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
  private languageService = inject(LanguageService);

  loading = signal(true);
  error = signal<string | null>(null);
  case = signal<CaseModel | null>(null);
  released = signal<ClinicReleasedResultsModel | null>(null);

  activeTab = signal<'results' | 'ai'>('results');

  interpretation = signal<AiInterpretationModel | null>(null);
  isInterpreting = signal(false);
  interpretationError = signal<string | null>(null);

  readonly CaseStatus = CaseStatus;

  releaseStatus = computed<ClinicReleaseStatus | null>(
    () => this.released()?.releaseStatus ?? null
  );

  isPartial = computed(() => this.releaseStatus() === 'PARTIAL_RESULTS');

  canInterpret = computed(
    () => this.releaseStatus() === 'ALL_RELEASED' && this.released() !== null
  );

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

  releasedTests = computed<ReleasedTestResult[]>(
    () => this.released()?.releasedTests ?? []
  );

  pendingTestNames = computed<string[]>(
    () => this.released()?.pendingTestNames ?? []
  );

  sections = computed(() => {
    const tests = this.releasedTests();

    // Group tests by department
    const deptMap = new Map<string, ReleasedTestResult[]>();
    for (const test of tests) {
      const dept = test.department ?? 'OTHER';
      if (!deptMap.has(dept)) deptMap.set(dept, []);
      deptMap.get(dept)!.push(test);
    }

    // Define a stable department order
    const DEPT_ORDER = [
      'HEMATOLOGY',
      'CHEMISTRY',
      'URINALYSIS',
      'SEROLOGY',
      'ENDOCRINOLOGY',
      'PARASITOLOGY',
      'MICROBIOLOGY',
      'OTHER',
    ];

    return Array.from(deptMap.entries())
      .sort((a, b) => DEPT_ORDER.indexOf(a[0]) - DEPT_ORDER.indexOf(b[0]))
      .map(([dept, deptTests]) => {
        // Use the latest release info for the department header
        const latest = deptTests.reduce((a, b) =>
          a.releasedAt > b.releasedAt ? a : b
        );

        const mappedTests = deptTests
          .sort((a, b) => a.testName.localeCompare(b.testName))
          .map((test) => {
            const map = new Map<string, ResultReportAnalyteModel[]>();
            for (const a of test.analytes) {
              const key = a.sectionName ?? '';
              if (!map.has(key)) map.set(key, []);
              map.get(key)!.push(a);
            }
            const groups = Array.from(map.entries()).map(([name, rows]) => ({
              name,
              rows,
            }));
            const hideSingleSection = groups.length === 1;
            return {
              testName: test.testName,
              observations: test.observations,
              groups: hideSingleSection
                ? groups.map((g) => ({ ...g, name: '' }))
                : groups,
            };
          });

        return {
          department: dept,
          signerName: latest.signerName,
          releasedAt: new Date(latest.releasedAt).toLocaleDateString('es-CO', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }),
          tests: mappedTests,
        };
      });
  });

  latestReleasedDate = computed(() => {
    const d = this.released()?.latestReleasedAt;
    if (!d) return null;
    return new Date(d).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  });

  reportFooter = computed(() => {
    const tests = this.releasedTests();
    if (!tests.length) return null;
    const first = tests[0];
    return {
      signerName: first.signerName,
      signerTitle: first.signerTitle,
      signerSpecialty: first.signerSpecialty,
      signerUniversity: first.signerUniversity,
      signerRegistrationNumber: first.signerRegistrationNumber,
      signerSignatureUrl: first.signerSignatureUrl,
      analystName: first.analystName,
      analystTitle: first.analystTitle,
      analystUniversity: first.analystUniversity,
      analystSignatureUrl: first.analystSignatureUrl,
      reportDisclaimer: first.reportDisclaimer,
    };
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

  pendingTestsDisplay = computed(() => this.pendingTestNames().join(', '));

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
            .getReleasedResults(orderId)
            .pipe(take(1))
            .subscribe({
              next: (r) => {
                this.released.set(r);
                this.loading.set(false);
                if (r.releaseStatus === 'ALL_RELEASED') {
                  this.casesService
                    .getExistingInterpretation(
                      r.reportId,
                      this.languageService.currentLang()
                    )
                    .pipe(take(1))
                    .subscribe((existing) => {
                      if (existing) this.interpretation.set(existing);
                    });
                }
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

  interpret(): void {
    const reportId = this.released()?.reportId;
    if (!reportId || this.isInterpreting()) return;
    this.isInterpreting.set(true);
    this.interpretationError.set(null);
    this.casesService
      .interpretReport(reportId, this.languageService.currentLang())
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          this.interpretation.set(result);
          this.isInterpreting.set(false);
        },
        error: () => {
          this.interpretationError.set('REPORT.AI_INTERPRETATION.ERROR');
          this.isInterpreting.set(false);
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/results']);
  }

  formatValue(a: ResultReportAnalyteModel): string {
    if (a.isHeader) return '';
    if (a.valueType === 'NUMERIC') {
      if (a.numericValue == null) return '—';
      const n = Number(a.numericValue);
      return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
    }
    if (a.valueType === 'POSITIVE_NEGATIVE')
      return a.booleanValue ? 'Positivo' : 'Negativo';
    if (a.valueType === 'SELECT') return a.selectValue ?? '—';
    return a.textValue ?? '—';
  }

  isTextRow(a: ResultReportAnalyteModel): boolean {
    return a.valueType === 'TEXT' || a.valueType === 'LONG_TEXT';
  }

  isAllTextSection(rows: ResultReportAnalyteModel[]): boolean {
    return rows
      .filter((r) => !r.isHeader)
      .every((r) => r.valueType === 'TEXT' || r.valueType === 'LONG_TEXT');
  }
}
