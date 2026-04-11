import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CasesService } from '../shared/services/cases.service';

interface OrderState {
  orderId: string; // requisitionNumber — e.g. REQ-2026-000001
  requisitionUrl: string;
}

@Component({
  selector: 'app-order-success',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  templateUrl: './order-success.component.html',
  styleUrl: './order-success.component.scss',
})
export class OrderSuccessComponent implements OnInit {
  private router = inject(Router);
  private casesService = inject(CasesService);

  orderState = signal<OrderState | null>(null);
  patientName = computed(
    () => this.casesService.activeCase()?.patientName ?? ''
  );

  ngOnInit(): void {
    const state =
      (this.router.getCurrentNavigation()?.extras.state as
        | OrderState
        | undefined) ?? (history.state as OrderState | undefined);

    if (state?.orderId) {
      this.orderState.set(state);
    }
  }
}
