import { Component, OnInit, signal, inject, DestroyRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { interval } from 'rxjs';
import { startWith, switchMap, catchError, take } from 'rxjs/operators';
import { of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  VetProfileService,
  VetVerificationStatusResponse,
} from '../../../core/services/vet-profile.service';
import { AuthService } from '../../../core/services/auth.service';
import { AuthBrandingComponent } from '../../../shared/components/auth-branding/auth-branding.component';

const POLL_INTERVAL_MS = 30_000;

@Component({
  selector: 'app-verification-pending',
  standalone: true,
  imports: [TranslatePipe, DatePipe, AuthBrandingComponent],
  templateUrl: './verification-pending.component.html',
  styleUrls: ['./verification-pending.component.scss'],
})
export class VerificationPendingComponent implements OnInit {
  private vetProfileService = inject(VetProfileService);
  private auth = inject(AuthService);
  private destroyRef = inject(DestroyRef);

  status = signal<VetVerificationStatusResponse | null>(null);
  loading = signal(true);

  ngOnInit(): void {
    interval(POLL_INTERVAL_MS)
      .pipe(
        startWith(0),
        switchMap(() =>
          this.vetProfileService
            .getVerificationStatus()
            .pipe(catchError(() => of(this.status())))
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((status) => {
        this.loading.set(false);
        this.status.set(status);
        if (status?.status === 'APPROVED') {
          this.auth
            .loadMe()
            .pipe(take(1))
            .subscribe(() => this.auth.navigateAfterAuth());
        }
      });
  }
}
