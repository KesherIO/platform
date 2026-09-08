import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { take } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { AuthBrandingComponent } from '../../../shared/components/auth-branding/auth-branding.component';

@Component({
  selector: 'app-no-clinic',
  standalone: true,
  imports: [TranslatePipe, AuthBrandingComponent],
  templateUrl: './no-clinic.component.html',
})
export class NoClinicComponent {
  private auth = inject(AuthService);

  onSignOut(): void {
    this.auth.signOut().pipe(take(1)).subscribe();
  }
}
