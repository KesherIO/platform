import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirm  = control.get('confirm')?.value;
  return password && confirm && password !== confirm ? { mismatch: true } : null;
}

/**
 * Handles two Supabase redirect flows:
 *  1. Magic-link / OAuth — exchanges code, loads profile, routes to app.
 *  2. Password reset (type=recovery) — shows set-new-password form.
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [TranslatePipe, ReactiveFormsModule, RouterModule],
  templateUrl: './callback.component.html',
  styleUrl: './callback.component.scss',
})
export class CallbackComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly fb   = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly view    = signal<'loading' | 'set-password' | 'error'>('loading');
  readonly loading = signal(false);
  readonly error   = signal<string | null>(null);

  readonly form = this.fb.group(
    {
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirm:  ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  ngOnInit() {
    this.auth.handleAuthCallback()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (type) => {
          if (type === 'recovery') {
            this.view.set('set-password');
          }
          // 'authenticated' — navigation already happened inside handleAuthCallback
        },
        error: (err: { message?: string }) => {
          this.view.set('error');
          this.error.set(err?.message ?? 'AUTH.ERROR_GENERIC');
        },
      });
  }

  submit() {
    if (this.form.invalid) return;

    this.loading.set(true);
    this.error.set(null);

    const { password } = this.form.getRawValue();

    this.auth.updatePassword(password!)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loading.set(false),
        error: (err: { message?: string }) => {
          this.loading.set(false);
          this.error.set(err?.message ?? 'AUTH.ERROR_GENERIC');
        },
      });
  }
}
