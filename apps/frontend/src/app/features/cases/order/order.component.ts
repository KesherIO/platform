import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { TranslateService } from '@ngx-translate/core';
import { take } from 'rxjs';
import {
  CaseModel,
  CaseStatus,
  DeliveryMethod,
  EligibleVetModel,
  OrderPriority,
} from '@vet-ai/shared-types';
import { CasesService } from '../shared/services/cases.service';
import { AuthService } from '../../../core/services/auth.service';
import { CaseWizardLayoutComponent } from '../shared/components/case-wizard-layout/case-wizard-layout.component';
import { ButtonComponent, ToggleComponent } from '../../../shared/components';
import { SelectComponent } from '../../../shared/components';
import { SelectedTestsChipsComponent } from './components/selected-tests-chips/selected-tests-chips.component';

@Component({
  selector: 'app-order',
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    TranslatePipe,
    CaseWizardLayoutComponent,
    ButtonComponent,
    ToggleComponent,
    SelectComponent,
    SelectedTestsChipsComponent,
  ],
  templateUrl: './order.component.html',
  styleUrl: './order.component.scss',
})
export class OrderComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private casesService = inject(CasesService);
  private auth = inject(AuthService);
  private translate = inject(TranslateService);

  loading = signal(true);
  sending = signal(false);
  cancelling = signal(false);
  case = signal<CaseModel | null>(null);
  deliveryMethod = signal<DeliveryMethod>('LAB_PICKUP');
  priority = signal<OrderPriority>('ROUTINE');
  vets = signal<EligibleVetModel[]>([]);
  vetOptions = signal<{ value: string; label: string; disabled?: boolean }[]>(
    []
  );
  orderingVetId = signal<string>('');

  deliveryMethodOptions = [
    { label: 'CASES.ORDER.DELIVERY_CLIENT', value: 'CLIENT_DELIVERY' },
    { label: 'CASES.ORDER.DELIVERY_LAB_PICKUP', value: 'LAB_PICKUP' },
  ];

  priorityOptions = [
    { label: 'CASES.ORDER.PRIORITY_ROUTINE', value: 'ROUTINE' },
    { label: 'CASES.ORDER.PRIORITY_URGENT', value: 'URGENT' },
  ];

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

  selectedVet = computed(
    () => this.vets().find((v) => v.userId === this.orderingVetId()) ?? null
  );

  canSubmitOrder = computed(() => {
    if (this.vets().length === 0) return true; // no vets loaded yet, don't block
    const vet = this.selectedVet();
    return !!vet && vet.status === 'ACTIVE';
  });

  showNoVetMessage = computed(() => {
    if (this.vets().length === 0) return false;
    const id = this.orderingVetId();
    if (!id) return true;
    const vet = this.selectedVet();
    return !vet || vet.status !== 'ACTIVE';
  });

  ngOnInit(): void {
    this.casesService
      .getCase(this.caseId())
      .pipe(take(1))
      .subscribe({
        next: (c) => {
          this.case.set(c);
          this.loading.set(false);
          if (c.attendingVetId) {
            this.orderingVetId.set(c.attendingVetId);
          }
        },
        error: () => this.loading.set(false),
      });

    this.casesService
      .getEligibleVets()
      .pipe(take(1))
      .subscribe({
        next: (vets) => {
          this.vets.set(vets);
          this.vetOptions.set(this.buildVetOptions(vets));
          // If case already loaded and no vet preselected, try self
          if (!this.orderingVetId()) {
            this.preselectSelfIfEligible(vets);
          }
        },
      });
  }

  private buildVetOptions(
    vets: EligibleVetModel[]
  ): { value: string; label: string; disabled?: boolean }[] {
    return vets.map((vet) => {
      const isActive = vet.status === 'ACTIVE';
      let label = vet.fullName || vet.email;
      if (!isActive) {
        const statusLabel = this.translate.instant(
          this.vetStatusKey(vet.status)
        );
        label = `${label} ${statusLabel}`;
      }
      return { value: vet.userId, label, disabled: !isActive };
    });
  }

  private vetStatusKey(status: string): string {
    const keys: Record<string, string> = {
      PROFILE_REQUIRED: 'CASES.VET_STATUS.PROFILE_REQUIRED',
      VERIFICATION_PENDING: 'CASES.VET_STATUS.VERIFICATION_PENDING',
      SUSPENDED: 'CASES.VET_STATUS.SUSPENDED',
      INVITED: 'CASES.VET_STATUS.INVITED',
    };
    return keys[status] ?? 'CASES.VET_STATUS.PROFILE_REQUIRED';
  }

  private preselectSelfIfEligible(vets: EligibleVetModel[]): void {
    const me = this.auth.me();
    if (!me) return;
    const myMembership = me.memberships?.[0];
    if (!myMembership?.isOrderingVet || myMembership.status !== 'ACTIVE')
      return;
    const selfInList = vets.find((v) => v.userId === me.user.id);
    if (selfInList) {
      this.orderingVetId.set(me.user.id);
    }
  }

  onDeliveryMethodChange(value: string): void {
    this.deliveryMethod.set(value as DeliveryMethod);
  }

  onPriorityChange(value: string): void {
    this.priority.set(value as OrderPriority);
  }

  onOrderingVetChange(value: string): void {
    this.orderingVetId.set(value);
  }

  generateRequisition(): void {
    if (this.sending() || !this.canSubmitOrder()) return;
    this.sending.set(true);
    this.casesService
      .createOrder(
        this.caseId(),
        this.deliveryMethod(),
        this.priority(),
        this.orderingVetId() || undefined
      )
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
