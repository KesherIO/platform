import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { take } from 'rxjs';
import { CaseModel, CaseStatus } from '@vet-ai/shared-types';
import { CasesService } from '../shared/services/cases.service';
import { CaseWizardLayoutComponent } from '../shared/components/case-wizard-layout/case-wizard-layout.component';
import { ButtonComponent } from '../../../shared/components';
import { SelectedTestsChipsComponent } from './components/selected-tests-chips/selected-tests-chips.component';

@Component({
  selector: 'app-order',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    CaseWizardLayoutComponent,
    ButtonComponent,
    SelectedTestsChipsComponent,
  ],
  templateUrl: './order.component.html',
  styleUrl: './order.component.scss',
})
export class OrderComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private casesService = inject(CasesService);

  loading = signal(true);
  sending = signal(false);
  cancelling = signal(false);
  case = signal<CaseModel | null>(null);

  selectedItems = computed(() => this.case()?.selectedCatalogItems ?? []);
  caseId = computed(() => this.route.snapshot.paramMap.get('id') ?? '');
  testSelectionRoute = computed(() => [
    '/cases',
    this.caseId(),
    'test-selection',
  ]);

  isReadOnly = computed(() => {
    const status = this.case()?.status;
    return (
      status === CaseStatus.ORDERED ||
      status === CaseStatus.COMPLETED ||
      status === CaseStatus.CANCELLED
    );
  });

  isCancelled = computed(() => this.case()?.status === CaseStatus.CANCELLED);
  isOrdered = computed(
    () =>
      this.case()?.status === CaseStatus.ORDERED ||
      this.case()?.status === CaseStatus.COMPLETED
  );

  ngOnInit(): void {
    this.casesService
      .getCase(this.caseId())
      .pipe(take(1))
      .subscribe({
        next: (c) => {
          this.case.set(c);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  generateRequisition(): void {
    if (this.sending()) return;
    this.sending.set(true);
    this.casesService
      .createOrder(this.caseId())
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          this.sending.set(false);
          this.router.navigate(['/cases', this.caseId(), 'order', 'success'], {
            state: { ...result },
          });
        },
        error: () => this.sending.set(false),
      });
  }

  cancelCase(): void {
    if (this.cancelling()) return;
    this.cancelling.set(true);
    this.casesService
      .cancelCase(this.caseId())
      .pipe(take(1))
      .subscribe({
        next: (c) => {
          this.case.set(c);
          this.cancelling.set(false);
        },
        error: () => this.cancelling.set(false),
      });
  }
}
