import { Component, OnInit, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { take } from 'rxjs/operators';
import {
  VetProfileService,
  VetVerificationStatusResponse,
} from '../../../core/services/vet-profile.service';
import { PrimaryButtonComponent } from '../../../shared/components/primary-button/primary-button.component';
import { AuthBrandingComponent } from '../../../shared/components/auth-branding/auth-branding.component';

@Component({
  selector: 'app-verification-rejected',
  standalone: true,
  imports: [TranslatePipe, PrimaryButtonComponent, AuthBrandingComponent],
  templateUrl: './verification-rejected.component.html',
  styleUrls: ['./verification-rejected.component.scss'],
})
export class VerificationRejectedComponent implements OnInit {
  private vetProfileService = inject(VetProfileService);
  private router = inject(Router);

  status = signal<VetVerificationStatusResponse | null>(null);
  loading = signal(true);

  ngOnInit(): void {
    this.vetProfileService
      .getVerificationStatus()
      .pipe(take(1))
      .subscribe({
        next: (status) => {
          this.status.set(status);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  onUpdateCredentials(): void {
    this.router.navigate(['/onboarding/vet-profile'], {
      queryParams: { mode: 'edit' },
    });
  }
}
