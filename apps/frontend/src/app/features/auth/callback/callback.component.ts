import { Component, OnInit, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Handles the magic-link / OAuth redirect.
 * Supabase redirects here after the user clicks the email link.
 * We call handleAuthCallback() which exchanges the code for a session,
 * fetches /auth/me, and routes to onboarding or dashboard.
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './callback.component.html',
  styleUrl: './callback.component.scss',
})
export class CallbackComponent implements OnInit {
  private readonly auth = inject(AuthService);

  readonly error = { message: null as string | null };

  ngOnInit() {
    this.auth.handleAuthCallback().subscribe({
      error: (err) => {
        this.error.message = err?.message ?? 'AUTH.ERROR_GENERIC';
      },
    });
  }
}